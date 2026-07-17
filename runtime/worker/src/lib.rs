//! Bounded, reusable native worker execution for TinyTSX runtimes.
//!
//! This crate deliberately has no knowledge of HTTP or JavaScript workers. A
//! caller supplies an owned job type, per-thread state, and a job handler.

mod application;

pub use application::{
    ApplicationPool, CallError, LogicalWorker, PostError, Reply, ReplyError, RestartPolicy,
};

use std::{
    collections::VecDeque,
    io,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{Arc, Condvar, Mutex, MutexGuard},
    thread::{self, JoinHandle},
};

/// A job rejected by [`WorkerPool::try_submit`].
#[derive(Debug, PartialEq, Eq)]
pub enum SubmitError<J> {
    /// The pool is running, but its bounded queue has no free slot.
    Full(J),
    /// The pool is closing or has closed.
    Closed(J),
}

impl<J> SubmitError<J> {
    /// Returns ownership of the job that was not accepted.
    pub fn into_inner(self) -> J {
        match self {
            Self::Full(job) | Self::Closed(job) => job,
        }
    }
}

/// The disposition of a job after one bounded handler turn.
#[derive(Debug, PartialEq, Eq)]
pub enum JobControl<J> {
    /// The job is finished and releases its pool admission slot.
    Complete,
    /// The owned job remains live and should rotate behind queued work.
    Resubmit(J),
}

/// A fixed set of native threads consuming a bounded FIFO job queue.
pub struct WorkerPool<J> {
    shared: Arc<Shared<J>>,
    threads: Vec<JoinHandle<()>>,
    worker_count: usize,
    queue_capacity: usize,
}

impl<J: Send + 'static> WorkerPool<J> {
    /// Creates a pool with worker-local state initialized once per thread.
    ///
    /// A panic raised while handling one job is contained at the job boundary;
    /// the same worker state remains available for the next accepted job.
    pub fn new<S, Initialize, Handle>(
        worker_count: usize,
        queue_capacity: usize,
        initialize: Initialize,
        handle: Handle,
    ) -> io::Result<Self>
    where
        S: Send + 'static,
        Initialize: Fn(usize) -> S + Send + Sync + 'static,
        Handle: Fn(&mut S, J) + Send + Sync + 'static,
    {
        Self::new_resumable(
            worker_count,
            queue_capacity,
            initialize,
            move |state, job| {
                handle(state, job);
                JobControl::Complete
            },
        )
    }

    /// Creates a pool whose jobs may yield and rotate behind queued work.
    ///
    /// Resubmission is atomic with taking the next queued job, so it neither
    /// exceeds `queue_capacity` nor fails merely because the queue is full. If
    /// no other job is waiting, the same worker immediately continues the
    /// yielded job. Closing the pool stops further resubmission after the
    /// current turn while still draining jobs accepted from outside the pool.
    pub fn new_resumable<S, Initialize, Handle>(
        worker_count: usize,
        queue_capacity: usize,
        initialize: Initialize,
        handle: Handle,
    ) -> io::Result<Self>
    where
        S: Send + 'static,
        Initialize: Fn(usize) -> S + Send + Sync + 'static,
        Handle: Fn(&mut S, J) -> JobControl<J> + Send + Sync + 'static,
    {
        if worker_count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "worker count must be greater than zero",
            ));
        }
        if queue_capacity == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "queue capacity must be greater than zero",
            ));
        }

        let shared = Arc::new(Shared::new(queue_capacity));
        let initialize = Arc::new(initialize);
        let handle = Arc::new(handle);
        let mut threads = Vec::with_capacity(worker_count);

        for index in 0..worker_count {
            let worker_shared = Arc::clone(&shared);
            let worker_initialize = Arc::clone(&initialize);
            let worker_handle = Arc::clone(&handle);
            let spawn = thread::Builder::new()
                .name(format!("tinytsx-worker-{index}"))
                .spawn(move || {
                    let mut state = worker_initialize(index);
                    while let Some(job) = worker_shared.take() {
                        let mut current = job;
                        loop {
                            let outcome = catch_unwind(AssertUnwindSafe(|| {
                                worker_handle(&mut state, current)
                            }));
                            let Ok(JobControl::Resubmit(job)) = outcome else {
                                break;
                            };
                            let Some(next) = worker_shared.resubmit(job) else {
                                break;
                            };
                            current = next;
                        }
                    }
                });

            match spawn {
                Ok(thread) => threads.push(thread),
                Err(error) => {
                    shared.close();
                    join_threads(&mut threads);
                    return Err(error);
                }
            }
        }

        Ok(Self {
            shared,
            threads,
            worker_count,
            queue_capacity,
        })
    }

    /// Attempts to enqueue a job without waiting for capacity.
    pub fn try_submit(&self, job: J) -> Result<(), SubmitError<J>> {
        self.shared.try_submit(job)
    }

    /// Rejects future submissions while allowing accepted jobs to drain.
    pub fn close(&self) {
        self.shared.close();
    }

    /// Closes the queue, drains accepted jobs, and joins every native thread.
    pub fn join(mut self) {
        self.close();
        join_threads(&mut self.threads);
    }

    /// Returns the fixed number of executor threads.
    pub fn worker_count(&self) -> usize {
        self.worker_count
    }

    /// Returns the maximum number of jobs waiting outside active handlers.
    pub fn queue_capacity(&self) -> usize {
        self.queue_capacity
    }
}

