use std::{
    collections::VecDeque,
    io,
    os::{
        fd::{AsRawFd, RawFd},
        unix::net::UnixStream,
    },
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
    },
    thread::{self, JoinHandle},
};

use super::SubmitError;

const JOBS_PER_CYCLE: usize = 64;

/// The disposition of a descriptor-backed job after one executor turn.
pub enum EventControl<J> {
    /// The job is finished and releases its bounded admission slot.
    Complete,
    /// The job has buffered work and should rotate through the local ready queue.
    Ready(J),
    /// The job should sleep in its shard until its descriptor is readable.
    WaitReadable(J),
}

/// A bounded set of connection-owning I/O shards.
///
/// Each native thread owns its waiting descriptors, ready queue, and caller
/// state. Submissions cross one bounded channel and wake descriptor; ordinary
/// readiness and resubmission never cross a global reactor or mutex.
pub struct EventWorkerPool<J> {
    shards: Vec<ShardSender<J>>,
    threads: Vec<JoinHandle<()>>,
    closed: Arc<AtomicBool>,
    live: Arc<AtomicUsize>,
    next_shard: AtomicUsize,
    worker_count: usize,
    capacity: usize,
}

impl<J: Send + 'static> EventWorkerPool<J> {
    pub fn new<S, Initialize, Descriptor, Handle>(
        worker_count: usize,
        capacity: usize,
        initialize: Initialize,
        descriptor: Descriptor,
        handle: Handle,
    ) -> io::Result<Self>
    where
        S: Send + 'static,
        Initialize: Fn(usize) -> S + Send + Sync + 'static,
        Descriptor: Fn(&J) -> RawFd + Send + Sync + 'static,
        Handle: Fn(&mut S, J, bool) -> EventControl<J> + Send + Sync + 'static,
    {
        if worker_count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "worker count must be greater than zero",
            ));
        }
        if capacity == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "event job capacity must be greater than zero",
            ));
        }

        let closed = Arc::new(AtomicBool::new(false));
        let live = Arc::new(AtomicUsize::new(0));
        let initialize = Arc::new(initialize);
        let descriptor = Arc::new(descriptor);
        let handle = Arc::new(handle);
        let channel_capacity = capacity.div_ceil(worker_count).max(1);
        let mut shards = Vec::with_capacity(worker_count);
        let mut threads = Vec::with_capacity(worker_count);

        for index in 0..worker_count {
            let (sender, receiver) = mpsc::sync_channel(channel_capacity);
            let (wake_read, wake_write) = UnixStream::pair()?;
            wake_read.set_nonblocking(true)?;
            wake_write.set_nonblocking(true)?;
            let shard_closed = Arc::clone(&closed);
            let shard_live = Arc::clone(&live);
            let shard_initialize = Arc::clone(&initialize);
            let shard_descriptor = Arc::clone(&descriptor);
            let shard_handle = Arc::clone(&handle);
            let spawn = thread::Builder::new()
                .name(format!("tinytsx-io-shard-{index}"))
                .spawn(move || {
                    let mut state = shard_initialize(index);
                    shard_loop(
                        &mut state,
                        receiver,
                        wake_read,
                        ShardRuntime {
                            closed: shard_closed,
                            live: shard_live,
                            worker_count,
                            descriptor: shard_descriptor,
                            handle: shard_handle,
                        },
                    );
                });
            match spawn {
                Ok(thread) => {
                    shards.push(ShardSender { sender, wake_write });
                    threads.push(thread);
                }
                Err(error) => {
                    closed.store(true, Ordering::Release);
                    wake_shards(&shards);
                    join_threads(&mut threads);
                    return Err(error);
                }
            }
        }

        Ok(Self {
            shards,
            threads,
            closed,
            live,
            next_shard: AtomicUsize::new(0),
            worker_count,
            capacity,
        })
    }

    /// Registers a live descriptor with one shard without blocking.
    pub fn try_wait(&self, job: J) -> Result<(), SubmitError<J>> {
        if self.closed.load(Ordering::Acquire) {
            return Err(SubmitError::Closed(job));
        }
        if self
            .live
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |live| {
                (live < self.capacity).then_some(live + 1)
            })
            .is_err()
        {
            return Err(SubmitError::Full(job));
        }
        if self.closed.load(Ordering::Acquire) {
            self.live.fetch_sub(1, Ordering::AcqRel);
            return Err(SubmitError::Closed(job));
        }

        let start = self.next_shard.fetch_add(1, Ordering::Relaxed) % self.shards.len();
        let mut job = job;
        let mut disconnected = false;
        for offset in 0..self.shards.len() {
            let shard = &self.shards[(start + offset) % self.shards.len()];
            match shard.sender.try_send(job) {
                Ok(()) => {
                    shard.wake();
                    return Ok(());
                }
                Err(TrySendError::Full(returned)) => job = returned,
                Err(TrySendError::Disconnected(returned)) => {
                    disconnected = true;
                    job = returned;
                }
            }
        }
        self.live.fetch_sub(1, Ordering::AcqRel);
        if disconnected || self.closed.load(Ordering::Acquire) {
            Err(SubmitError::Closed(job))
        } else {
            Err(SubmitError::Full(job))
        }
    }

    pub fn close(&self) {
        if !self.closed.swap(true, Ordering::AcqRel) {
            wake_shards(&self.shards);
        }
    }

    pub fn join(mut self) {
        self.close();
        join_threads(&mut self.threads);
    }

    pub fn worker_count(&self) -> usize {
        self.worker_count
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

impl<J> Drop for EventWorkerPool<J> {
    fn drop(&mut self) {
        if !self.closed.swap(true, Ordering::AcqRel) {
            wake_shards(&self.shards);
        }
        join_threads(&mut self.threads);
    }
}

struct ShardSender<J> {
    sender: SyncSender<J>,
    wake_write: UnixStream,
}

struct ShardRuntime<Descriptor, Handle> {
    closed: Arc<AtomicBool>,
    live: Arc<AtomicUsize>,
    worker_count: usize,
    descriptor: Arc<Descriptor>,
    handle: Arc<Handle>,
}

impl<J> ShardSender<J> {
    fn wake(&self) {
        let byte = [1_u8];
        // SAFETY: the stream owns this descriptor for the lifetime of the shard.
        let _ = unsafe {
            libc::write(
                self.wake_write.as_raw_fd(),
                byte.as_ptr().cast(),
                byte.len(),
            )
        };
    }
}

fn shard_loop<J, S, Descriptor, Handle>(
    state: &mut S,
    receiver: Receiver<J>,
    wake_read: UnixStream,
    runtime: ShardRuntime<Descriptor, Handle>,
) where
    J: Send + 'static,
    Descriptor: Fn(&J) -> RawFd + Send + Sync + 'static,
    Handle: Fn(&mut S, J, bool) -> EventControl<J> + Send + Sync + 'static,
{
    let mut waiting = Vec::new();
    let mut ready = VecDeque::new();
    let mut descriptors = Vec::new();

    while !runtime.closed.load(Ordering::Acquire) {
        descriptors.clear();
        descriptors.push(libc::pollfd {
            fd: wake_read.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        });
        descriptors.extend(waiting.iter().map(|job| libc::pollfd {
            fd: (runtime.descriptor)(job),
            events: libc::POLLIN,
            revents: 0,
        }));
        let timeout = if ready.is_empty() { -1 } else { 0 };
        // SAFETY: `descriptors` remains a valid mutable poll array for this call.
        let result = unsafe {
            libc::poll(
                descriptors.as_mut_ptr(),
                descriptors.len() as libc::nfds_t,
                timeout,
            )
        };
        if result < 0 {
            if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                continue;
            }
            break;
        }
        if descriptors[0].revents != 0 {
            drain_wake(wake_read.as_raw_fd());
            drain_inbox(&receiver, &mut waiting);
        }
        if runtime.closed.load(Ordering::Acquire) {
            break;
        }
        for index in (1..descriptors.len()).rev() {
            if descriptors[index].revents != 0 {
                ready.push_back(waiting.swap_remove(index - 1));
            }
        }

        for _ in 0..JOBS_PER_CYCLE {
            let Some(job) = ready.pop_front() else {
                break;
            };
            let contended = runtime.live.load(Ordering::Acquire) > runtime.worker_count;
            let outcome = catch_unwind(AssertUnwindSafe(|| {
                (runtime.handle)(state, job, contended)
            }));
            match outcome.unwrap_or(EventControl::Complete) {
                EventControl::Complete => {
                    runtime.live.fetch_sub(1, Ordering::AcqRel);
                }
                EventControl::Ready(job) => ready.push_back(job),
                EventControl::WaitReadable(job) => waiting.push(job),
            }
        }
    }
}

