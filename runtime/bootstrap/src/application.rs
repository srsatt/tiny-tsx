use std::{io, sync::OnceLock};

use tinytsx_runtime_worker::{ApplicationPool, LogicalWorker};

use crate::abi::{
    APPLICATION_OVERLOAD, INTERNAL_ERROR, configured_worker_modules, worker_operation,
};

const APPLICATION_QUEUE_PER_EXECUTOR: usize = 64;
const WORKER_MAILBOX_CAPACITY: usize = 64;
const MAX_WORKER_MESSAGE_BYTES: usize = 4096;

type WorkerReply = Result<Vec<u8>, u32>;
type Pool = ApplicationPool<WorkerState, Vec<u8>, WorkerReply>;
type Worker = LogicalWorker<WorkerState, Vec<u8>, WorkerReply>;

struct WorkerState {
    operation: u32,
}

struct ApplicationRuntime {
    _pool: Pool,
    workers: Vec<Worker>,
}

static APPLICATION: OnceLock<ApplicationRuntime> = OnceLock::new();

pub fn initialize(executor_count: usize) -> io::Result<usize> {
    let worker_count = configured_worker_modules();
    if worker_count == 0 {
        return Ok(0);
    }
    let queue_capacity = executor_count
        .checked_mul(APPLICATION_QUEUE_PER_EXECUTOR)
        .ok_or_else(|| io::Error::other("application queue capacity overflow"))?;
    let pool = ApplicationPool::new(
        executor_count,
        queue_capacity,
        WORKER_MAILBOX_CAPACITY,
        |id| WorkerState {
            operation: worker_operation(id),
        },
        |state, mut input: Vec<u8>| match state.operation {
            1 => {
                input
                    .iter_mut()
                    .for_each(|byte| byte.make_ascii_uppercase());
                Ok(input)
            }
            _ => Err(INTERNAL_ERROR),
        },
    )?;
    let workers = (0..worker_count).map(|_| pool.spawn()).collect();
    APPLICATION
        .set(ApplicationRuntime {
            _pool: pool,
            workers,
        })
        .map_err(|_| io::Error::other("application pool was already initialized"))?;
    Ok(worker_count)
}

pub fn call(worker: usize, input: &[u8]) -> Result<Vec<u8>, u32> {
    if input.len() > MAX_WORKER_MESSAGE_BYTES {
        return Err(APPLICATION_OVERLOAD);
    }
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let worker = runtime.workers.get(worker).ok_or(INTERNAL_ERROR)?;
    worker
        .call(input.to_vec())
        .map_err(|_| APPLICATION_OVERLOAD)?
}
