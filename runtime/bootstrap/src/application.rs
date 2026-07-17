use std::{
    io,
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

use tinytsx_runtime_sqlite::Connection;
use tinytsx_runtime_worker::{ApplicationPool, CallError, LogicalWorker, PostError};

use crate::abi::{
    APPLICATION_OVERLOAD, INTERNAL_ERROR, OpenAiTransport, RENDER_ERROR, actor_initial_state,
    actor_mailbox_capacity, actor_operation, configured_actors, configured_provider_transport,
    configured_sqlite_databases, configured_worker_modules, worker_operation,
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
    ActorCounter(i64),
    SqliteExecuteBatch(Vec<u8>),
    SqliteExecute {
        sql: Vec<u8>,
        parameter: Vec<u8>,
    },
    SqliteQuery {
        sql: Vec<u8>,
        first: bool,
        parameter: Option<Vec<u8>>,
    },
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
    actor_operation: u32,
    actor_counter: i64,
    provider: OpenAiTransport,
    sqlite: Option<Result<Connection, u32>>,
}

struct ApplicationRuntime {
    _pool: Pool,
    workers: Vec<Worker>,
    providers: Vec<Worker>,
    files: Vec<Worker>,
    actors: Vec<Worker>,
    databases: Vec<Worker>,
    next_provider: AtomicUsize,
    next_file: AtomicUsize,
}

static APPLICATION: OnceLock<ApplicationRuntime> = OnceLock::new();

pub fn initialize(executor_count: usize) -> io::Result<(usize, bool, bool)> {
    let worker_count = configured_worker_modules();
    let provider_enabled = configured_provider_transport();
    let filesystem_enabled = crate::filesystem::enabled();
    let actor_count = configured_actors();
    let database_count = configured_sqlite_databases();
    if worker_count == 0
        && !provider_enabled
        && !filesystem_enabled
        && actor_count == 0
        && database_count == 0
    {
        return Ok((0, false, false));
    }
    let queue_capacity = executor_count
        .checked_mul(APPLICATION_QUEUE_PER_EXECUTOR)
        .ok_or_else(|| io::Error::other("application queue capacity overflow"))?;
    let pool = ApplicationPool::new(
        executor_count,
        queue_capacity,
        WORKER_MAILBOX_CAPACITY,
        move |id| WorkerState {
            operation: worker_operation(id),
            actor_operation: id
                .checked_sub(worker_count)
                .filter(|actor| *actor < actor_count)
                .map_or(0, actor_operation),
            actor_counter: id
                .checked_sub(worker_count)
                .filter(|actor| *actor < actor_count)
                .map_or(0, actor_initial_state),
            provider: OpenAiTransport::default(),
            sqlite: id
                .checked_sub(worker_count + actor_count)
                .filter(|database| *database < database_count)
                .map(|_| tinytsx_runtime_sqlite::open(":memory:").map_err(|_| RENDER_ERROR)),
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
            ApplicationMessage::ActorCounter(delta) => {
                if state.actor_operation != 1 {
                    return Err(INTERNAL_ERROR);
                }
                state.actor_counter = state.actor_counter.checked_add(delta).ok_or(RENDER_ERROR)?;
                Ok(state.actor_counter.to_string().into_bytes())
            }
            ApplicationMessage::SqliteExecuteBatch(sql) => {
                let connection = state
                    .sqlite
                    .as_ref()
                    .ok_or(INTERNAL_ERROR)?
                    .as_ref()
                    .map_err(|status| *status)?;
                let sql = std::str::from_utf8(&sql).map_err(|_| RENDER_ERROR)?;
                tinytsx_runtime_sqlite::execute_batch(connection, sql).map_err(|_| RENDER_ERROR)?;
                Ok(Vec::new())
            }
            ApplicationMessage::SqliteExecute { sql, parameter } => {
                let connection = state
                    .sqlite
                    .as_ref()
                    .ok_or(INTERNAL_ERROR)?
                    .as_ref()
                    .map_err(|status| *status)?;
                let sql = std::str::from_utf8(&sql).map_err(|_| RENDER_ERROR)?;
                tinytsx_runtime_sqlite::execute(
                    connection,
                    sql,
                    &[tinytsx_runtime_sqlite::SqlValue::Text(
                        String::from_utf8(parameter).map_err(|_| RENDER_ERROR)?,
                    )],
                )
                .map(|_| Vec::new())
                .map_err(|_| RENDER_ERROR)
            }
            ApplicationMessage::SqliteQuery {
                sql,
                first,
                parameter,
            } => {
                let connection = state
                    .sqlite
                    .as_ref()
                    .ok_or(INTERNAL_ERROR)?
                    .as_ref()
                    .map_err(|status| *status)?;
                let sql = std::str::from_utf8(&sql).map_err(|_| RENDER_ERROR)?;
                let parameters = parameter
                    .map(|value| {
                        String::from_utf8(value)
                            .map(tinytsx_runtime_sqlite::SqlValue::Text)
                            .map_err(|_| RENDER_ERROR)
                    })
                    .transpose()?;
                tinytsx_runtime_sqlite::query_json(
                    connection,
                    sql,
                    parameters.as_slice(),
                    if first {
                        tinytsx_runtime_sqlite::QueryMode::First
                    } else {
                        tinytsx_runtime_sqlite::QueryMode::All
                    },
                )
                .map_err(|_| RENDER_ERROR)
            }
        },
    )?;
    let workers = (0..worker_count).map(|_| pool.spawn()).collect();
    let actors = (0..actor_count)
        .map(|actor| pool.spawn_with_capacity(actor_mailbox_capacity(actor)))
        .collect::<Result<Vec<_>, _>>()?;
    let databases = (0..database_count).map(|_| pool.spawn()).collect();
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
            actors,
            databases,
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

pub fn ask_actor(actor: usize, message: i64) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let actor = runtime.actors.get(actor).ok_or(INTERNAL_ERROR)?;
    actor
        .call(ApplicationMessage::ActorCounter(message))
        .map_err(actor_call_status)?
}

pub fn tell_actor(actor: usize, message: i64) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(actor) = runtime.actors.get(actor) else {
        return INTERNAL_ERROR;
    };
    match actor.try_post(ApplicationMessage::ActorCounter(message)) {
        Ok(_reply) => 0,
        Err(error) => actor_post_status(error),
    }
}

