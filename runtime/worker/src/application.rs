use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc, Mutex, MutexGuard, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    time::{Duration, Instant},
};

use crate::{SubmitError, WorkerPool};

const MAILBOX_DRAIN_QUANTUM: usize = 8;

#[derive(Debug, PartialEq, Eq)]
pub enum PostError<M> {
    MailboxFull(M),
    PoolFull(M),
    Closed(M),
    Terminated(M),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplyError {
    Panicked,
    Terminated,
    TimedOut,
    Cancelled,
    Disconnected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RestartPolicy {
    pub max_restarts: usize,
    pub within: Duration,
}

pub struct Reply<R> {
    receiver: Receiver<Result<R, ReplyError>>,
}

impl<R> Reply<R> {
    pub fn receive(self) -> Result<R, ReplyError> {
        self.receiver
            .recv()
            .unwrap_or(Err(ReplyError::Disconnected))
    }

    pub fn receive_timeout(self, timeout: Duration) -> Result<R, ReplyError> {
        match self.receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => Err(ReplyError::TimedOut),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(ReplyError::Disconnected),
        }
    }

    pub fn receive_with_cancellation(
        self,
        timeout: Option<Duration>,
        poll_interval: Duration,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<R, ReplyError> {
        assert!(
            !poll_interval.is_zero(),
            "reply poll interval must be positive"
        );
        let started = Instant::now();
        loop {
            if cancelled() {
                return Err(ReplyError::Cancelled);
            }
            let wait = timeout.map_or(poll_interval, |timeout| {
                timeout.saturating_sub(started.elapsed()).min(poll_interval)
            });
            if wait.is_zero() {
                return Err(ReplyError::TimedOut);
            }
            match self.receiver.recv_timeout(wait) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Timeout)
                    if timeout.is_some_and(|timeout| started.elapsed() >= timeout) =>
                {
                    return Err(ReplyError::TimedOut);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(ReplyError::Disconnected);
                }
            }
        }
    }
}

pub struct ApplicationPool<S, M, R> {
    pool: Arc<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
    weak_pool: Weak<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
    initialize: Arc<dyn Fn(usize) -> S + Send + Sync>,
    next_worker_id: AtomicUsize,
    mailbox_capacity: usize,
}

