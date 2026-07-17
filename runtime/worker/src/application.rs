use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc, Mutex, MutexGuard, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
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
    Disconnected,
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
        if mailbox_capacity == 0 || mailbox_capacity > self.mailbox_capacity {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "logical worker mailbox capacity is outside the pool bound",
            ));
        }
        let id = self.next_worker_id.fetch_add(1, Ordering::Relaxed);
        Ok(LogicalWorker {
            control: Arc::new(WorkerControl::new(
                id,
                (self.initialize)(id),
                mailbox_capacity,
                self.weak_pool.clone(),
            )),
        })
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
}

impl<S, M, R> WorkerControl<S, M, R> {
    fn new(
        id: usize,
        state: S,
        mailbox_capacity: usize,
        pool: Weak<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
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
        }
    }

    fn terminate(&self) {
        self.terminated.store(true, Ordering::Release);
        let mut mailbox = lock(&self.mailbox);
        for message in mailbox.messages.drain(..) {
            let _ = message.sender.send(Err(ReplyError::Terminated));
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
            drop(state);
            let _ = message.sender.send(result);
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
