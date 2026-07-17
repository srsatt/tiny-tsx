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
const REQUESTS_PER_TURN: usize = 16;
const CONNECTION_IO_TIMEOUT: Duration = Duration::from_secs(5);
const OVERLOAD_HEAD_TIMEOUT: Duration = Duration::from_millis(10);

pub(super) struct Connection {
    stream: TcpStream,
    input: ConnectionInput,
    requests_completed: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Turn {
    Complete,
    Resubmit,
}

impl Connection {
    pub(super) fn new(stream: TcpStream) -> io::Result<Self> {
        stream.set_read_timeout(Some(CONNECTION_IO_TIMEOUT))?;
        stream.set_write_timeout(Some(CONNECTION_IO_TIMEOUT))?;
        Ok(Self {
            stream,
            input: ConnectionInput::new(),
            requests_completed: 0,
        })
    }

    pub(super) fn handle_turn(&mut self, arena: &mut RequestArena) -> io::Result<Turn> {
        for turn_index in 0..REQUESTS_PER_TURN {
            let turn = self.handle_request(arena)?;
            if turn == Turn::Complete {
                return Ok(Turn::Complete);
            }
            if turn_index + 1 == REQUESTS_PER_TURN {
                return Ok(Turn::Resubmit);
            }
        }
        unreachable!("a connection turn has at least one request slot")
    }

    pub(super) fn into_stream(self) -> TcpStream {
        self.stream
    }

    fn handle_request(&mut self, arena: &mut RequestArena) -> io::Result<Turn> {
        let stream = &mut self.stream;
        let input = &mut self.input;
        let head = match input.read_head(stream) {
            Ok(Some(head)) => head,
            Ok(None) => return Ok(Turn::Complete),
            Err(error) if is_timeout(&error) => return Ok(Turn::Complete),
            Err(_) => {
                write_terminal_response(stream, 400, b"bad request")?;
                return Ok(Turn::Complete);
            }
        };
        let Some((method, target, version)) = parse_request_line(&head) else {
            write_terminal_response(stream, 400, b"bad request")?;
            return Ok(Turn::Complete);
        };
        if !matches!(method, b"GET" | b"POST" | b"PUT" | b"DELETE" | b"OPTIONS") {
            write_terminal_response(stream, 405, b"method not allowed")?;
            return Ok(Turn::Complete);
        }

        let Some(parsed) = parse_request_headers(&head) else {
            write_terminal_response(stream, 400, b"bad request")?;
            return Ok(Turn::Complete);
        };
        if parsed.transfer_encoded {
            write_terminal_response(stream, 400, b"unsupported transfer encoding")?;
            return Ok(Turn::Complete);
        }
        if parsed.content_length > MAX_REQUEST_BODY {
            write_terminal_response(stream, 413, b"request body too large")?;
            return Ok(Turn::Complete);
        }
        let body = match input.read_body(stream, parsed.content_length) {
            Ok(body) => body,
            Err(_) => {
                write_terminal_response(stream, 400, b"bad request")?;
                return Ok(Turn::Complete);
            }
        };

        let request = request_with_body(method, target, &parsed.headers, &body);
        let response = render(&request, arena);
        let can_reuse = version == b"HTTP/1.1"
            && !parsed.connection_close
            && self.requests_completed + 1 < MAX_REQUESTS_PER_CONNECTION;
        let mut directive = if can_reuse {
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
                directive,
            ),
            OK => write_response(
                stream,
                response.http_status,
                response.content_type,
                response.body,
                &response.headers,
                directive,
            ),
            REQUEST_OOM => {
                directive = ConnectionDirective::Close;
                write_response(
                    stream,
                    503,
                    CONTENT_TYPE_TEXT,
                    b"request memory exhausted",
                    &[],
                    directive,
                )
            }
            APPLICATION_OVERLOAD => {
                directive = ConnectionDirective::Close;
                write_response(
                    stream,
                    503,
                    CONTENT_TYPE_TEXT,
                    b"application worker overloaded",
                    &[],
                    directive,
                )
            }
            BAD_REQUEST => {
                directive = ConnectionDirective::Close;
                write_response(
                    stream,
                    400,
                    CONTENT_TYPE_TEXT,
                    b"bad request",
                    &[],
                    directive,
                )
            }
            NOT_FOUND => write_response(
                stream,
                404,
                CONTENT_TYPE_TEXT,
                b"404 Not Found",
                &[],
                directive,
            ),
            RENDER_ERROR | INTERNAL_ERROR => {
                directive = ConnectionDirective::Close;
                write_response(
                    stream,
                    500,
                    CONTENT_TYPE_TEXT,
                    b"internal server error",
                    &[],
                    directive,
                )
            }
            _ => {
                directive = ConnectionDirective::Close;
                write_response(
                    stream,
                    500,
                    CONTENT_TYPE_TEXT,
                    b"unknown application status",
                    &[],
                    directive,
                )
            }
        };
        result?;
        self.requests_completed += 1;
        if directive == ConnectionDirective::Close {
            stream.shutdown(Shutdown::Write)?;
            Ok(Turn::Complete)
        } else {
            Ok(Turn::Resubmit)
        }
    }
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

/*
 * A live connection owns its parser buffer across turns. This is intentionally
 * not reconstructed from the socket because one read may already contain the
 * body or head of a later pipelined request.
 */
#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
    };

    use crate::abi::RequestArena;

    use super::{Connection, Turn};

    #[test]
    fn preserves_pipelined_input_across_resubmitted_turns() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test listener");
        let mut client = TcpStream::connect(listener.local_addr().expect("listener address"))
            .expect("connect test client");
        let (server, _) = listener.accept().expect("accept test connection");

        let mut requests = Vec::new();
        for index in 0..17 {
            let connection = if index == 16 { "close" } else { "keep-alive" };
            write!(
                requests,
                "GET /{index} HTTP/1.1\r\nHost: localhost\r\nConnection: {connection}\r\n\r\n"
            )
            .expect("write request bytes");
        }
        client
            .write_all(&requests)
            .expect("send pipelined requests");

        let mut connection = Connection::new(server).expect("configure connection");
        let mut arena = RequestArena::new(4096);
        assert_eq!(
            connection.handle_turn(&mut arena).expect("first turn"),
            Turn::Resubmit
        );
        assert_eq!(
            connection.handle_turn(&mut arena).expect("second turn"),
            Turn::Complete
        );

        let mut responses = Vec::new();
        client.read_to_end(&mut responses).expect("read responses");
        assert_eq!(
            responses
                .windows(b"HTTP/1.1 200".len())
                .filter(|window| *window == b"HTTP/1.1 200")
                .count(),
            17
        );
        assert_eq!(
            responses
                .windows(b"Connection: keep-alive".len())
                .filter(|window| *window == b"Connection: keep-alive")
                .count(),
            16
        );
        assert!(responses.ends_with(b"Connection: close\r\n\r\n"));
    }
}
