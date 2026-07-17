use std::{
    io,
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use tinytsx_runtime_sqlite::{Connection, SqlValue};
use tinytsx_runtime_worker::{
    ApplicationPool, CallError, LogicalWorker, PostError, ReplyError, RestartPolicy,
};

use crate::abi::{
    APPLICATION_OVERLOAD, CLIENT_DISCONNECTED, INTERNAL_ERROR, OpenAiTransport, RENDER_ERROR,
    actor_failure_message, actor_initial_json, actor_initial_state, actor_mailbox_capacity,
    actor_operation, actor_persistence_database, actor_persistence_key, actor_restart_max,
    actor_restart_within_ms, configured_actors, configured_provider_transport,
    configured_sqlite_database_path, configured_sqlite_databases, configured_worker_modules,
    worker_operation,
};

const APPLICATION_QUEUE_PER_EXECUTOR: usize = 64;
const WORKER_MAILBOX_CAPACITY: usize = 64;
const MAX_WORKER_MESSAGE_BYTES: usize = 4096;
const ACTOR_REPLY_POLL_INTERVAL: Duration = Duration::from_millis(10);

type WorkerReply = Result<Vec<u8>, u32>;
type Pool = ApplicationPool<WorkerState, ApplicationMessage, WorkerReply>;
type Worker = LogicalWorker<WorkerState, ApplicationMessage, WorkerReply>;

enum ApplicationMessage {
    Worker(Vec<u8>),
    OpenAi(OpenAiRequest),
    ReadFile(ReadFileRequest),
    ActorCounter(i64),
    ActorJson(Vec<u8>),
    SqliteExecuteBatch(Vec<u8>),
    SqliteTransaction(Vec<u8>),
    SqliteExecute {
        sql: Vec<u8>,
        parameters: Vec<tinytsx_runtime_sqlite::SqlValue>,
    },
    SqliteQuery {
        sql: Vec<u8>,
        first: bool,
        parameters: Vec<tinytsx_runtime_sqlite::SqlValue>,
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
    actor_failure_message: i64,
    actor_json: Option<Result<Vec<u8>, u32>>,
    actor_persistence: Option<Result<ActorPersistence, u32>>,
    provider: OpenAiTransport,
    sqlite: Option<Result<Connection, u32>>,
}

struct ActorPersistence {
    connection: Connection,
    key: String,
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

fn initialize_actor_persistence(
    actor: Option<usize>,
    initial_state: i64,
    database_paths: &[String],
) -> (i64, Option<Result<ActorPersistence, u32>>) {
    let Some(actor) = actor else {
        return (initial_state, None);
    };
    let Some(database) = actor_persistence_database(actor) else {
        return (initial_state, None);
    };
    let persistence = (|| {
        let path = database_paths.get(database).ok_or(INTERNAL_ERROR)?;
        let key = actor_persistence_key(actor).map_err(|_| INTERNAL_ERROR)?;
        let key = String::from_utf8(key).map_err(|_| INTERNAL_ERROR)?;
        let connection = tinytsx_runtime_sqlite::open(path).map_err(|_| RENDER_ERROR)?;
        tinytsx_runtime_sqlite::execute_batch(
            &connection,
            "CREATE TABLE IF NOT EXISTS _tinytsx_actor_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL)",
        )
        .map_err(|_| RENDER_ERROR)?;
        let result = tinytsx_runtime_sqlite::query(
            &connection,
            "SELECT value FROM _tinytsx_actor_state WHERE key = ?1",
            &[SqlValue::Text(key.clone())],
            1,
            128,
        )
        .map_err(|_| RENDER_ERROR)?;
        let state = match result.rows.first().and_then(|row| row.first()) {
            Some(SqlValue::Integer(value)) => *value,
            Some(_) => return Err(RENDER_ERROR),
            None => {
                tinytsx_runtime_sqlite::execute(
                    &connection,
                    "INSERT INTO _tinytsx_actor_state (key, value) VALUES (?1, ?2)",
                    &[SqlValue::Text(key.clone()), SqlValue::Integer(initial_state)],
                )
                .map_err(|_| RENDER_ERROR)?;
                initial_state
            }
        };
        Ok((state, ActorPersistence {connection, key}))
    })();
    match persistence {
        Ok((state, persistence)) => (state, Some(Ok(persistence))),
        Err(status) => (initial_state, Some(Err(status))),
    }
}

pub fn initialize(executor_count: usize) -> io::Result<(usize, bool, bool)> {
    let worker_count = configured_worker_modules();
    let provider_enabled = configured_provider_transport();
    let filesystem_enabled = crate::filesystem::enabled();
    let actor_count = configured_actors();
    let database_count = configured_sqlite_databases();
    let database_paths = (0..database_count)
        .map(|database| {
            configured_sqlite_database_path(database)
                .map_err(|_| io::Error::other("invalid generated SQLite database path"))
                .and_then(|path| String::from_utf8(path)
                    .map_err(|_| io::Error::other("SQLite database path is not UTF-8")))
        })
        .collect::<io::Result<Vec<_>>>()?;
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
        move |id| {
            let actor = id
                .checked_sub(worker_count)
                .filter(|actor| *actor < actor_count);
            let initial_state = actor.map_or(0, actor_initial_state);
            let actor_operation = actor.map_or(0, actor_operation);
            let (actor_counter, actor_persistence) = initialize_actor_persistence(
                actor,
                initial_state,
                &database_paths,
            );
            WorkerState {
                operation: worker_operation(id),
                actor_operation,
                actor_counter,
                actor_failure_message: actor.map_or(0, actor_failure_message),
                actor_json: actor
                    .filter(|_| actor_operation == 2)
                    .map(actor_initial_json),
                actor_persistence,
                provider: OpenAiTransport::default(),
                sqlite: id
                    .checked_sub(worker_count + actor_count)
                    .filter(|database| *database < database_count)
                    .and_then(|database| database_paths.get(database))
                    .map(|path| tinytsx_runtime_sqlite::open(path).map_err(|_| RENDER_ERROR)),
            }
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
                if state.actor_operation == 3 && delta == state.actor_failure_message {
                    panic!("fallible counter actor failure");
                }
                if !matches!(state.actor_operation, 1 | 3) {
                    return Err(INTERNAL_ERROR);
                }
                let next = state.actor_counter.checked_add(delta).ok_or(RENDER_ERROR)?;
                if let Some(persistence) = &state.actor_persistence {
                    let persistence = persistence.as_ref().map_err(|status| *status)?;
                    tinytsx_runtime_sqlite::execute(
                        &persistence.connection,
                        "INSERT INTO _tinytsx_actor_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        &[SqlValue::Text(persistence.key.clone()), SqlValue::Integer(next)],
                    )
                    .map_err(|_| RENDER_ERROR)?;
                }
                state.actor_counter = next;
                Ok(next.to_string().into_bytes())
            }
            ApplicationMessage::ActorJson(message) => {
                if state.actor_operation != 2 {
                    return Err(INTERNAL_ERROR);
                }
                let value = state
                    .actor_json
                    .as_mut()
                    .ok_or(INTERNAL_ERROR)?
                    .as_mut()
                    .map_err(|status| *status)?;
                *value = message;
                Ok(value.clone())
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
            ApplicationMessage::SqliteTransaction(sql) => {
                let connection = state
                    .sqlite
                    .as_ref()
                    .ok_or(INTERNAL_ERROR)?
                    .as_ref()
                    .map_err(|status| *status)?;
                let sql = std::str::from_utf8(&sql).map_err(|_| RENDER_ERROR)?;
                tinytsx_runtime_sqlite::execute_transaction(connection, sql)
                    .map_err(|_| RENDER_ERROR)?;
                Ok(Vec::new())
            }
            ApplicationMessage::SqliteExecute { sql, parameters } => {
                let connection = state
                    .sqlite
                    .as_ref()
                    .ok_or(INTERNAL_ERROR)?
                    .as_ref()
                    .map_err(|status| *status)?;
                let sql = std::str::from_utf8(&sql).map_err(|_| RENDER_ERROR)?;
                tinytsx_runtime_sqlite::execute(connection, sql, &parameters)
                    .map(encode_execute_result)
                    .map_err(|_| RENDER_ERROR)
            }
            ApplicationMessage::SqliteQuery {
                sql,
                first,
                parameters,
            } => {
                let connection = state
                    .sqlite
                    .as_ref()
                    .ok_or(INTERNAL_ERROR)?
                    .as_ref()
                    .map_err(|status| *status)?;
                let sql = std::str::from_utf8(&sql).map_err(|_| RENDER_ERROR)?;
                tinytsx_runtime_sqlite::query_json(
                    connection,
                    sql,
                    &parameters,
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
        .map(|actor| {
            let restart = (actor_operation(actor) == 3).then(|| RestartPolicy {
                max_restarts: actor_restart_max(actor),
                within: Duration::from_millis(actor_restart_within_ms(actor)),
            });
            pool.spawn_with_capacity_and_restart(actor_mailbox_capacity(actor), restart)
        })
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

pub fn ask_actor(
    actor: usize,
    message: i64,
    timeout_ms: u64,
    cancelled: impl FnMut() -> bool,
) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let actor = runtime.actors.get(actor).ok_or(INTERNAL_ERROR)?;
    call_actor(
        actor,
        ApplicationMessage::ActorCounter(message),
        timeout_ms,
        cancelled,
    )
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

pub fn ask_actor_json(
    actor: usize,
    message: &[u8],
    timeout_ms: u64,
    cancelled: impl FnMut() -> bool,
) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let actor = runtime.actors.get(actor).ok_or(INTERNAL_ERROR)?;
    call_actor(
        actor,
        ApplicationMessage::ActorJson(message.to_vec()),
        timeout_ms,
        cancelled,
    )
}

pub fn tell_actor_json(actor: usize, message: &[u8]) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(actor) = runtime.actors.get(actor) else {
        return INTERNAL_ERROR;
    };
    match actor.try_post(ApplicationMessage::ActorJson(message.to_vec())) {
        Ok(_reply) => 0,
        Err(error) => actor_post_status(error),
    }
}

fn actor_call_status(error: CallError<ApplicationMessage>) -> u32 {
    match error {
        CallError::Post(error) => actor_post_status(error),
        CallError::Reply(ReplyError::TimedOut) => APPLICATION_OVERLOAD,
        CallError::Reply(ReplyError::Cancelled) => CLIENT_DISCONNECTED,
        CallError::Reply(_) => RENDER_ERROR,
    }
}

fn call_actor(
    actor: &Worker,
    message: ApplicationMessage,
    timeout_ms: u64,
    cancelled: impl FnMut() -> bool,
) -> Result<Vec<u8>, u32> {
    let reply = actor
        .try_post(message)
        .map_err(|error| actor_call_status(CallError::Post(error)))?;
    let timeout = (timeout_ms != 0).then(|| Duration::from_millis(timeout_ms));
    reply
        .receive_with_cancellation(timeout, ACTOR_REPLY_POLL_INTERVAL, cancelled)
        .map_err(|error| actor_call_status(CallError::Reply(error)))?
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

pub fn sqlite_transaction(database: usize, sql: &[u8]) -> u32 {
    let Some(runtime) = APPLICATION.get() else {
        return INTERNAL_ERROR;
    };
    let Some(database) = runtime.databases.get(database) else {
        return INTERNAL_ERROR;
    };
    match database.call(ApplicationMessage::SqliteTransaction(sql.to_vec())) {
        Ok(Ok(_)) => 0,
        Ok(Err(status)) => status,
        Err(error) => actor_call_status(error),
    }
}

pub fn sqlite_execute(
    database: usize,
    sql: &[u8],
    parameters: Vec<tinytsx_runtime_sqlite::SqlValue>,
) -> u32 {
    match sqlite_execute_result(database, sql, parameters) {
        Ok(_) => 0,
        Err(status) => status,
    }
}

pub fn sqlite_execute_result(
    database: usize,
    sql: &[u8],
    parameters: Vec<tinytsx_runtime_sqlite::SqlValue>,
) -> Result<tinytsx_runtime_sqlite::ExecuteResult, u32> {
    let Some(runtime) = APPLICATION.get() else {
        return Err(INTERNAL_ERROR);
    };
    let Some(database) = runtime.databases.get(database) else {
        return Err(INTERNAL_ERROR);
    };
    let encoded = database
        .call(ApplicationMessage::SqliteExecute {
            sql: sql.to_vec(),
            parameters,
        })
        .map_err(actor_call_status)??;
    decode_execute_result(&encoded).ok_or(INTERNAL_ERROR)
}

fn encode_execute_result(result: tinytsx_runtime_sqlite::ExecuteResult) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(17);
    encoded.extend_from_slice(&(result.changes as u64).to_le_bytes());
    encoded.extend_from_slice(&result.last_insert_row_id.unwrap_or_default().to_le_bytes());
    encoded.push(u8::from(result.last_insert_row_id.is_some()));
    encoded
}

fn decode_execute_result(encoded: &[u8]) -> Option<tinytsx_runtime_sqlite::ExecuteResult> {
    let changes = u64::from_le_bytes(encoded.get(..8)?.try_into().ok()?);
    let row_id = i64::from_le_bytes(encoded.get(8..16)?.try_into().ok()?);
    let has_row_id = *encoded.get(16)?;
    if encoded.len() != 17 || has_row_id > 1 || changes > usize::MAX as u64 {
        return None;
    }
    Some(tinytsx_runtime_sqlite::ExecuteResult {
        changes: changes as usize,
        last_insert_row_id: (has_row_id == 1).then_some(row_id),
    })
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
    parameters: Vec<tinytsx_runtime_sqlite::SqlValue>,
) -> Result<Vec<u8>, u32> {
    let runtime = APPLICATION.get().ok_or(INTERNAL_ERROR)?;
    let database = runtime.databases.get(database).ok_or(INTERNAL_ERROR)?;
    database
        .call(ApplicationMessage::SqliteQuery {
            sql: sql.to_vec(),
            first,
            parameters,
        })
        .map_err(actor_call_status)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_wait_failures_map_to_transport_statuses() {
        assert_eq!(
            actor_call_status(CallError::Reply(ReplyError::TimedOut)),
            APPLICATION_OVERLOAD,
        );
        assert_eq!(
            actor_call_status(CallError::Reply(ReplyError::Cancelled)),
            CLIENT_DISCONNECTED,
        );
    }

    #[test]
    fn sqlite_execute_results_round_trip_through_the_owner_reply() {
        for result in [
            tinytsx_runtime_sqlite::ExecuteResult {
                changes: 0,
                last_insert_row_id: None,
            },
            tinytsx_runtime_sqlite::ExecuteResult {
                changes: 7,
                last_insert_row_id: Some(-42),
            },
        ] {
            let encoded = encode_execute_result(tinytsx_runtime_sqlite::ExecuteResult {
                changes: result.changes,
                last_insert_row_id: result.last_insert_row_id,
            });
            assert_eq!(decode_execute_result(&encoded), Some(result));
        }
        assert_eq!(decode_execute_result(&[0; 16]), None);
    }
}
