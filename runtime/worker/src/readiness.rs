use std::{
    collections::VecDeque,
    io,
    os::{
        fd::{AsRawFd, RawFd},
        unix::net::UnixStream,
    },
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{Arc, Condvar, Mutex, MutexGuard},
    thread::{self, JoinHandle},
};

use super::SubmitError;

/// The disposition of a descriptor-backed job after one executor turn.
pub enum EventControl<J> {
    /// The job is finished and releases its bounded admission slot.
    Complete,
    /// The job has buffered work and should rotate through the ready queue.
    Ready(J),
    /// The job should sleep in the reactor until its descriptor is readable.
    WaitReadable(J),
}

/// A bounded pool that separates descriptor readiness from job execution.
///
/// One reactor thread owns sleeping jobs. Fixed executor threads only receive
/// ready jobs, so idle descriptors do not consume executor capacity.
pub struct EventWorkerPool<J> {
    shared: Arc<Shared<J>>,
    executors: Vec<JoinHandle<()>>,
    reactor: Option<JoinHandle<()>>,
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
        Handle: Fn(&mut S, J) -> EventControl<J> + Send + Sync + 'static,
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
        let (wake_read, wake_write) = UnixStream::pair()?;
        wake_read.set_nonblocking(true)?;
        wake_write.set_nonblocking(true)?;
        let shared = Arc::new(Shared::new(capacity, wake_write));
        let descriptor = Arc::new(descriptor);
        let reactor = {
            let shared = Arc::clone(&shared);
            let descriptor = Arc::clone(&descriptor);
            Some(
                thread::Builder::new()
                    .name("tinytsx-reactor".to_owned())
                    .spawn(move || reactor_loop(shared, descriptor, wake_read))?,
            )
        };
        let initialize = Arc::new(initialize);
        let handle = Arc::new(handle);
        let mut executors = Vec::with_capacity(worker_count);
        for index in 0..worker_count {
            let worker_shared = Arc::clone(&shared);
            let initialize = Arc::clone(&initialize);
            let handle = Arc::clone(&handle);
            match thread::Builder::new()
                .name(format!("tinytsx-event-worker-{index}"))
                .spawn(move || {
                    let mut state = initialize(index);
                    while let Some(job) = worker_shared.take_ready() {
                        let outcome = catch_unwind(AssertUnwindSafe(|| handle(&mut state, job)));
                        worker_shared.finish(outcome.unwrap_or(EventControl::Complete));
                    }
                }) {
                Ok(thread) => executors.push(thread),
                Err(error) => {
                    shared.close();
                    join_threads(&mut executors);
                    if let Some(reactor) = reactor {
                        let _ = reactor.join();
                    }
                    return Err(error);
                }
            }
        }
        Ok(Self {
            shared,
            executors,
            reactor,
            worker_count,
            capacity,
        })
    }

    /// Registers a live job without assigning it to an executor until readable.
    pub fn try_wait(&self, job: J) -> Result<(), SubmitError<J>> {
        self.shared.try_wait(job)
    }

    pub fn close(&self) {
        self.shared.close();
    }

    pub fn join(mut self) {
        self.close();
        if let Some(reactor) = self.reactor.take() {
            let _ = reactor.join();
        }
        join_threads(&mut self.executors);
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
        self.shared.close();
        if let Some(reactor) = self.reactor.take() {
            let _ = reactor.join();
        }
        join_threads(&mut self.executors);
    }
}

struct Shared<J> {
    state: Mutex<State<J>>,
    ready: Condvar,
    capacity: usize,
    wake_write: UnixStream,
}

struct State<J> {
    ready: VecDeque<J>,
    waiting: Vec<J>,
    live: usize,
    closed: bool,
}

impl<J> Shared<J> {
    fn new(capacity: usize, wake_write: UnixStream) -> Self {
        Self {
            state: Mutex::new(State {
                ready: VecDeque::with_capacity(capacity),
                waiting: Vec::with_capacity(capacity),
                live: 0,
                closed: false,
            }),
            ready: Condvar::new(),
            capacity,
            wake_write,
        }
    }

    fn try_wait(&self, job: J) -> Result<(), SubmitError<J>> {
        let mut state = lock(&self.state);
        if state.closed {
            return Err(SubmitError::Closed(job));
        }
        if state.live == self.capacity {
            return Err(SubmitError::Full(job));
        }
        state.live += 1;
        state.waiting.push(job);
        drop(state);
        self.wake();
        Ok(())
    }

