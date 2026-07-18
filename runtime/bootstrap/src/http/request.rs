use std::{
    io::{self, Read},
    mem,
};

use crate::abi::{TinyHeader, TinyStringView};

const MAX_REQUEST_HEAD: usize = 16 * 1024;
pub(super) const MAX_REQUEST_BODY: usize = 64 * 1024;
const MAX_REQUEST_HEADERS: usize = 64;

pub(super) struct ConnectionInput {
    bytes: Vec<u8>,
}

impl ConnectionInput {
    pub(super) fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(1024),
        }
    }

    pub(super) fn read_head(&mut self, stream: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
        loop {
            if let Some(end) = request_head_end(&self.bytes) {
                let mut head = mem::take(&mut self.bytes);
                self.bytes = head.split_off(end);
                return Ok(Some(head));
            }
            if self.bytes.len() == MAX_REQUEST_HEAD {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "request head exceeds limit",
                ));
            }

            let mut buffer = [0_u8; 1024];
            let available = (MAX_REQUEST_HEAD - self.bytes.len()).min(buffer.len());
            let read = stream.read(&mut buffer[..available])?;
            if read == 0 {
                return if self.bytes.is_empty() {
                    Ok(None)
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "incomplete request head",
                    ))
                };
            }
            self.bytes.extend_from_slice(&buffer[..read]);
        }
    }

    pub(super) fn has_complete_head(&self) -> bool {
        request_head_end(&self.bytes).is_some()
    }

    pub(super) fn read_body(
        &mut self,
        stream: &mut impl Read,
        length: usize,
    ) -> io::Result<Vec<u8>> {
        let buffered = length.min(self.bytes.len());
        let mut body = self.bytes.drain(..buffered).collect::<Vec<_>>();
        let mut remaining = length - body.len();
        let mut buffer = [0_u8; 4096];
        while remaining != 0 {
            let available = remaining.min(buffer.len());
            let read = stream.read(&mut buffer[..available])?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "incomplete request body",
                ));
            }
            body.extend_from_slice(&buffer[..read]);
            remaining -= read;
        }
        Ok(body)
    }
}

pub(super) struct ParsedHeaders {
    pub(super) headers: Vec<TinyHeader>,
    pub(super) content_length: usize,
    pub(super) connection_close: bool,
    pub(super) transfer_encoded: bool,
}

pub(super) fn parse_request_line(request: &[u8]) -> Option<(&[u8], &[u8], &[u8])> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let mut fields = request[..line_end].split(|byte| *byte == b' ');
    let method = fields.next()?;
    let target = fields.next()?;
    let version = fields.next()?;
    if fields.next().is_some()
        || !matches!(version, b"HTTP/1.0" | b"HTTP/1.1")
        || !target.starts_with(b"/")
    {
        return None;
    }
    Some((method, target, version))
}

pub(super) fn parse_request_headers(request: &[u8]) -> Option<ParsedHeaders> {
    let first_line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let mut headers = Vec::new();
    let mut content_length = None;
    let mut connection_close = false;
    let mut transfer_encoded = false;
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
        let value = trim_ascii_whitespace(&line[separator + 1..]);
        if name.eq_ignore_ascii_case(b"content-length") {
            if content_length.is_some() || value.is_empty() {
                return None;
            }
            content_length = Some(parse_decimal(value)?);
        } else if name.eq_ignore_ascii_case(b"connection") {
            connection_close |= contains_token(value, b"close");
        } else if name.eq_ignore_ascii_case(b"transfer-encoding") && !value.is_empty() {
            transfer_encoded = true;
        }
        headers.push(TinyHeader {
            name: TinyStringView::from_bytes(name),
            value: TinyStringView::from_bytes(value),
        });
    }
    Some(ParsedHeaders {
        headers,
        content_length: content_length.unwrap_or(0),
        connection_close,
        transfer_encoded,
    })
}

pub(super) fn is_timeout(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

fn request_head_end(request: &[u8]) -> Option<usize> {
    request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn parse_decimal(value: &[u8]) -> Option<usize> {
    value.iter().try_fold(0_usize, |result, byte| {
        let digit = byte.checked_sub(b'0').filter(|digit| *digit < 10)?;
        result.checked_mul(10)?.checked_add(usize::from(digit))
    })
}

fn contains_token(value: &[u8], expected: &[u8]) -> bool {
    value
        .split(|byte| *byte == b',')
        .map(trim_ascii_whitespace)
        .any(|token| token.eq_ignore_ascii_case(expected))
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

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::{ConnectionInput, parse_request_headers, parse_request_line};

    #[test]
    fn parses_get_request_line_and_version() {
        let (method, target, version) =
            parse_request_line(b"GET /hello?name=Ada HTTP/1.1\r\nHost: x\r\n")
                .expect("valid request");
        assert_eq!(method, b"GET");
        assert_eq!(target, b"/hello?name=Ada");
        assert_eq!(version, b"HTTP/1.1");
    }

    #[test]
    fn rejects_unknown_http_versions_and_extra_fields() {
        assert!(parse_request_line(b"GET / HTTP/1.2\r\n").is_none());
        assert!(parse_request_line(b"GET / HTTP/1.1 extra\r\n").is_none());
    }

    #[test]
    fn parses_borrowed_headers_and_transport_metadata() {
        let request = b"GET / HTTP/1.1\r\nHost: localhost\r\nUser-Agent: tiny-client/1.0\r\nContent-Length: 12\r\nConnection: upgrade, Close\r\n\r\n";
        let parsed = parse_request_headers(request).expect("valid headers");

        assert_eq!(parsed.headers.len(), 4);
        assert_eq!(bytes(parsed.headers[1].name), b"User-Agent");
        assert_eq!(bytes(parsed.headers[1].value), b"tiny-client/1.0");
        assert_eq!(parsed.content_length, 12);
        assert!(parsed.connection_close);
        assert!(!parsed.transfer_encoded);
    }

    #[test]
    fn rejects_duplicate_or_invalid_content_lengths() {
        assert!(
            parse_request_headers(
                b"POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\n"
            )
            .is_none()
        );
        assert!(parse_request_headers(b"POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n").is_none());
    }

    #[test]
    fn preserves_the_bounded_body_and_pipelined_bytes() {
        let mut input = ConnectionInput::new();
        let mut stream = Cursor::new(
            b"POST /first HTTP/1.1\r\nContent-Length: 4\r\n\r\nbodyGET /second HTTP/1.1\r\n\r\n",
        );

        let first = input
            .read_head(&mut stream)
            .expect("read first head")
            .expect("first request");
        assert!(first.starts_with(b"POST /first"));
        assert_eq!(input.read_body(&mut stream, 4).expect("read body"), b"body");
        let second = input
            .read_head(&mut stream)
            .expect("read second head")
            .expect("second request");
        assert!(second.starts_with(b"GET /second"));
    }

    #[test]
    fn distinguishes_complete_pipelined_heads_from_partial_input() {
        let mut partial = ConnectionInput::new();
        partial
            .bytes
            .extend_from_slice(b"GET /next HTTP/1.1\r\nHost: x\r\n");
        assert!(!partial.has_complete_head());

        partial.bytes.extend_from_slice(b"\r\n");
        assert!(partial.has_complete_head());
    }

    fn bytes(view: crate::abi::TinyStringView) -> Vec<u8> {
        // SAFETY: Test views point into the request byte literal for this call.
        unsafe { std::slice::from_raw_parts(view.ptr, view.len) }.to_vec()
    }
}
