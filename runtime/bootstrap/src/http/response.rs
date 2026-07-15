use std::{
    io::{self, Write},
    net::{Shutdown, TcpStream},
};

use crate::abi::{
    CONTENT_TYPE_HTML, CONTENT_TYPE_JSON, CONTENT_TYPE_NONE, CONTENT_TYPE_RESPONSE_TEXT,
    CONTENT_TYPE_TEXT,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ConnectionDirective {
    KeepAlive,
    Close,
}

pub(super) fn write_terminal_response(
    stream: &mut TcpStream,
    status: u16,
    body: &[u8],
) -> io::Result<()> {
    write_response(
        stream,
        status,
        CONTENT_TYPE_TEXT,
        body,
        &[],
        ConnectionDirective::Close,
    )?;
    stream.shutdown(Shutdown::Write)
}

pub(super) fn write_response(
    stream: &mut impl Write,
    status: u16,
    content_type: u16,
    body: &[u8],
    headers: &[(Vec<u8>, Vec<u8>)],
    connection: ConnectionDirective,
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        301 => "Moved Permanently",
        302 => "Found",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Unknown",
    };
    write!(stream, "HTTP/1.1 {status} {reason}\r\n")?;
    if content_type != CONTENT_TYPE_NONE {
        let content_type = match content_type {
            CONTENT_TYPE_HTML => "text/html; charset=utf-8",
            CONTENT_TYPE_TEXT => "text/plain; charset=UTF-8",
            CONTENT_TYPE_JSON => "application/json",
            CONTENT_TYPE_RESPONSE_TEXT => "text/plain;charset=UTF-8",
            _ => "application/octet-stream",
        };
        write!(stream, "Content-Type: {content_type}\r\n")?;
    }
    for (name, value) in headers {
        if is_framing_header(name) {
            continue;
        }
        stream.write_all(name)?;
        stream.write_all(b": ")?;
        stream.write_all(value)?;
        stream.write_all(b"\r\n")?;
    }
    let connection = match connection {
        ConnectionDirective::KeepAlive => "keep-alive",
        ConnectionDirective::Close => "close",
    };
    write!(
        stream,
        "Content-Length: {}\r\nConnection: {connection}\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)?;
    stream.flush()
}

fn is_framing_header(name: &[u8]) -> bool {
    name.eq_ignore_ascii_case(b"connection")
        || name.eq_ignore_ascii_case(b"content-length")
        || name.eq_ignore_ascii_case(b"transfer-encoding")
}

#[cfg(test)]
mod tests {
    use super::{ConnectionDirective, write_response};
    use crate::abi::CONTENT_TYPE_NONE;

    #[test]
    fn response_selects_keep_alive_or_close() {
        let mut keep_alive = Vec::new();
        write_response(
            &mut keep_alive,
            200,
            CONTENT_TYPE_NONE,
            b"ok",
            &[],
            ConnectionDirective::KeepAlive,
        )
        .expect("write keep-alive response");
        assert!(find(&keep_alive, b"Connection: keep-alive\r\n"));

        let mut close = Vec::new();
        write_response(
            &mut close,
            302,
            CONTENT_TYPE_NONE,
            b"",
            &[(b"Location".to_vec(), b"/".to_vec())],
            ConnectionDirective::Close,
        )
        .expect("write close response");
        assert!(find(&close, b"Connection: close\r\n"));
        assert!(find(&close, b"Location: /\r\n"));
        assert!(!find(&close, b"Content-Type:"));
    }

    fn find(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }
}
