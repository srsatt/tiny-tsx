use std::{fmt, path::Path, time::Duration};

use rusqlite::{OpenFlags, params_from_iter, types::ValueRef};

pub use rusqlite::Connection;

pub const MAX_SQL_BYTES: usize = 65_536;
pub const MAX_PARAMETERS: usize = 64;
pub const MAX_TRANSACTION_STEPS: usize = 16;
pub const MAX_ROWS: usize = 1_024;
pub const MAX_RESULT_BYTES: usize = 1_048_576;
const BUSY_TIMEOUT: Duration = Duration::from_millis(1_000);

#[derive(Clone, Debug, PartialEq)]
pub enum SqlValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl rusqlite::types::ToSql for SqlValue {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        use rusqlite::types::ToSqlOutput;
        Ok(match self {
            Self::Null => ToSqlOutput::Owned(rusqlite::types::Value::Null),
            Self::Integer(value) => ToSqlOutput::Owned(rusqlite::types::Value::Integer(*value)),
            Self::Real(value) => ToSqlOutput::Owned(rusqlite::types::Value::Real(*value)),
            Self::Text(value) => ToSqlOutput::Borrowed(ValueRef::Text(value.as_bytes())),
            Self::Blob(value) => ToSqlOutput::Borrowed(ValueRef::Blob(value)),
        })
    }
}

#[derive(Debug, PartialEq)]
pub struct ExecuteResult {
    pub changes: usize,
    pub last_insert_row_id: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransactionStep {
    pub sql: String,
    pub parameters: Vec<SqlValue>,
}

#[derive(Debug, PartialEq)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<SqlValue>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueryMode {
    All,
    First,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Open,
    UnsafePath,
    Sql,
    SqlTooLong,
    TooManyParameters,
    TooManyRows,
    ResultTooLarge,
    NonFiniteNumber,
}

#[derive(Debug)]
pub struct Error {
    pub kind: ErrorKind,
    source: Option<rusqlite::Error>,
}

impl Error {
    fn bounded(kind: ErrorKind) -> Self {
        Self { kind, source: None }
    }

    fn sqlite(kind: ErrorKind, source: rusqlite::Error) -> Self {
        Self {
            kind,
            source: Some(source),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "SQLite {:?}", self.kind)?;
        if let Some(source) = &self.source {
            write!(formatter, ": {source}")?;
        }
        Ok(())
    }
}

impl std::error::Error for Error {}

pub fn open(path: &str) -> Result<Connection, Error> {
    prepare_database_path(path)?;
    let flags = OpenFlags::default() | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let connection = Connection::open_with_flags(path, flags)
        .map_err(|error| Error::sqlite(ErrorKind::Open, error))?;
    validate_opened_database_path(path)?;
    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(|error| Error::sqlite(ErrorKind::Open, error))?;
    Ok(connection)
}

fn prepare_database_path(path: &str) -> Result<(), Error> {
    if path == ":memory:" {
        return Ok(());
    }
    #[cfg(unix)]
    return unix_path::prepare(Path::new(path));
    #[cfg(not(unix))]
    Err(Error::bounded(ErrorKind::UnsafePath))
}

fn validate_opened_database_path(path: &str) -> Result<(), Error> {
    if path == ":memory:" {
        return Ok(());
    }
    #[cfg(unix)]
    return unix_path::validate_opened(Path::new(path));
    #[cfg(not(unix))]
    Err(Error::bounded(ErrorKind::UnsafePath))
}

#[cfg(unix)]
mod unix_path {
    use std::{
        fs::{self, OpenOptions},
        os::unix::fs::{MetadataExt, OpenOptionsExt},
        path::{Path, PathBuf},
    };

    use super::{Error, ErrorKind};

    const GROUP_OR_OTHER_WRITE: u32 = 0o022;
    const STICKY: u32 = 0o1000;

    pub(super) fn prepare(path: &Path) -> Result<(), Error> {
        validate_directories(path)?;
        match fs::symlink_metadata(path) {
            Ok(metadata) => validate_owned_file(&metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .custom_flags(libc::O_NOFOLLOW)
                    .open(path)
                    .map_err(|_| unsafe_path())?;
                Ok(())
            }
            Err(_) => Err(unsafe_path()),
        }?;
        validate_named_files(path)
    }

