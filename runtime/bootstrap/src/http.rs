use std::{
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    time::Duration,
};

use tinytsx_runtime_worker::WorkerPool;

use crate::abi::{
    BAD_REQUEST, CONTENT_TYPE_HTML, CONTENT_TYPE_JSON, CONTENT_TYPE_NONE,
    CONTENT_TYPE_RESPONSE_TEXT, CONTENT_TYPE_TEXT, INTERNAL_ERROR, NOT_FOUND, OK, RENDER_ERROR,
    REQUEST_OOM, TinyHeader, TinyStringView, configured_port, configured_request_memory,
    configured_workers, render, request_with_headers,
};

const MAX_REQUEST_HEAD: usize = 16 * 1024;
const MAX_REQUEST_HEADERS: usize = 64;
const CONNECTION_QUEUE_PER_WORKER: usize = 8;

pub fn serve() -> std::io::Result<()> {
    let port = configured_port();
    let workers = configured_workers();
    let request_memory = configured_request_memory();
    let queue_capacity = workers
        .checked_mul(CONNECTION_QUEUE_PER_WORKER)
        .ok_or_else(|| std::io::Error::other("connection queue capacity overflow"))?;
    let pool = WorkerPool::new(
        workers,
        queue_capacity,
        move |_| request_memory,
        |request_memory, mut stream| {
            if let Err(error) = handle_connection(&mut stream, *request_memory) {
                eprintln!("request error: {error}");
            }
        },
    )?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("TinyTSX listening on http://127.0.0.1:{port}");
    println!("Workers: {workers}; queued connections: {queue_capacity}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(rejected) = pool.try_submit(stream) {
                    let mut stream = rejected.into_inner();
                    if let Err(error) = write_overload_response(&mut stream) {
                        eprintln!("overload response error: {error}");
                    }
                }
            }
            Err(error) => eprintln!("accept error: {error}"),
        }
    }
    Ok(())
}

fn write_overload_response(stream: &mut TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_millis(10)))?;
    let _ = read_request_head(stream);
    write_response(stream, 503, CONTENT_TYPE_TEXT, b"server overloaded", &[])?;
    stream.shutdown(Shutdown::Write)
}

fn handle_connection(stream: &mut TcpStream, request_memory: usize) -> std::io::Result<()> {
    let head = match read_request_head(stream) {
        Ok(head) => head,
        Err(_) => return write_response(stream, 400, CONTENT_TYPE_TEXT, b"bad request", &[]),
    };
    let Some((method, target)) = parse_request_line(&head) else {
        return write_response(stream, 400, CONTENT_TYPE_TEXT, b"bad request", &[]);
    };
    if method != b"GET" && method != b"POST" {
        return write_response(stream, 405, CONTENT_TYPE_TEXT, b"method not allowed", &[]);
    }

    let Some(headers) = parse_request_headers(&head) else {
        return write_response(stream, 400, CONTENT_TYPE_TEXT, b"bad request", &[]);
    };
    let request = request_with_headers(method, target, &headers);
    let response = render(&request, request_memory);
    match response.application_status {
        OK => write_response(
            stream,
            response.http_status,
            response.content_type,
            &response.body,
            &response.headers,
        ),
        REQUEST_OOM => write_response(
            stream,
            503,
            CONTENT_TYPE_TEXT,
            b"request memory exhausted",
            &[],
        ),
        BAD_REQUEST => write_response(stream, 400, CONTENT_TYPE_TEXT, b"bad request", &[]),
        NOT_FOUND => write_response(stream, 404, CONTENT_TYPE_TEXT, b"not found", &[]),
        RENDER_ERROR | INTERNAL_ERROR => write_response(
            stream,
            500,
            CONTENT_TYPE_TEXT,
            b"internal server error",
            &[],
        ),
        _ => write_response(
            stream,
            500,
            CONTENT_TYPE_TEXT,
            b"unknown application status",
            &[],
        ),
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

fn parse_request_headers(request: &[u8]) -> Option<Vec<TinyHeader>> {
    let first_line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let mut headers = Vec::new();
    for line in request[first_line_end + 2..].split(|byte| *byte == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.is_empty() {
            break;
        }
        if headers.len() == MAX_REQUEST_HEADERS {
            return None;
        }
        let separator = line.iter().position(|byte| *byte == b':')?;
        let name = &line[..separator];
        if name.is_empty() {
            return None;
        }
        headers.push(TinyHeader {
            name: TinyStringView::from_bytes(name),
            value: TinyStringView::from_bytes(trim_ascii_whitespace(&line[separator + 1..])),
        });
    }
    Some(headers)
}

fn trim_ascii_whitespace(mut value: &[u8]) -> &[u8] {
    while value.first().is_some_and(u8::is_ascii_whitespace) {
        value = &value[1..];
    }
    while value.last().is_some_and(u8::is_ascii_whitespace) {
        value = &value[..value.len() - 1];
    }
    value
}

fn write_response(
    stream: &mut impl Write,
    status: u16,
    content_type: u16,
    body: &[u8],
    headers: &[(Vec<u8>, Vec<u8>)],
) -> std::io::Result<()> {
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
        stream.write_all(name)?;
        stream.write_all(b": ")?;
        stream.write_all(value)?;
        stream.write_all(b"\r\n")?;
    }
    write!(
        stream,
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

#[cfg(test)]
mod tests {
    use super::{parse_request_headers, parse_request_line, write_response};
    use crate::abi::CONTENT_TYPE_NONE;

    #[test]
    fn parses_get_request_line() {
        let (method, target) = parse_request_line(b"GET /hello?name=Ada HTTP/1.1\r\nHost: x\r\n")
            .expect("valid request");
        assert_eq!(method, b"GET");
        assert_eq!(target, b"/hello?name=Ada");
    }

    #[test]
    fn parses_post_request_line() {
        let (method, target) =
            parse_request_line(b"POST /api/posts HTTP/1.1\r\nHost: x\r\n").expect("valid request");
        assert_eq!(method, b"POST");
        assert_eq!(target, b"/api/posts");
    }

    #[test]
    fn rejects_extra_request_line_fields() {
        assert!(parse_request_line(b"GET / HTTP/1.1 extra\r\n").is_none());
    }

    #[test]
    fn parses_borrowed_request_headers() {
        let request = b"GET / HTTP/1.1\r\nHost: localhost\r\nUser-Agent: tiny-client/1.0\r\n\r\n";

        let headers = parse_request_headers(request).expect("valid headers");

        assert_eq!(headers.len(), 2);
        assert_eq!(bytes(headers[1].name), b"User-Agent");
        assert_eq!(bytes(headers[1].value), b"tiny-client/1.0");
    }

    #[test]
    fn response_without_content_type_omits_the_header() {
        let mut response = Vec::new();

        write_response(
            &mut response,
            302,
            CONTENT_TYPE_NONE,
            b"",
            &[(b"Location".to_vec(), b"/".to_vec())],
        )
        .expect("write response");

        let response = String::from_utf8(response).expect("UTF-8 response");
        assert!(response.starts_with("HTTP/1.1 302 Found\r\nLocation: /\r\n"));
        assert!(!response.contains("Content-Type:"));
    }

    fn bytes(view: crate::abi::TinyStringView) -> Vec<u8> {
        // SAFETY: Test views point into the request byte literal for this call.
        unsafe { std::slice::from_raw_parts(view.ptr, view.len) }.to_vec()
    }
}
