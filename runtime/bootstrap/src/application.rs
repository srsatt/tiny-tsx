use std::{
    io,
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

use tinytsx_runtime_worker::{ApplicationPool, LogicalWorker};

use crate::abi::{
    APPLICATION_OVERLOAD, INTERNAL_ERROR, OpenAiTransport, configured_provider_transport,
    configured_worker_modules, worker_operation,
};

const APPLICATION_QUEUE_PER_EXECUTOR: usize = 64;
const WORKER_MAILBOX_CAPACITY: usize = 64;
const MAX_WORKER_MESSAGE_BYTES: usize = 4096;

type WorkerReply = Result<Vec<u8>, u32>;
type Pool = ApplicationPool<WorkerState, ApplicationMessage, WorkerReply>;
type Worker = LogicalWorker<WorkerState, ApplicationMessage, WorkerReply>;

enum ApplicationMessage {
    Worker(Vec<u8>),
    OpenAi(OpenAiRequest),
    ReadFile(ReadFileRequest),
}

pub struct OpenAiRequest {
    pub url: Vec<u8>,
    pub authorization: Vec<u8>,
    pub body: Vec<u8>,
}

struct ReadFileRequest {
    path: Vec<u8>,
    max_bytes: usize,
}

struct WorkerState {
    operation: u32,
    provider: OpenAiTransport,
}

struct ApplicationRuntime {
    _pool: Pool,
    workers: Vec<Worker>,
    providers: Vec<Worker>,
    files: Vec<Worker>,
    next_provider: AtomicUsize,
    next_file: AtomicUsize,
}

static APPLICATION: OnceLock<ApplicationRuntime> = OnceLock::new();

pub fn initialize(executor_count: usize) -> io::Result<(usize, bool, bool)> {
    let worker_count = configured_worker_modules();
    let provider_enabled = configured_provider_transport();
    let filesystem_enabled = crate::filesystem::enabled();
    if worker_count == 0 && !provider_enabled && !filesystem_enabled {
        return Ok((0, false, false));
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
            provider: OpenAiTransport::default(),
        },
        |state, message| match message {
            ApplicationMessage::Worker(mut input) => match state.operation {
                1 => {
                    input
                        .iter_mut()
                        .for_each(|byte| byte.make_ascii_uppercase());
                    Ok(input)
                }
                _ => Err(INTERNAL_ERROR),
            },
            ApplicationMessage::OpenAi(request) => {
                state
                    .provider
                    .perform(&request.url, &request.authorization, &request.body)
            }
            ApplicationMessage::ReadFile(request) => {
                crate::filesystem::read_text(&request.path, request.max_bytes)
            }
        },
    )?;
    let workers = (0..worker_count).map(|_| pool.spawn()).collect();
    let providers = if provider_enabled {
        (0..executor_count).map(|_| pool.spawn()).collect()
    } else {
        Vec::new()
    };
    let files = if filesystem_enabled {
        (0..executor_count).map(|_| pool.spawn()).collect()
    } else {
        Vec::new()
    };
    APPLICATION
        .set(ApplicationRuntime {
            _pool: pool,
            workers,
            providers,
            files,
            next_provider: AtomicUsize::new(0),
            next_file: AtomicUsize::new(0),
        })
        .map_err(|_| io::Error::other("application pool was already initialized"))?;
    Ok((worker_count, provider_enabled, filesystem_enabled))
}

pub fn call(worker: usize, input: &[u8]) -> Result<Vec<u8>, u32> {
    if input.len() > MAX_WORKER_MESSAGE_BYTES {
        return Err(APPLICATION_OVERLOAD);
    }
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let worker = runtime.workers.get(worker).ok_or(INTERNAL_ERROR)?;
    worker
        .call(ApplicationMessage::Worker(input.to_vec()))
        .map_err(|_| APPLICATION_OVERLOAD)?
}

pub fn call_openai(request: OpenAiRequest) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    if runtime.providers.is_empty() {
        return Err(INTERNAL_ERROR);
    }
    let index = runtime.next_provider.fetch_add(1, Ordering::Relaxed) % runtime.providers.len();
    runtime.providers[index]
        .call(ApplicationMessage::OpenAi(request))
        .map_err(|_| APPLICATION_OVERLOAD)?
}

pub fn read_file(path: &[u8], max_bytes: usize) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    if runtime.files.is_empty() {
        return Err(INTERNAL_ERROR);
    }
    let index = runtime.next_file.fetch_add(1, Ordering::Relaxed) % runtime.files.len();
    runtime.files[index]
        .call(ApplicationMessage::ReadFile(ReadFileRequest {
            path: path.to_vec(),
            max_bytes,
        }))
        .map_err(|_| APPLICATION_OVERLOAD)?
}