impl<J> Drop for WorkerPool<J> {
    fn drop(&mut self) {
        self.shared.close();
        join_threads(&mut self.threads);
    }
}

struct Shared<J> {
    queue: Mutex<Queue<J>>,
    available: Condvar,
}

impl<J> Shared<J> {
    fn new(capacity: usize) -> Self {
        Self {
            queue: Mutex::new(Queue {
                jobs: VecDeque::with_capacity(capacity),
                capacity,
                closed: false,
            }),
            available: Condvar::new(),
        }
    }

    fn try_submit(&self, job: J) -> Result<(), SubmitError<J>> {
        let mut queue = lock(&self.queue);
        if queue.closed {
            return Err(SubmitError::Closed(job));
        }
        if queue.jobs.len() == queue.capacity {
            return Err(SubmitError::Full(job));
        }
        queue.jobs.push_back(job);
        self.available.notify_one();
        Ok(())
    }

    fn take(&self) -> Option<J> {
        let mut queue = lock(&self.queue);
        loop {
            if let Some(job) = queue.jobs.pop_front() {
                return Some(job);
            }
            if queue.closed {
                return None;
            }
            queue = self
                .available
                .wait(queue)
                .unwrap_or_else(|error| error.into_inner());
        }
    }

    fn resubmit(&self, job: J) -> Option<J> {
        let mut queue = lock(&self.queue);
        if queue.closed {
            return None;
        }
        let Some(next) = queue.jobs.pop_front() else {
            return Some(job);
        };
        queue.jobs.push_back(job);
        Some(next)
    }

    fn close(&self) {
        let mut queue = lock(&self.queue);
        queue.closed = true;
        self.available.notify_all();
    }
}

struct Queue<J> {
    jobs: VecDeque<J>,
    capacity: usize,
    closed: bool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

fn join_threads(threads: &mut Vec<JoinHandle<()>>) {
    for thread in threads.drain(..) {
        let _ = thread.join();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            Arc, Condvar, Mutex,
            atomic::{AtomicUsize, Ordering},
            mpsc,
        },
        time::Duration,
    };

    use super::{JobControl, SubmitError, WorkerPool};

    #[test]
    fn rejects_zero_workers_or_queue_capacity() {
        assert!(WorkerPool::<()>::new(0, 1, |_| (), |_, _| {}).is_err());
        assert!(WorkerPool::<()>::new(1, 0, |_| (), |_, _| {}).is_err());
    }

    #[test]
    fn executes_jobs_in_parallel() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (started_tx, started_rx) = mpsc::channel();
        let pool = WorkerPool::new(2, 2, |_| (), {
            let gate = Arc::clone(&gate);
            move |_, job| {
                started_tx.send(job).expect("report started job");
                let (open, changed) = &*gate;
                let mut open = open.lock().expect("lock gate");
                while !*open {
                    open = changed.wait(open).expect("wait for gate");
                }
            }
        })
        .expect("create worker pool");

        pool.try_submit(1).expect("submit first job");
        pool.try_submit(2).expect("submit second job");
        let first = started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("first job started");
        let second = started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("second job started in parallel");
        assert_ne!(first, second);

