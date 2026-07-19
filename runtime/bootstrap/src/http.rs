mod connection;
mod request;
mod response;

use std::{
    io::{self, ErrorKind},
    net::TcpListener,
    os::fd::AsRawFd,
};

use tinytsx_runtime_worker::{EventControl, EventWorkerPool};

use crate::abi::{RequestArena, configured_port, configured_request_memory, configured_workers};
use crate::shutdown;
use connection::{Connection, Turn, write_overload_response};

const CONNECTION_QUEUE_PER_WORKER: usize = 64;
const ACCEPT_POLL_TIMEOUT_MS: i32 = 100;

struct HttpWorker {
    request_arena: RequestArena,
}

pub fn serve() -> std::io::Result<()> {
    let port = configured_port();
    let workers = configured_workers();
    let request_memory = configured_request_memory();
    let queue_capacity = workers
        .checked_mul(CONNECTION_QUEUE_PER_WORKER)
        .ok_or_else(|| std::io::Error::other("connection queue capacity overflow"))?;
    let pool = EventWorkerPool::new(
        workers,
        queue_capacity,
        move |_| HttpWorker {
            request_arena: RequestArena::new(request_memory),
        },
        Connection::descriptor,
        |worker, mut connection: Connection| match connection.handle_turn(&mut worker.request_arena)
        {
            Ok(Turn::Complete) => EventControl::Complete,
            Ok(Turn::Ready) => EventControl::Ready(connection),
            Ok(Turn::WaitReadable) => EventControl::WaitReadable(connection),
            Err(error) => {
                eprintln!("request error: {error}");
                EventControl::Complete
            }
        },
    )?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    println!("TinyTSX listening on http://127.0.0.1:{port}");
    println!("Workers: {workers}; live connections: {queue_capacity}");

    while !shutdown::requested() {
        if !descriptor_ready(&listener, ACCEPT_POLL_TIMEOUT_MS)? {
            continue;
        }
        loop {
            match listener.accept() {
                Ok((stream, _address)) => {
                    // macOS may propagate the listener's nonblocking flag to an
                    // accepted socket. Request workers use bounded blocking I/O.
                    stream.set_nonblocking(false)?;
                    match Connection::new(stream) {
                        Ok(connection) => {
                            if let Err(rejected) = pool.try_wait(connection) {
                                let mut rejected = rejected.into_inner().into_stream();
                                if let Err(error) = write_overload_response(&mut rejected) {
                                    eprintln!("overload response error: {error}");
                                }
                            }
                        }
                        Err(error) => eprintln!("connection setup error: {error}"),
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    eprintln!("accept error: {error}");
                    break;
                }
            }
        }
    }
    println!("TinyTSX shutting down");
    pool.join();
    Ok(())
}

fn descriptor_ready(listener: &TcpListener, timeout_ms: i32) -> io::Result<bool> {
    let mut descriptor = libc::pollfd {
        fd: listener.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    loop {
        // SAFETY: `descriptor` is one initialized poll entry borrowed for this call.
        let result = unsafe { libc::poll(&mut descriptor, 1, timeout_ms) };
        if result > 0 {
            return Ok(true);
        }
        if result == 0 {
            return Ok(false);
        }
        let error = io::Error::last_os_error();
        if error.kind() != ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

#[cfg(test)]
mod tests;