fn actor_call_status(error: CallError<ApplicationMessage>) -> u32 {
    match error {
        CallError::Post(error) => actor_post_status(error),
        CallError::Reply(_) => RENDER_ERROR,
    }
}

fn actor_post_status(error: PostError<ApplicationMessage>) -> u32 {
    match error {
        PostError::MailboxFull(_) | PostError::PoolFull(_) => APPLICATION_OVERLOAD,
        PostError::Closed(_) | PostError::Terminated(_) => RENDER_ERROR,
    }
}

pub fn stop_actor(actor: usize) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(actor) = runtime.actors.get(actor) else {
        return INTERNAL_ERROR;
    };
    actor.terminate();
    0
}

pub fn sqlite_execute_batch(database: usize, sql: &[u8]) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(database) = runtime.databases.get(database) else {
        return INTERNAL_ERROR;
    };
    match database.call(ApplicationMessage::SqliteExecuteBatch(sql.to_vec())) {
        Ok(Ok(_)) => 0,
        Ok(Err(status)) => status,
        Err(error) => actor_call_status(error),
    }
}

pub fn sqlite_execute(database: usize, sql: &[u8], parameter: Vec<u8>) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(database) = runtime.databases.get(database) else {
        return INTERNAL_ERROR;
    };
    match database.call(ApplicationMessage::SqliteExecute {
        sql: sql.to_vec(),
        parameter,
    }) {
        Ok(Ok(_)) => 0,
        Ok(Err(status)) => status,
        Err(error) => actor_call_status(error),
    }
}

pub fn sqlite_close(database: usize) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(database) = runtime.databases.get(database) else {
        return INTERNAL_ERROR;
    };
    database.terminate();
    0
}

pub fn sqlite_query_json(
    database: usize,
    sql: &[u8],
    first: bool,
    parameter: Option<Vec<u8>>,
) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let database = runtime.databases.get(database).ok_or(INTERNAL_ERROR)?;
    database
        .call(ApplicationMessage::SqliteQuery {
            sql: sql.to_vec(),
            first,
            parameter,
        })
        .map_err(actor_call_status)?
}
