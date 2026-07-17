mod connection;
mod request;
mod response;

use std::{
    io::ErrorKind,
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};

use tinytsx_runtime_worker::WorkerPool;

use crate::abi::{RequestArena, configured_port, configured_request_memory, configured_workers};
use crate::shutdown;
use connection::{handle_connection, write_overload_response};

const CONNECTION_QUEUE_PER_WORKER: usize = 64;

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
    let pool = WorkerPool::new(
        workers,
        queue_capacity,
        move |_| HttpWorker {
            request_arena: RequestArena::new(request_memory),
        },
        |worker, mut stream: TcpStream| {
            if let Err(error) = handle_connection(&mut stream, &mut worker.request_arena) {
                eprintln!("request error: {error}");
            }
        },
    )?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    println!("TinyTSX listening on http://127.0.0.1:{port}");
    println!("Workers: {workers}; queued connections: {queue_capacity}");

    while !shutdown::requested() {
        match listener.accept() {
            Ok((stream, _address)) => {
                // macOS may propagate the listener's nonblocking flag to an
                // accepted socket. Request workers use bounded blocking I/O.
                stream.set_nonblocking(false)?;
                if let Err(rejected) = pool.try_submit(stream) {
                    let mut rejected = rejected.into_inner();
                    if let Err(error) = write_overload_response(&mut rejected) {
                        eprintln!("overload response error: {error}");
                    }
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => eprintln!("accept error: {error}"),
        }
    }
    println!("TinyTSX shutting down");
    pool.join();
    Ok(())
}
