use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
};

use crate::abi::{
    BAD_REQUEST, INTERNAL_ERROR, NOT_FOUND, OK, RENDER_ERROR, REQUEST_OOM, configured_port,
    configured_request_memory, render, request,
};

const MAX_REQUEST_HEAD: usize = 16 * 1024;

pub fn serve() -> std::io::Result<()> {
    let port = configured_port();
    let request_memory = configured_request_memory();
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("TinyTSX listening on http://127.0.0.1:{port}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(error) = handle_connection(&mut stream, request_memory) {
                    eprintln!("request error: {error}");
                }
            }
            Err(error) => eprintln!("accept error: {error}"),
        }
    }
    Ok(())
}

fn handle_connection(stream: &mut TcpStream, request_memory: usize) -> std::io::Result<()> {
    let head = match read_request_head(stream) {
        Ok(head) => head,
        Err(_) => return write_response(stream, 400, b"bad request"),
    };
    let Some((method, target)) = parse_request_line(&head) else {
        return write_response(stream, 400, b"bad request");
    };
    if method != b"GET" {
        return write_response(stream, 405, b"method not allowed");
    }

    let request = request(method, target);
    let (status, body) = render(&request, request_memory);
    match status {
        OK => write_response(stream, 200, &body),
        REQUEST_OOM => write_response(stream, 503, b"request memory exhausted"),
        BAD_REQUEST => write_response(stream, 400, b"bad request"),
        NOT_FOUND => write_response(stream, 404, b"not found"),
        RENDER_ERROR | INTERNAL_ERROR => write_response(stream, 500, b"internal server error"),
        _ => write_response(stream, 500, b"unknown application status"),
    }
}

fn read_request_head(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(request);
        }
        if request.len() >= MAX_REQUEST_HEAD {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request head exceeds limit",
            ));
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::UnexpectedEof,
        "incomplete request head",
    ))
}

fn parse_request_line(request: &[u8]) -> Option<(&[u8], &[u8])> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let mut fields = request[..line_end].split(|byte| *byte == b' ');
    let method = fields.next()?;
    let target = fields.next()?;
    let version = fields.next()?;
    if fields.next().is_some() || !version.starts_with(b"HTTP/1.") || !target.starts_with(b"/") {
        return None;
    }
    Some((method, target))
}

fn write_response(stream: &mut TcpStream, status: u16, body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Unknown",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
    )?;
    stream.write_all(body)
}

#[cfg(test)]
mod tests {
    use super::parse_request_line;

    #[test]
    fn parses_get_request_line() {
        let (method, target) = parse_request_line(b"GET /hello?name=Ada HTTP/1.1\r\nHost: x\r\n")
            .expect("valid request");
        assert_eq!(method, b"GET");
        assert_eq!(target, b"/hello?name=Ada");
    }

    #[test]
    fn rejects_extra_request_line_fields() {
        assert!(parse_request_line(b"GET / HTTP/1.1 extra\r\n").is_none());
    }
}