    pub(super) fn validate_opened(path: &Path) -> Result<(), Error> {
        validate_directories(path)?;
        validate_named_files(path)
    }

    fn validate_directories(path: &Path) -> Result<(), Error> {
        if !path.is_absolute() || path.file_name().is_none() {
            return Err(unsafe_path());
        }
        let parent = path.parent().ok_or_else(unsafe_path)?;
        let directories = parent.ancestors().collect::<Vec<_>>();
        let directories = directories.into_iter().rev().collect::<Vec<_>>();
        let mut metadata = Vec::with_capacity(directories.len());
        for directory in &directories {
            let value = fs::symlink_metadata(directory).map_err(|_| unsafe_path())?;
            if value.file_type().is_symlink() || !value.file_type().is_dir() {
                return Err(unsafe_path());
            }
            metadata.push(value);
        }

        let effective_user = unsafe { libc::geteuid() };
        let final_directory = metadata.last().ok_or_else(unsafe_path)?;
        if final_directory.uid() != effective_user
            || final_directory.mode() & GROUP_OR_OTHER_WRITE != 0
        {
            return Err(unsafe_path());
        }
        for (index, directory) in metadata.iter().enumerate().take(metadata.len() - 1) {
            if directory.mode() & GROUP_OR_OTHER_WRITE == 0 {
                continue;
            }
            let child = &metadata[index + 1];
            if directory.mode() & STICKY == 0 || child.uid() != effective_user {
                return Err(unsafe_path());
            }
        }
        Ok(())
    }

    fn validate_named_files(path: &Path) -> Result<(), Error> {
        validate_existing_file(path)?;
        for suffix in ["-journal", "-wal", "-shm"] {
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(suffix);
            let sidecar = PathBuf::from(sidecar);
            validate_existing_file(&sidecar)?;
        }
        Ok(())
    }

    fn validate_existing_file(path: &Path) -> Result<(), Error> {
        match fs::symlink_metadata(path) {
            Ok(metadata) => validate_owned_file(&metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(unsafe_path()),
        }
    }

    fn validate_owned_file(metadata: &fs::Metadata) -> Result<(), Error> {
        let effective_user = unsafe { libc::geteuid() };
        if !metadata.file_type().is_file()
            || metadata.uid() != effective_user
            || metadata.nlink() != 1
            || metadata.mode() & GROUP_OR_OTHER_WRITE != 0
        {
            return Err(unsafe_path());
        }
        Ok(())
    }

    fn unsafe_path() -> Error {
        Error::bounded(ErrorKind::UnsafePath)
    }
}

pub fn execute(
    connection: &Connection,
    sql: &str,
    parameters: &[SqlValue],
) -> Result<ExecuteResult, Error> {
    validate_input(sql, parameters)?;
    let changes = connection
        .execute(sql, params_from_iter(parameters))
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    let last_insert_row_id = (changes != 0).then(|| connection.last_insert_rowid());
    Ok(ExecuteResult {
        changes,
        last_insert_row_id,
    })
}

pub fn execute_batch(connection: &Connection, sql: &str) -> Result<(), Error> {
    validate_input(sql, &[])?;
    connection
        .execute_batch(sql)
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))
}

pub fn execute_transaction(connection: &Connection, sql: &str) -> Result<(), Error> {
    validate_input(sql, &[])?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    transaction
        .execute_batch(sql)
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    transaction
        .commit()
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))
}

pub fn execute_prepared_transaction(
    connection: &Connection,
    steps: &[TransactionStep],
) -> Result<(), Error> {
    if steps.is_empty() || steps.len() > MAX_TRANSACTION_STEPS {
        return Err(Error::bounded(ErrorKind::Sql));
    }
    let sql_bytes = steps.iter().try_fold(0usize, |total, step| {
        total
            .checked_add(step.sql.len())
            .filter(|total| *total <= MAX_SQL_BYTES)
    });
    if sql_bytes.is_none() {
        return Err(Error::bounded(ErrorKind::SqlTooLong));
    }
    let parameter_count = steps.iter().try_fold(0usize, |total, step| {
        total
            .checked_add(step.parameters.len())
            .filter(|total| *total <= MAX_PARAMETERS)
    });
    if parameter_count.is_none() {
        return Err(Error::bounded(ErrorKind::TooManyParameters));
    }
    for step in steps {
        validate_input(&step.sql, &step.parameters)?;
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    for step in steps {
        transaction
            .execute(&step.sql, params_from_iter(&step.parameters))
            .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    }
    transaction
        .commit()
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))
}