        let (open, changed) = &*gate;
        *open.lock().expect("lock gate") = true;
        changed.notify_all();
        pool.join();
    }

    #[test]
    fn returns_jobs_when_the_queue_is_full_or_closed() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (started_tx, started_rx) = mpsc::channel();
        let pool = WorkerPool::new(1, 1, |_| (), {
            let gate = Arc::clone(&gate);
            move |_, job| {
                started_tx.send(job).expect("report started job");
                let (open, changed) = &*gate;
                let mut open = open.lock().expect("lock gate");
                while !*open {
                    open = changed.wait(open).expect("wait for gate");
                }
            }
        })
        .expect("create worker pool");

        pool.try_submit(10).expect("submit active job");
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)), Ok(10));
        pool.try_submit(20).expect("fill waiting queue");
        assert_eq!(pool.try_submit(30), Err(SubmitError::Full(30)));
        pool.close();
        assert_eq!(pool.try_submit(40), Err(SubmitError::Closed(40)));

        let (open, changed) = &*gate;
        *open.lock().expect("lock gate") = true;
        changed.notify_all();
        pool.join();
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)), Ok(20));
    }

    #[test]
    fn preserves_worker_local_state() {
        let (state_tx, state_rx) = mpsc::channel();
        let pool = WorkerPool::new(
            1,
            4,
            |_| 0_usize,
            move |count, job| {
                *count += 1;
                state_tx.send((job, *count)).expect("report state");
            },
        )
        .expect("create worker pool");

        for job in 0..4 {
            pool.try_submit(job).expect("submit stateful job");
        }
        pool.join();

        let observed = state_rx.iter().collect::<Vec<_>>();
        assert_eq!(observed, vec![(0, 1), (1, 2), (2, 3), (3, 4)]);
    }

    #[test]
    fn a_panicking_job_does_not_poison_the_worker() {
        let (completed_tx, completed_rx) = mpsc::channel();
        let pool = WorkerPool::new(
            1,
            2,
            |_| (),
            move |_, job| {
                if job == 1 {
                    panic!("contained test panic");
                }
                completed_tx.send(job).expect("report completed job");
            },
        )
        .expect("create worker pool");

        pool.try_submit(1).expect("submit panicking job");
        pool.try_submit(2).expect("submit recovery job");
        assert_eq!(completed_rx.recv_timeout(Duration::from_secs(1)), Ok(2));
        pool.join();
    }

    #[test]
    fn join_drains_every_accepted_job() {
        let completed = Arc::new(AtomicUsize::new(0));
        let pool = WorkerPool::new(2, 8, |_| (), {
            let completed = Arc::clone(&completed);
            move |_, _| {
                completed.fetch_add(1, Ordering::Relaxed);
            }
        })
        .expect("create worker pool");

        for job in 0..8 {
            pool.try_submit(job).expect("submit draining job");
        }
        assert_eq!(pool.worker_count(), 2);
        assert_eq!(pool.queue_capacity(), 8);
        pool.join();
        assert_eq!(completed.load(Ordering::Relaxed), 8);
    }

    #[test]
    fn resumable_jobs_rotate_behind_the_bounded_queue() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (started_tx, started_rx) = mpsc::channel();
        let pool = WorkerPool::new_resumable(1, 1, |_| (), {
            let gate = Arc::clone(&gate);
            move |_, (job, turns)| {
                started_tx.send(job).expect("report job turn");
                if job == 1 && turns == 2 {
                    let (open, changed) = &*gate;
                    let mut open = open.lock().expect("lock gate");
                    while !*open {
                        open = changed.wait(open).expect("wait for gate");
                    }
                }
                if turns == 1 {
                    JobControl::Complete
                } else {
                    JobControl::Resubmit((job, turns - 1))
                }
            }
        })
        .expect("create resumable pool");

        pool.try_submit((1, 2)).expect("submit active job");
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)), Ok(1));
        pool.try_submit((2, 1)).expect("fill waiting queue");
        assert_eq!(pool.try_submit((3, 1)), Err(SubmitError::Full((3, 1))));

        let (open, changed) = &*gate;
        *open.lock().expect("lock gate") = true;
        changed.notify_all();

        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)), Ok(2));
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)), Ok(1));
        pool.join();
    }

    #[test]
    fn close_stops_a_live_job_at_its_resubmission_boundary() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let turns = Arc::new(AtomicUsize::new(0));
        let (started_tx, started_rx) = mpsc::channel();
        let pool = WorkerPool::new_resumable(1, 1, |_| (), {
            let gate = Arc::clone(&gate);
            let turns = Arc::clone(&turns);
            move |_, job| {
                turns.fetch_add(1, Ordering::Relaxed);
                started_tx.send(()).expect("report job turn");
                let (open, changed) = &*gate;
                let mut open = open.lock().expect("lock gate");
                while !*open {
                    open = changed.wait(open).expect("wait for gate");
                }
                JobControl::Resubmit(job)
            }
        })
        .expect("create resumable pool");

        pool.try_submit(()).expect("submit live job");
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)), Ok(()));
        pool.close();
        let (open, changed) = &*gate;
        *open.lock().expect("lock gate") = true;
        changed.notify_all();
        pool.join();

        assert_eq!(turns.load(Ordering::Relaxed), 1);
    }
}
