mod connection;
mod request;
mod response;

use std::{io::ErrorKind, net::TcpListener, thread, time::Duration};

use tinytsx_runtime_worker::{JobControl, WorkerPool};

use crate::abi::{RequestArena, configured_port, configured_request_memory, configured_workers};
use crate::shutdown;
use connection::{Connection, Turn, write_overload_response};

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
    let pool = WorkerPool::new_resumable(
        workers,
        queue_capacity,
        move |_| HttpWorker {
            request_arena: RequestArena::new(request_memory),
        },
        |worker, mut connection: Connection| match connection.handle_turn(&mut worker.request_arena)
        {
            Ok(Turn::Complete) => JobControl::Complete,
            Ok(Turn::Resubmit) => JobControl::Resubmit(connection),
            Err(error) => {
                eprintln!("request error: {error}");
                JobControl::Complete
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
                match Connection::new(stream) {
                    Ok(connection) => {
                        if let Err(rejected) = pool.try_submit(connection) {
                            let mut rejected = rejected.into_inner().into_stream();
                            if let Err(error) = write_overload_response(&mut rejected) {
                                eprintln!("overload response error: {error}");
                            }
                        }
                    }
                    Err(error) => eprintln!("connection setup error: {error}"),
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
