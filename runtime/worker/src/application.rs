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
        let id = self.next_worker_id.fetch_add(1, Ordering::Relaxed);
        LogicalWorker {
            control: Arc::new(WorkerControl::new(
                id,
                (self.initialize)(id),
                self.mailbox_capacity,
            )),
            pool: self.weak_pool.clone(),
        }
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
    pool: Weak<WorkerPool<Arc<WorkerControl<S, M, R>>>>,
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
        let Some(pool) = self.pool.upgrade() else {
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
}

impl<S, M, R> WorkerControl<S, M, R> {
    fn new(id: usize, state: S, mailbox_capacity: usize) -> Self {
        Self {
            id,
            state: Mutex::new(state),
            mailbox: Mutex::new(Mailbox {
                messages: VecDeque::with_capacity(mailbox_capacity),
                capacity: mailbox_capacity,
                scheduled: false,
            }),
            terminated: AtomicBool::new(false),
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
    fn drain(&self, handle: &impl Fn(&mut S, M) -> R) {
        loop {
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
mod tests {
    use std::{
        sync::{Arc, Barrier, Mutex, mpsc},
        time::Duration,
    };

    use super::{ApplicationPool, CallError, PostError, ReplyError};

    #[test]
    fn preserves_order_and_isolated_worker_state() {
        let pool = ApplicationPool::new(
            2,
            4,
            4,
            |_| 0_usize,
            |count, value| {
                *count += 1;
                (value, *count)
            },
        )
        .expect("create application pool");
        let first = pool.spawn();
        let second = pool.spawn();
        let first_a = first.try_post("a").expect("post first a");
        let first_b = first.try_post("b").expect("post first b");
        let second_a = second.try_post("a").expect("post second a");

        assert_eq!(first_a.receive(), Ok(("a", 1)));
        assert_eq!(first_b.receive(), Ok(("b", 2)));
        assert_eq!(second_a.receive(), Ok(("a", 1)));
        assert_ne!(first.id(), second.id());
        pool.join();
    }

    #[test]
    fn distinct_logical_workers_execute_on_the_native_pool_in_parallel() {
        let barrier = Arc::new(Barrier::new(3));
        let pool = ApplicationPool::new(2, 2, 1, |_| (), {
            let barrier = Arc::clone(&barrier);
            move |_, value| {
                barrier.wait();
                value
            }
        })
        .expect("create application pool");
        let first = pool.spawn();
        let second = pool.spawn();
        let first_reply = first.try_post(1).expect("post first");
        let second_reply = second.try_post(2).expect("post second");
        barrier.wait();

        assert_eq!(first_reply.receive(), Ok(1));
        assert_eq!(second_reply.receive(), Ok(2));
        pool.join();
    }

    #[test]
    fn termination_cancels_queued_messages_after_active_work() {
        let (started_tx, started_rx) = mpsc::channel();
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let pool = ApplicationPool::new(1, 1, 2, |_| (), {
            let gate = Arc::clone(&gate);
            move |_, value| {
                started_tx.send(()).expect("report active message");
                let (open, changed) = &*gate;
                let mut open = open.lock().expect("lock gate");
                while !*open {
                    open = changed.wait(open).expect("wait gate");
                }
                value
            }
        })
        .expect("create application pool");
        let worker = pool.spawn();
        let active = worker.try_post(1).expect("post active");
        started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("active message started");
        let queued = worker.try_post(2).expect("post queued");
        worker.terminate();
        assert_eq!(queued.receive(), Err(ReplyError::Terminated));
        assert_eq!(
            worker.call(3),
            Err(CallError::Post(PostError::Terminated(3)))
        );
        let (open, changed) = &*gate;
        *open.lock().expect("lock gate") = true;
        changed.notify_all();
        assert_eq!(active.receive(), Ok(1));
        pool.join();
    }

    #[test]
    fn panic_is_reported_and_later_messages_recover() {
        let pool = ApplicationPool::new(
            1,
            1,
            2,
            |_| (),
            |_, value| if value == 1 { panic!("boom") } else { value },
        )
        .expect("create application pool");
        let worker = pool.spawn();

        assert_eq!(worker.call(1), Err(CallError::Reply(ReplyError::Panicked)));
        assert_eq!(worker.call(2), Ok(2));
        pool.join();
    }

    #[test]
    fn rejected_post_returns_message_ownership() {
        let barrier = Arc::new(Barrier::new(2));
        let (started_tx, started_rx) = mpsc::channel();
        let pool = ApplicationPool::new(1, 1, 1, |_| (), {
            let barrier = Arc::clone(&barrier);
            move |_, value| {
                if value == "active" {
                    started_tx.send(()).expect("report active worker");
                    barrier.wait();
                }
                value
            }
        })
        .expect("create application pool");
        let active = pool.spawn();
        let waiting = pool.spawn();
        let rejected = pool.spawn();
        let active_reply = active
            .try_post(String::from("active"))
            .expect("post active");
        started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("active worker started");
        let waiting_reply = waiting
            .try_post(String::from("waiting"))
            .expect("post waiting");
        match rejected.try_post(String::from("owned")) {
            Err(PostError::PoolFull(message)) => assert_eq!(message, "owned"),
            Err(error) => panic!("unexpected rejection: {error:?}"),
            Ok(_) => panic!("over-capacity post was accepted"),
        }
        barrier.wait();
        assert_eq!(active_reply.receive(), Ok(String::from("active")));
        assert_eq!(waiting_reply.receive(), Ok(String::from("waiting")));
        pool.join();
    }
}