pub fn query(
    connection: &Connection,
    sql: &str,
    parameters: &[SqlValue],
    max_rows: usize,
    max_bytes: usize,
) -> Result<QueryResult, Error> {
    validate_input(sql, parameters)?;
    let max_rows = max_rows.min(MAX_ROWS);
    let max_bytes = max_bytes.min(MAX_RESULT_BYTES);
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let column_count = columns.len();
    let mut rows = statement
        .query(params_from_iter(parameters))
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
    let mut output = Vec::new();
    let mut result_bytes = columns.iter().map(String::len).sum::<usize>();
    while let Some(row) = rows
        .next()
        .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?
    {
        if output.len() == max_rows {
            return Err(Error::bounded(ErrorKind::TooManyRows));
        }
        let mut values = Vec::with_capacity(column_count);
        for index in 0..column_count {
            let value = row
                .get_ref(index)
                .map_err(|error| Error::sqlite(ErrorKind::Sql, error))?;
            let value = owned_value(value)?;
            result_bytes = result_bytes
                .checked_add(value_bytes(&value))
                .filter(|bytes| *bytes <= max_bytes)
                .ok_or_else(|| Error::bounded(ErrorKind::ResultTooLarge))?;
            values.push(value);
        }
        output.push(values);
    }
    Ok(QueryResult {
        columns,
        rows: output,
    })
}

pub fn query_json(
    connection: &Connection,
    sql: &str,
    parameters: &[SqlValue],
    mode: QueryMode,
) -> Result<Vec<u8>, Error> {
    let max_rows = if mode == QueryMode::First {
        1
    } else {
        MAX_ROWS
    };
    let result = query(connection, sql, parameters, max_rows, MAX_RESULT_BYTES)?;
    let mut output = Vec::new();
    if mode == QueryMode::All {
        output.push(b'[');
    }
    let rows = if mode == QueryMode::First {
        result.rows.into_iter().take(1).collect::<Vec<_>>()
    } else {
        result.rows
    };
    if mode == QueryMode::First && rows.is_empty() {
        output.extend_from_slice(b"null");
    }
    for (row_index, row) in rows.iter().enumerate() {
        if row_index != 0 {
            output.push(b',');
        }
        output.push(b'{');
        for (column_index, (column, value)) in result.columns.iter().zip(row).enumerate() {
            if column_index != 0 {
                output.push(b',');
            }
            write_json_string(&mut output, column);
            output.push(b':');
            write_json_value(&mut output, value);
            if output.len() > MAX_RESULT_BYTES {
                return Err(Error::bounded(ErrorKind::ResultTooLarge));
            }
        }
        output.push(b'}');
    }
    if mode == QueryMode::All {
        output.push(b']');
    }
    Ok(output)
}

fn validate_input(sql: &str, parameters: &[SqlValue]) -> Result<(), Error> {
    if sql.len() > MAX_SQL_BYTES {
        return Err(Error::bounded(ErrorKind::SqlTooLong));
    }
    if parameters.len() > MAX_PARAMETERS {
        return Err(Error::bounded(ErrorKind::TooManyParameters));
    }
    if parameters
        .iter()
        .any(|value| matches!(value, SqlValue::Real(number) if !number.is_finite()))
    {
        return Err(Error::bounded(ErrorKind::NonFiniteNumber));
    }
    Ok(())
}

fn owned_value(value: ValueRef<'_>) -> Result<SqlValue, Error> {
    Ok(match value {
        ValueRef::Null => SqlValue::Null,
        ValueRef::Integer(value) => SqlValue::Integer(value),
        ValueRef::Real(value) if value.is_finite() => SqlValue::Real(value),
        ValueRef::Real(_) => return Err(Error::bounded(ErrorKind::NonFiniteNumber)),
        ValueRef::Text(value) => SqlValue::Text(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => SqlValue::Blob(value.to_vec()),
    })
}

fn value_bytes(value: &SqlValue) -> usize {
    match value {
        SqlValue::Null => 0,
        SqlValue::Integer(_) | SqlValue::Real(_) => 8,
        SqlValue::Text(value) => value.len(),
        SqlValue::Blob(value) => value.len(),
    }
}

fn write_json_value(output: &mut Vec<u8>, value: &SqlValue) {
    match value {
        SqlValue::Null => output.extend_from_slice(b"null"),
        SqlValue::Integer(value) => output.extend_from_slice(value.to_string().as_bytes()),
        SqlValue::Real(value) => output.extend_from_slice(value.to_string().as_bytes()),
        SqlValue::Text(value) => write_json_string(output, value),
        SqlValue::Blob(value) => {
            output.push(b'[');
            for (index, byte) in value.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                output.extend_from_slice(byte.to_string().as_bytes());
            }
            output.push(b']');
        }
    }
}