fn drain_inbox<J>(receiver: &Receiver<J>, waiting: &mut Vec<J>) {
    while let Ok(job) = receiver.try_recv() {
        waiting.push(job);
    }
}

fn wake_shards<J>(shards: &[ShardSender<J>]) {
    for shard in shards {
        shard.wake();
    }
}

fn drain_wake(descriptor: RawFd) {
    let mut bytes = [0_u8; 64];
    loop {
        // SAFETY: `bytes` is writable and the descriptor is the shard's stream.
        let read = unsafe { libc::read(descriptor, bytes.as_mut_ptr().cast(), bytes.len()) };
        if read <= 0 {
            break;
        }
    }
}

fn join_threads(threads: &mut Vec<JoinHandle<()>>) {
    for thread in threads.drain(..) {
        let _ = thread.join();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        os::unix::net::UnixStream,
        sync::mpsc,
        time::Duration,
    };

    use super::{EventControl, EventWorkerPool};
    use crate::SubmitError;

    #[test]
    fn an_idle_descriptor_does_not_occupy_the_only_shard() {
        let (idle_server, _idle_client) = UnixStream::pair().expect("create idle socket pair");
        let (ready_server, mut ready_client) =
            UnixStream::pair().expect("create ready socket pair");
        let (completed_tx, completed_rx) = mpsc::channel();
        let pool = EventWorkerPool::new(
            1,
            2,
            |_| (),
            |stream: &UnixStream| std::os::fd::AsRawFd::as_raw_fd(stream),
            move |_, mut stream: UnixStream, contended| {
                let mut byte = [0_u8; 1];
                stream.read_exact(&mut byte).expect("read ready byte");
                completed_tx
                    .send((byte[0], contended))
                    .expect("report ready job");
                EventControl::Complete
            },
        )
        .expect("create event worker pool");

        pool.try_wait(idle_server).expect("register idle socket");
        pool.try_wait(ready_server).expect("register ready socket");
        ready_client
            .write_all(b"x")
            .expect("make second socket ready");

        assert_eq!(
            completed_rx.recv_timeout(Duration::from_secs(1)),
            Ok((b'x', true))
        );
        pool.join();
    }

    #[test]
    fn admission_is_bounded_before_a_descriptor_becomes_ready() {
        let (accepted, _accepted_peer) = UnixStream::pair().expect("accepted pair");
        let (rejected, _rejected_peer) = UnixStream::pair().expect("rejected pair");
        let pool = EventWorkerPool::new(
            1,
            1,
            |_| (),
            |stream: &UnixStream| std::os::fd::AsRawFd::as_raw_fd(stream),
            |_, _stream, _| EventControl::Complete,
        )
        .expect("create event worker pool");

        assert!(pool.try_wait(accepted).is_ok());
        assert!(matches!(pool.try_wait(rejected), Err(SubmitError::Full(_))));
        pool.join();
    }
}