impl<S, M, R> ApplicationPool<S, M, R>
where
    S: Send + 'static,
    M: Send + 'static,
    R: Send + 'static,
{
    pub fn new<Initialize, Handle>(
        executor_count: usize,
        queue_capacity: usize,
        mailbox_capacity: usize,
        initialize: Initialize,
        handle: Handle,
    ) -> std::io::Result<Self>
    where
        Initialize: Fn(usize) -> S + Send + Sync + 'static,
        Handle: Fn(&mut S, M) -> R + Send + Sync + 'static,
    {
        if mailbox_capacity == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "mailbox capacity must be greater than zero",
            ));
        }
        let handle = Arc::new(handle);
        let pool = Arc::new(WorkerPool::new(
            executor_count,
            queue_capacity,
            |_| (),
            move |_, worker: Arc<WorkerControl<S, M, R>>| worker.drain(&*handle),
        )?);
        let weak_pool = Arc::downgrade(&pool);
        Ok(Self {
            pool,
            weak_pool,
            initialize: Arc::new(initialize),
            next_worker_id: AtomicUsize::new(0),
            mailbox_capacity,
        })
    }

    pub fn spawn(&self) -> LogicalWorker<S, M, R> {
        self.spawn_with_capacity(self.mailbox_capacity)
            .expect("pool mailbox capacity is validated during construction")
    }

    pub fn spawn_with_capacity(
        &self,
        mailbox_capacity: usize,
    ) -> Result<LogicalWorker<S, M, R>, std::io::Error> {
        self.spawn_with_capacity_and_restart(mailbox_capacity, None)
    }

    pub fn spawn_with_capacity_and_restart(
        &self,
        mailbox_capacity: usize,
        restart: Option<RestartPolicy>,
    ) -> Result<LogicalWorker<S, M, R>, std::io::Error> {
        self.spawn_with_policy(mailbox_capacity, restart, None)
    }

    pub fn supervise(
        &self,
        policy: RestartPolicy,
    ) -> Result<ApplicationSupervisor<S, M, R>, std::io::Error> {
        validate_restart_policy(policy)?;
        Ok(ApplicationSupervisor {
            control: Arc::new(SupervisorControl {
                policy,
                attempts: Mutex::new(VecDeque::new()),
                exhausted: AtomicBool::new(false),
                children: Mutex::new(Vec::new()),
                pool: self.weak_pool.clone(),
            }),
        })
    }

    pub fn spawn_with_capacity_and_supervisor(
        &self,
        mailbox_capacity: usize,
        supervisor: &ApplicationSupervisor<S, M, R>,
    ) -> Result<LogicalWorker<S, M, R>, std::io::Error> {
        if !Weak::ptr_eq(&self.weak_pool, &supervisor.control.pool) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "logical worker supervisor belongs to another pool",
            ));
        }
        self.spawn_with_policy(
            mailbox_capacity,
            None,
            Some(Arc::clone(&supervisor.control)),
        )
    }

    fn spawn_with_policy(
        &self,
        mailbox_capacity: usize,
        restart: Option<RestartPolicy>,
        supervisor: Option<Arc<SupervisorControl<S, M, R>>>,
    ) -> Result<LogicalWorker<S, M, R>, std::io::Error> {
        if mailbox_capacity == 0 || mailbox_capacity > self.mailbox_capacity {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "logical worker mailbox capacity is outside the pool bound",
            ));
        }
        if let Some(policy) = restart {
            validate_restart_policy(policy)?;
        }
        let id = self.next_worker_id.fetch_add(1, Ordering::Relaxed);
        let control = Arc::new(WorkerControl::new(
            id,
            (self.initialize)(id),
            mailbox_capacity,
            self.weak_pool.clone(),
            Arc::clone(&self.initialize),
            restart,
            supervisor.clone(),
        ));
        if let Some(supervisor) = supervisor {
            supervisor.register(&control)?;
        }
        Ok(LogicalWorker { control })
    }

    pub fn close(&self) {
        self.pool.close();
    }

    pub fn join(self) {
        self.pool.close();
    }

    pub fn executor_count(&self) -> usize {
        self.pool.worker_count()
    }
}

fn validate_restart_policy(policy: RestartPolicy) -> Result<(), std::io::Error> {
    if policy.max_restarts == 0 || policy.within.is_zero() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "logical worker restart policy must have a positive count and window",
        ));
    }
    Ok(())
}

pub struct ApplicationSupervisor<S, M, R> {
    control: Arc<SupervisorControl<S, M, R>>,
}

pub struct LogicalWorker<S, M, R> {
    control: Arc<WorkerControl<S, M, R>>,
}

