use std::{fmt, time::Duration};

use rusqlite::{params_from_iter, types::ValueRef};

pub use rusqlite::Connection;

pub const MAX_SQL_BYTES: usize = 65_536;
pub const MAX_PARAMETERS: usize = 64;
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

#[derive(Debug, PartialEq)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<SqlValue>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    Open,
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
    let connection =
        Connection::open(path).map_err(|error| Error::sqlite(ErrorKind::Open, error))?;
    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(|error| Error::sqlite(ErrorKind::Open, error))?;
    Ok(connection)
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