fn write_json_string(output: &mut Vec<u8>, value: &str) {
    output.push(b'"');
    for byte in value.bytes() {
        match byte {
            b'"' => output.extend_from_slice(br#"\""#),
            b'\\' => output.extend_from_slice(br#"\\"#),
            b'\n' => output.extend_from_slice(br#"\n"#),
            b'\r' => output.extend_from_slice(br#"\r"#),
            b'\t' => output.extend_from_slice(br#"\t"#),
            0x00..=0x1f => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                output.extend_from_slice(b"\\u00");
                output.push(HEX[usize::from(byte >> 4)]);
                output.push(HEX[usize::from(byte & 0x0f)]);
            }
            _ => output.push(byte),
        }
    }
    output.push(b'"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DATABASE_ID: AtomicU64 = AtomicU64::new(0);

    fn test_directory(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "tinytsx-sqlite-{name}-{}-{}",
            std::process::id(),
            DATABASE_ID.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir(&directory).expect("create SQLite test directory");
        std::fs::canonicalize(directory).expect("canonicalize SQLite test directory")
    }

    fn database() -> Connection {
        let connection = open(":memory:").expect("open memory database");
        execute_batch(
            &connection,
            "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body BLOB)",
        )
        .expect("create schema");
        connection
    }

    #[test]
    fn executes_prepared_values_and_returns_bounded_rows() {
        let connection = database();
        let result = execute(
            &connection,
            "INSERT INTO posts (title, body) VALUES (?1, ?2)",
            &[
                SqlValue::Text("Morning".to_owned()),
                SqlValue::Blob(vec![1, 2, 3]),
            ],
        )
        .expect("insert row");
        assert_eq!(result.changes, 1);
        assert_eq!(result.last_insert_row_id, Some(1));

        let result = query(
            &connection,
            "SELECT id, title, body FROM posts WHERE id = ?1",
            &[SqlValue::Integer(1)],
            1,
            128,
        )
        .expect("query row");
        assert_eq!(result.columns, ["id", "title", "body"]);
        assert_eq!(
            result.rows,
            [vec![
                SqlValue::Integer(1),
                SqlValue::Text("Morning".to_owned()),
                SqlValue::Blob(vec![1, 2, 3]),
            ]]
        );
    }

    #[test]
    fn transaction_rolls_back_the_complete_static_batch_on_error() {
        let connection = database();
        let error = execute_transaction(
            &connection,
            "INSERT INTO posts (id, title) VALUES (1, 'first');\n\
             INSERT INTO posts (id, title) VALUES (1, 'duplicate');",
        )
        .expect_err("duplicate key must roll back the transaction");
        assert_eq!(error.kind, ErrorKind::Sql);
        assert!(
            query(&connection, "SELECT id FROM posts", &[], 1, 128)
                .expect("query after rollback")
                .rows
                .is_empty()
        );
        assert_eq!(
            execute_transaction(&connection, "BEGIN; SELECT 1; COMMIT")
                .expect_err("nested transaction syntax must be rejected")
                .kind,
            ErrorKind::Sql
        );
        execute(
            &connection,
            "INSERT INTO posts (title) VALUES ('reused')",
            &[],
        )
        .expect("connection remains reusable after nested rejection");
    }

    #[test]
    fn prepared_transaction_commits_or_rolls_back_all_steps() {
        let connection = database();
        execute_prepared_transaction(
            &connection,
            &[
                TransactionStep {
                    sql: "INSERT INTO posts (id, title) VALUES (?1, ?2)".to_owned(),
                    parameters: vec![SqlValue::Integer(1), SqlValue::Text("first".to_owned())],
                },
                TransactionStep {
                    sql: "INSERT INTO posts (id, title) VALUES (?1, ?2)".to_owned(),
                    parameters: vec![SqlValue::Integer(2), SqlValue::Text("second".to_owned())],
                },
            ],
        )
        .expect("commit prepared transaction");
        assert_eq!(
            query(&connection, "SELECT id FROM posts ORDER BY id", &[], 4, 128)
                .expect("query committed rows")
                .rows,
            [vec![SqlValue::Integer(1)], vec![SqlValue::Integer(2)]]
        );

        let error = execute_prepared_transaction(
            &connection,
            &[
                TransactionStep {
                    sql: "INSERT INTO posts (id, title) VALUES (?1, ?2)".to_owned(),
                    parameters: vec![SqlValue::Integer(3), SqlValue::Text("third".to_owned())],
                },
                TransactionStep {
                    sql: "INSERT INTO posts (id, title) VALUES (?1, ?2)".to_owned(),
                    parameters: vec![SqlValue::Integer(2), SqlValue::Text("duplicate".to_owned())],
                },
            ],
        )
        .expect_err("duplicate key must roll back every prepared step");
        assert_eq!(error.kind, ErrorKind::Sql);
        assert!(
            query(
                &connection,
                "SELECT id FROM posts WHERE id = 3",
                &[],
                1,
                128,
            )
            .expect("query rolled-back row")
            .rows
            .is_empty()
        );
    }

    #[test]
    fn busy_connection_recovers_after_the_competing_writer_rolls_back() {
        let directory = test_directory("contention");
        let path = directory.join("contention.db");
        let path = path.to_string_lossy().into_owned();
        let first = open(&path).expect("open first connection");
        execute_batch(&first, "CREATE TABLE values_table (value TEXT NOT NULL)")
            .expect("create contention schema");
        let second = open(&path).expect("open second connection");

        execute_batch(&first, "BEGIN IMMEDIATE").expect("hold writer lock");
        assert_eq!(
            execute(&second, "INSERT INTO values_table VALUES ('blocked')", &[])
                .expect_err("second writer must respect the bounded busy timeout")
                .kind,
            ErrorKind::Sql,
        );
        execute_batch(&first, "ROLLBACK").expect("release writer lock");
        execute(
            &second,
            "INSERT INTO values_table VALUES ('recovered')",
            &[],
        )
        .expect("second connection recovers after contention");
        drop(first);
        drop(second);
        std::fs::remove_dir_all(directory).expect("remove contention directory");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_as_the_database_file() {
        use std::os::unix::fs::symlink;

        let directory = test_directory("no-follow");
        let target = directory.join("target.db");
        let redirected = directory.join("redirected.db");
        drop(open(target.to_str().expect("UTF-8 target path")).expect("create target database"));
        symlink(&target, &redirected).expect("create database symlink");

        assert_eq!(
            open(redirected.to_str().expect("UTF-8 symlink path"))
                .expect_err("database symlink must be rejected")
                .kind,
            ErrorKind::UnsafePath,
        );

        std::fs::remove_dir_all(directory).expect("remove no-follow test directory");
    }

    #[cfg(unix)]
    #[test]
    fn creates_a_private_database_and_rejects_an_unsafe_directory() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let private = test_directory("private-mode");
        let database = private.join("state.db");
        drop(open(database.to_str().expect("UTF-8 database path")).expect("open database"));
        assert_eq!(
            std::fs::metadata(&database)
                .expect("database metadata")
                .mode()
                & 0o777,
            0o600,
        );
        std::fs::remove_dir_all(private).expect("remove private database directory");

        let shared = test_directory("shared-mode");
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o777))
            .expect("make directory unsafe");
        assert_eq!(
            open(
                shared
                    .join("state.db")
                    .to_str()
                    .expect("UTF-8 database path")
            )
            .expect_err("group/other-writable database directory must be rejected")
            .kind,
            ErrorKind::UnsafePath,
        );
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o700))
            .expect("restore directory permissions");
        std::fs::remove_dir_all(shared).expect("remove unsafe database directory");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_directory_and_sidecar_paths() {
        use std::os::unix::fs::symlink;

        let directory = test_directory("sidecars");
        let real = directory.join("real");
        std::fs::create_dir(&real).expect("create real database directory");
        let linked = directory.join("linked");
        symlink(&real, &linked).expect("create directory symlink");
        assert_eq!(
            open(
                linked
                    .join("state.db")
                    .to_str()
                    .expect("UTF-8 database path")
            )
            .expect_err("symlinked database directory must be rejected")
            .kind,
            ErrorKind::UnsafePath,
        );

        let database = real.join("state.db");
        drop(open(database.to_str().expect("UTF-8 database path")).expect("create database"));
        let target = real.join("target");
        std::fs::write(&target, b"protected").expect("create sidecar target");
        for suffix in ["-journal", "-wal", "-shm"] {
            let sidecar = real.join(format!("state.db{suffix}"));
            symlink(&target, &sidecar).expect("create sidecar symlink");
            assert_eq!(
                open(database.to_str().expect("UTF-8 database path"))
                    .expect_err("symlinked SQLite sidecar must be rejected")
                    .kind,
                ErrorKind::UnsafePath,
            );
            std::fs::remove_file(sidecar).expect("remove sidecar symlink");
        }
        let hard_sidecar = real.join("state.db-journal");
        std::fs::hard_link(&target, &hard_sidecar).expect("create sidecar hard link");
        assert_eq!(
            open(database.to_str().expect("UTF-8 database path"))
                .expect_err("hard-linked SQLite sidecar must be rejected")
                .kind,
            ErrorKind::UnsafePath,
        );
        std::fs::remove_file(hard_sidecar).expect("remove sidecar hard link");
        assert_eq!(
            std::fs::read(target).expect("read protected target"),
            b"protected"
        );
        std::fs::remove_dir_all(directory).expect("remove sidecar test directory");
    }

    #[test]
    fn rejects_row_byte_parameter_and_number_limits() {
        let connection = database();
        for title in ["one", "two"] {
            execute(
                &connection,
                "INSERT INTO posts (title) VALUES (?1)",
                &[SqlValue::Text(title.to_owned())],
            )
            .expect("insert row");
        }
        assert_eq!(
            query(&connection, "SELECT title FROM posts", &[], 1, 128)
                .expect_err("row limit")
                .kind,
            ErrorKind::TooManyRows
        );
        assert_eq!(
            query(&connection, "SELECT title FROM posts", &[], 2, 2)
                .expect_err("byte limit")
                .kind,
            ErrorKind::ResultTooLarge
        );
        assert_eq!(
            execute(
                &connection,
                "SELECT 1",
                &vec![SqlValue::Null; MAX_PARAMETERS + 1],
            )
            .expect_err("parameter limit")
            .kind,
            ErrorKind::TooManyParameters
        );
        assert_eq!(
            execute(&connection, "SELECT ?1", &[SqlValue::Real(f64::NAN)],)
                .expect_err("finite values")
                .kind,
            ErrorKind::NonFiniteNumber
        );
    }

    #[test]
    fn reports_malformed_sql_without_poisoning_the_connection() {
        let connection = database();
        assert_eq!(
            execute(&connection, "not sql", &[])
                .expect_err("malformed SQL")
                .kind,
            ErrorKind::Sql
        );
        assert!(execute(&connection, "INSERT INTO posts (title) VALUES ('ok')", &[]).is_ok());
    }

    #[test]
    fn serializes_all_and_first_rows_as_bounded_json() {
        let connection = database();
        execute(
            &connection,
            "INSERT INTO posts (title, body) VALUES (?1, ?2)",
            &[
                SqlValue::Text("quote \" and newline\n".to_owned()),
                SqlValue::Blob(vec![0, 255]),
            ],
        )
        .expect("insert row");
        assert_eq!(
            query_json(
                &connection,
                "SELECT id, title, body FROM posts",
                &[],
                QueryMode::All,
            )
            .expect("all rows"),
            br#"[{"id":1,"title":"quote \" and newline\n","body":[0,255]}]"#
        );
        assert_eq!(
            query_json(
                &connection,
                "SELECT title FROM posts WHERE id = ?1",
                &[SqlValue::Integer(1)],
                QueryMode::First,
            )
            .expect("first row"),
            br#"{"title":"quote \" and newline\n"}"#
        );
        assert_eq!(
            query_json(
                &connection,
                "SELECT title FROM posts WHERE id = 99",
                &[],
                QueryMode::First,
            )
            .expect("missing row"),
            b"null"
        );
    }
}