impl<S, M, R> LogicalWorker<S, M, R>
where
    S: Send + 'static,
    M: Send + 'static,
    R: Send + 'static,
{
    pub fn id(&self) -> usize {
        self.control.id
    }

    pub fn try_post(&self, input: M) -> Result<Reply<R>, PostError<M>> {
        if self.control.terminated.load(Ordering::Acquire) {
            return Err(PostError::Terminated(input));
        }
        let Some(pool) = self.control.pool.upgrade() else {
            return Err(PostError::Closed(input));
        };
        let (sender, receiver) = mpsc::sync_channel(1);
        let mut mailbox = lock(&self.control.mailbox);
        if self.control.terminated.load(Ordering::Acquire) {
            return Err(PostError::Terminated(input));
        }
        if mailbox.messages.len() == mailbox.capacity {
            return Err(PostError::MailboxFull(input));
        }
        mailbox.messages.push_back(Message { input, sender });
        if !mailbox.scheduled {
            mailbox.scheduled = true;
            if let Err(error) = pool.try_submit(Arc::clone(&self.control)) {
                mailbox.scheduled = false;
                let message = mailbox.messages.pop_back().expect("just queued message");
                return Err(match error {
                    SubmitError::Full(_) => PostError::PoolFull(message.input),
                    SubmitError::Closed(_) => PostError::Closed(message.input),
                });
            }
        }
        drop(mailbox);
        Ok(Reply { receiver })
    }

    pub fn call(&self, input: M) -> Result<R, CallError<M>> {
        match self.try_post(input) {
            Ok(reply) => reply.receive().map_err(CallError::Reply),
            Err(error) => Err(CallError::Post(error)),
        }
    }

    pub fn call_timeout(&self, input: M, timeout: Duration) -> Result<R, CallError<M>> {
        match self.try_post(input) {
            Ok(reply) => reply.receive_timeout(timeout).map_err(CallError::Reply),
            Err(error) => Err(CallError::Post(error)),
        }
    }

    pub fn terminate(&self) {
        self.control.terminate();
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum CallError<M> {
    Post(PostError<M>),
    Reply(ReplyError),
}

struct WorkerControl<S, M, R> {
    id: usize,
    state: Mutex<S>,
    mailbox: Mutex<Mailbox<M, R>>,
    terminated: AtomicBool,
    pool: Weak<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
    initialize: Arc<dyn Fn(usize) -> S + Send + Sync>,
    restart: Option<RestartWindow>,
    supervisor: Option<Arc<SupervisorControl<S, M, R>>>,
}

struct RestartWindow {
    policy: RestartPolicy,
    attempts: Mutex<VecDeque<Instant>>,
}

struct SupervisorControl<S, M, R> {
    policy: RestartPolicy,
    attempts: Mutex<VecDeque<Instant>>,
    exhausted: AtomicBool,
    children: Mutex<Vec<Weak<WorkerControl<S, M, R>>>>,
    pool: Weak<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
}

enum RestartDecision {
    NotConfigured,
    Restarted,
    Exhausted,
}

impl<S, M, R> WorkerControl<S, M, R> {
    fn new(
        id: usize,
        state: S,
        mailbox_capacity: usize,
        pool: Weak<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
        initialize: Arc<dyn Fn(usize) -> S + Send + Sync>,
        restart: Option<RestartPolicy>,
        supervisor: Option<Arc<SupervisorControl<S, M, R>>>,
    ) -> Self {
        Self {
            id,
            state: Mutex::new(state),
            mailbox: Mutex::new(Mailbox {
                messages: VecDeque::new(),
                capacity: mailbox_capacity,
                scheduled: false,
            }),
            terminated: AtomicBool::new(false),
            pool,
            initialize,
            restart: restart.map(|policy| RestartWindow {
                policy,
                attempts: Mutex::new(VecDeque::new()),
            }),
            supervisor,
        }
    }

    fn terminate(&self) {
        self.terminated.store(true, Ordering::Release);
        let mut mailbox = lock(&self.mailbox);
        for message in mailbox.messages.drain(..) {
            let _ = message.sender.send(Err(ReplyError::Terminated));
        }
    }

    fn restart_after_panic(&self, state: &mut S) -> RestartDecision {
        let Some(restart) = &self.restart else {
            return RestartDecision::NotConfigured;
        };
        let now = Instant::now();
        let mut attempts = lock(&restart.attempts);
        while attempts
            .front()
            .is_some_and(|attempt| now.duration_since(*attempt) >= restart.policy.within)
        {
            attempts.pop_front();
        }
        if attempts.len() >= restart.policy.max_restarts {
            return RestartDecision::Exhausted;
        }
        attempts.push_back(now);
        drop(attempts);
        match catch_unwind(AssertUnwindSafe(|| (self.initialize)(self.id))) {
            Ok(restarted) => {
                *state = restarted;
                RestartDecision::Restarted
            }
            Err(_) => RestartDecision::Exhausted,
        }
    }
}

impl<S, M, R> SupervisorControl<S, M, R> {
    fn register(&self, child: &Arc<WorkerControl<S, M, R>>) -> Result<(), std::io::Error> {
        let mut children = lock(&self.children);
        children.retain(|candidate| candidate.strong_count() > 0);
        if self.exhausted.load(Ordering::Acquire) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "logical worker supervisor is terminated",
            ));
        }
        if children.len() == 16 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "logical worker supervisor supports at most 16 children",
            ));
        }
        children.push(Arc::downgrade(child));
        Ok(())
    }

    fn restart_after_panic(
        &self,
        child: &WorkerControl<S, M, R>,
        state: &mut S,
    ) -> RestartDecision {
        if self.exhausted.load(Ordering::Acquire) {
            return RestartDecision::Exhausted;
        }
        let now = Instant::now();
        let mut attempts = lock(&self.attempts);
        while attempts
            .front()
            .is_some_and(|attempt| now.duration_since(*attempt) >= self.policy.within)
        {
            attempts.pop_front();
        }
        if attempts.len() >= self.policy.max_restarts {
            self.exhausted.store(true, Ordering::Release);
            drop(attempts);
            self.terminate_children();
            return RestartDecision::Exhausted;
        }
        attempts.push_back(now);
        drop(attempts);
        match catch_unwind(AssertUnwindSafe(|| (child.initialize)(child.id))) {
            Ok(restarted) if !self.exhausted.load(Ordering::Acquire) => {
                *state = restarted;
                RestartDecision::Restarted
            }
            Ok(_) | Err(_) => {
                self.exhausted.store(true, Ordering::Release);
                self.terminate_children();
                RestartDecision::Exhausted
            }
        }
    }

    fn terminate_children(&self) {
        let children = lock(&self.children)
            .iter()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>();
        for child in children {
            child.terminate();
        }
    }
}