    fn take_ready(&self) -> Option<J> {
        let mut state = lock(&self.state);
        loop {
            if let Some(job) = state.ready.pop_front() {
                return Some(job);
            }
            if state.closed {
                return None;
            }
            state = self
                .ready
                .wait(state)
                .unwrap_or_else(|error| error.into_inner());
        }
    }

    fn finish(&self, control: EventControl<J>) {
        let mut wake = false;
        let mut state = lock(&self.state);
        match control {
            EventControl::Complete => state.live -= 1,
            EventControl::Ready(job) if !state.closed => {
                state.ready.push_back(job);
                self.ready.notify_one();
            }
            EventControl::WaitReadable(job) if !state.closed => {
                state.waiting.push(job);
                wake = true;
            }
            EventControl::Ready(_) | EventControl::WaitReadable(_) => state.live -= 1,
        }
        drop(state);
        if wake {
            self.wake();
        }
    }

    fn close(&self) {
        let mut state = lock(&self.state);
        if state.closed {
            return;
        }
        state.closed = true;
        let waiting = state.waiting.len();
        state.waiting.clear();
        state.live -= waiting;
        self.ready.notify_all();
        drop(state);
        self.wake();
    }

    fn wake(&self) {
        let byte = [1_u8];
        // SAFETY: the stream owns this descriptor for the lifetime of `Shared`.
        let _ = unsafe {
            libc::write(
                self.wake_write.as_raw_fd(),
                byte.as_ptr().cast(),
                byte.len(),
            )
        };
    }
}

fn reactor_loop<J, Descriptor>(
    shared: Arc<Shared<J>>,
    descriptor: Arc<Descriptor>,
    wake_read: UnixStream,
) where
    J: Send + 'static,
    Descriptor: Fn(&J) -> RawFd + Send + Sync + 'static,
{
    loop {
        let mut descriptors = {
            let state = lock(&shared.state);
            if state.closed {
                break;
            }
            let mut descriptors = Vec::with_capacity(state.waiting.len() + 1);
            descriptors.push(libc::pollfd {
                fd: wake_read.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            });
            descriptors.extend(state.waiting.iter().map(|job| libc::pollfd {
                fd: descriptor(job),
                events: libc::POLLIN,
                revents: 0,
            }));
            descriptors
        };
        // SAFETY: `descriptors` is a valid mutable pollfd array for this call.
        let result = unsafe {
            libc::poll(
                descriptors.as_mut_ptr(),
                descriptors.len() as libc::nfds_t,
                -1,
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
        }
        let mut state = lock(&shared.state);
        if state.closed {
            break;
        }
        for index in (1..descriptors.len()).rev() {
            if descriptors[index].revents != 0 && index - 1 < state.waiting.len() {
                let job = state.waiting.swap_remove(index - 1);
                state.ready.push_back(job);
            }
        }
        if !state.ready.is_empty() {
            shared.ready.notify_all();
        }
    }
}

fn drain_wake(descriptor: RawFd) {
    let mut bytes = [0_u8; 64];
    loop {
        // SAFETY: `bytes` is writable and the descriptor is the reactor's stream.
        let read = unsafe { libc::read(descriptor, bytes.as_mut_ptr().cast(), bytes.len()) };
        if read <= 0 {
            break;
        }
    }
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
        io::{Read, Write},
        os::unix::net::UnixStream,
        sync::mpsc,
        time::Duration,
    };

    use super::{EventControl, EventWorkerPool};

    #[test]
    fn an_idle_descriptor_does_not_occupy_the_only_executor() {
        let (idle_server, _idle_client) = UnixStream::pair().expect("create idle socket pair");
        let (ready_server, mut ready_client) =
            UnixStream::pair().expect("create ready socket pair");
        let (completed_tx, completed_rx) = mpsc::channel();
        let pool = EventWorkerPool::new(
            1,
            2,
            |_| (),
            |stream: &UnixStream| std::os::fd::AsRawFd::as_raw_fd(stream),
            move |_, mut stream: UnixStream| {
                let mut byte = [0_u8; 1];
                stream.read_exact(&mut byte).expect("read ready byte");
                completed_tx.send(byte[0]).expect("report ready job");
                EventControl::Complete
            },
        )
        .expect("create event worker pool");

        pool.try_wait(idle_server).expect("register idle socket");
        pool.try_wait(ready_server).expect("register ready socket");
        ready_client
            .write_all(b"x")
            .expect("make second socket ready");

        assert_eq!(completed_rx.recv_timeout(Duration::from_secs(1)), Ok(b'x'));
        pool.join();
    }
}
