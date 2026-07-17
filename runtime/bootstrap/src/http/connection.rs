use std::{
    io::{self},
    net::{Shutdown, TcpStream},
    time::Duration,
};

use crate::abi::{
    APPLICATION_OVERLOAD, BAD_REQUEST, CONTENT_TYPE_TEXT, INTERNAL_ERROR, NOT_FOUND, OK,
    RENDER_ERROR, REQUEST_OOM, RequestArena, render, request_with_body,
};

use super::{
    request::{
        ConnectionInput, MAX_REQUEST_BODY, is_timeout, parse_request_headers, parse_request_line,
    },
    response::{
        ConnectionDirective, write_response, write_stream_response, write_terminal_response,
    },
};

const MAX_REQUESTS_PER_CONNECTION: usize = 100;
const CONNECTION_IO_TIMEOUT: Duration = Duration::from_secs(5);
const OVERLOAD_HEAD_TIMEOUT: Duration = Duration::from_millis(10);

pub(super) fn handle_connection(
    stream: &mut TcpStream,
    arena: &mut RequestArena,
) -> io::Result<()> {
    stream.set_read_timeout(Some(CONNECTION_IO_TIMEOUT))?;
    stream.set_write_timeout(Some(CONNECTION_IO_TIMEOUT))?;
    let mut input = ConnectionInput::new();

    for request_index in 0..MAX_REQUESTS_PER_CONNECTION {
        let head = match input.read_head(stream) {
            Ok(Some(head)) => head,
            Ok(None) => return Ok(()),
            Err(error) if is_timeout(&error) => return Ok(()),
            Err(_) => return write_terminal_response(stream, 400, b"bad request"),
        };
        let Some((method, target, version)) = parse_request_line(&head) else {
            return write_terminal_response(stream, 400, b"bad request");
        };
        if !matches!(method, b"GET" | b"POST" | b"PUT" | b"DELETE" | b"OPTIONS") {
            return write_terminal_response(stream, 405, b"method not allowed");
        }

        let Some(parsed) = parse_request_headers(&head) else {
            return write_terminal_response(stream, 400, b"bad request");
        };
        if parsed.transfer_encoded {
            return write_terminal_response(stream, 400, b"unsupported transfer encoding");
        }
        if parsed.content_length > MAX_REQUEST_BODY {
            return write_terminal_response(stream, 413, b"request body too large");
        }
        let body = match input.read_body(stream, parsed.content_length) {
            Ok(body) => body,
            Err(_) => return write_terminal_response(stream, 400, b"bad request"),
        };

        let request = request_with_body(method, target, &parsed.headers, &body);
        let response = render(&request, arena);
        let can_reuse = version == b"HTTP/1.1"
            && !parsed.connection_close
            && request_index + 1 < MAX_REQUESTS_PER_CONNECTION;
        let mut connection = if can_reuse {
            ConnectionDirective::KeepAlive
        } else {
            ConnectionDirective::Close
        };

        let result = match response.application_status {
            OK if response.is_streaming() => write_stream_response(
                stream,
                response.http_status,
                response.content_type,
                response.stream_chunks(),
                &response.headers,
                connection,
            ),
            OK => write_response(
                stream,
                response.http_status,
                response.content_type,
                response.body,
                &response.headers,
                connection,
            ),
            REQUEST_OOM => {
                connection = ConnectionDirective::Close;
                write_response(
                    stream,
                    503,
                    CONTENT_TYPE_TEXT,
                    b"request memory exhausted",
                    &[],
                    connection,
                )
            }
            APPLICATION_OVERLOAD => {
                connection = ConnectionDirective::Close;
                write_response(
                    stream,
                    503,
                    CONTENT_TYPE_TEXT,
                    b"application worker overloaded",
                    &[],
                    connection,
                )
            }
            BAD_REQUEST => {
                connection = ConnectionDirective::Close;
                write_response(
                    stream,
                    400,
                    CONTENT_TYPE_TEXT,
                    b"bad request",
                    &[],
                    connection,
                )
            }
            NOT_FOUND => write_response(
                stream,
                404,
                CONTENT_TYPE_TEXT,
                b"404 Not Found",
                &[],
                connection,
            ),
            RENDER_ERROR | INTERNAL_ERROR => {
                connection = ConnectionDirective::Close;
                write_response(
                    stream,
                    500,
                    CONTENT_TYPE_TEXT,
                    b"internal server error",
                    &[],
                    connection,
                )
            }
            _ => {
                connection = ConnectionDirective::Close;
                write_response(
                    stream,
                    500,
                    CONTENT_TYPE_TEXT,
                    b"unknown application status",
                    &[],
                    connection,
                )
            }
        };
        result?;
        if connection == ConnectionDirective::Close {
            stream.shutdown(Shutdown::Write)?;
            return Ok(());
        }
    }
    Ok(())
}

pub(super) fn write_overload_response(stream: &mut TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(OVERLOAD_HEAD_TIMEOUT))?;
    let _ = ConnectionInput::new().read_head(stream);
    write_response(
        stream,
        503,
        CONTENT_TYPE_TEXT,
        b"server overloaded",
        &[],
        ConnectionDirective::Close,
    )?;
    stream.shutdown(Shutdown::Write)
}