impl<S, M, R> WorkerControl<S, M, R>
where
    S: Send + 'static,
    M: Send + 'static,
    R: Send + 'static,
{
    fn drain(self: &Arc<Self>, handle: &impl Fn(&mut S, M) -> R) {
        let mut processed = 0;
        loop {
            if processed == MAILBOX_DRAIN_QUANTUM {
                let mut mailbox = lock(&self.mailbox);
                if mailbox.messages.is_empty() {
                    mailbox.scheduled = false;
                    return;
                }
                drop(mailbox);
                if let Some(pool) = self.pool.upgrade()
                    && pool.try_submit(Arc::clone(self)).is_ok()
                {
                    return;
                }
                processed = 0;
            }
            let message = {
                let mut mailbox = lock(&self.mailbox);
                let Some(message) = mailbox.messages.pop_front() else {
                    mailbox.scheduled = false;
                    return;
                };
                message
            };
            if self.terminated.load(Ordering::Acquire) {
                let _ = message.sender.send(Err(ReplyError::Terminated));
                continue;
            }
            let mut state = lock(&self.state);
            let result = catch_unwind(AssertUnwindSafe(|| handle(&mut state, message.input)))
                .map_err(|_| ReplyError::Panicked);
            let restart = if matches!(&result, Err(ReplyError::Panicked)) {
                if let Some(supervisor) = &self.supervisor {
                    supervisor.restart_after_panic(self, &mut state)
                } else {
                    self.restart_after_panic(&mut state)
                }
            } else {
                RestartDecision::NotConfigured
            };
            drop(state);
            let _ = message.sender.send(result);
            if matches!(restart, RestartDecision::Exhausted) {
                self.terminate();
                return;
            }
            processed += 1;
        }
    }
}

struct Mailbox<M, R> {
    messages: VecDeque<Message<M, R>>,
    capacity: usize,
    scheduled: bool,
}

struct Message<M, R> {
    input: M,
    sender: SyncSender<Result<R, ReplyError>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "application/tests.rs"]
mod tests;
