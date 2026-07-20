mod connection;
mod request;
mod response;

use std::{
    ffi::OsString,
    io::{self, ErrorKind},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
    os::fd::AsRawFd,
};

use tinytsx_runtime_worker::{EventControl, EventWorkerPool};

use crate::abi::{
    configured_port, configured_request_memory, configured_workers, RequestArena, TinyHeader,
};
use crate::shutdown;
use connection::{write_overload_response, Connection, Turn};

const CONNECTION_QUEUE_PER_WORKER: usize = 64;
const ACCEPT_POLL_TIMEOUT_MS: i32 = 100;

struct HttpWorker {
    request_arena: RequestArena,
    request_headers: Vec<TinyHeader>,
    response_head: Vec<u8>,
}

pub fn serve() -> std::io::Result<()> {
    let port = configured_port();
    let host = listen_host(std::env::var_os("TINYTSX_LISTEN_HOST"))?;
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
            request_headers: Vec::with_capacity(16),
            response_head: Vec::with_capacity(1024),
        },
        Connection::descriptor,
        |worker, mut connection: Connection, contended| match connection.handle_turn(
            &mut worker.request_arena,
            &mut worker.request_headers,
            &mut worker.response_head,
            contended,
        ) {
            Ok(Turn::Complete) => EventControl::Complete,
            Ok(Turn::Ready) => EventControl::Ready(connection),
            Ok(Turn::WaitReadable) => EventControl::WaitReadable(connection),
            Err(error) => {
                eprintln!("request error: {error}");
                EventControl::Complete
            }
        },
    )?;
    let address = SocketAddr::new(host, port);
    let listener = TcpListener::bind(address)?;
    listener.set_nonblocking(true)?;
    println!("TinyTSX listening on http://{address}");
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

fn listen_host(value: Option<OsString>) -> io::Result<IpAddr> {
    let Some(value) = value else {
        return Ok(IpAddr::V4(Ipv4Addr::LOCALHOST));
    };
    let value = value.into_string().map_err(|_| {
        io::Error::new(
            ErrorKind::InvalidInput,
            "TINYTSX_LISTEN_HOST must be valid UTF-8",
        )
    })?;
    value.parse().map_err(|_| {
        io::Error::new(
            ErrorKind::InvalidInput,
            "TINYTSX_LISTEN_HOST must be an IPv4 or IPv6 address",
        )
    })
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
