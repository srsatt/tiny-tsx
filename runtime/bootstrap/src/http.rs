mod connection;
mod request;
mod response;

use std::net::{TcpListener, TcpStream};

use tinytsx_runtime_worker::WorkerPool;

use crate::abi::{RequestArena, configured_port, configured_request_memory, configured_workers};
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
    println!("TinyTSX listening on http://127.0.0.1:{port}");
    println!("Workers: {workers}; queued connections: {queue_capacity}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(rejected) = pool.try_submit(stream) {
                    let mut stream = rejected.into_inner();
                    if let Err(error) = write_overload_response(&mut stream) {
                        eprintln!("overload response error: {error}");
                    }
                }
            }
            Err(error) => eprintln!("accept error: {error}"),
        }
    }
    Ok(())
}
