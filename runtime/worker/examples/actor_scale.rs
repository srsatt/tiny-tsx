use std::{
    env,
    io::{self, Write},
    mem,
    time::Instant,
};

use tinytsx_runtime_worker::{ApplicationPool, LogicalWorker};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let actor_count = argument(1, 10_000)?;
    let executor_count = argument(2, 2)?;
    let started = Instant::now();
    let pool = ApplicationPool::new(
        executor_count,
        64,
        64,
        |_| (),
        |_, message: usize| message,
    )?;
    let actors = (0..actor_count).map(|_| pool.spawn()).collect::<Vec<_>>();
    let spawn_micros = started.elapsed().as_micros();

    println!(
        "{{\"actors\":{actor_count},\"executors\":{},\"logicalHandleBytes\":{},\"spawnMicros\":{spawn_micros},\"pid\":{}}}",
        pool.executor_count(),
        mem::size_of::<LogicalWorker<(), usize, usize>>(),
        std::process::id(),
    );
    io::stdout().flush()?;

    let mut release = String::new();
    io::stdin().read_line(&mut release)?;
    drop(actors);
    pool.join();
    Ok(())
}

fn argument(index: usize, default: usize) -> Result<usize, Box<dyn std::error::Error>> {
    env::args()
        .nth(index)
        .map_or(Ok(default), |value| Ok(value.parse()?))
}
