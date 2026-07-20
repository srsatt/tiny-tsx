use std::{
    io::{self, IoSlice, Write},
    net::{Shutdown, TcpStream},
};

use crate::abi::{
    CONTENT_TYPE_HTML, CONTENT_TYPE_JSON, CONTENT_TYPE_NONE, CONTENT_TYPE_RESPONSE_TEXT,
    CONTENT_TYPE_STREAM_TEXT, CONTENT_TYPE_TEXT, TinyHeader, TinyStringView,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ConnectionDirective {
    KeepAlive,
    Close,
}

pub(super) fn write_terminal_response(
    stream: &mut TcpStream,
    head: &mut Vec<u8>,
    status: u16,
    body: &[u8],
) -> io::Result<()> {
    write_response(
        stream,
        head,
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
    head: &mut Vec<u8>,
    status: u16,
    content_type: u16,
    body: &[u8],
    headers: &[TinyHeader],
    connection: ConnectionDirective,
) -> io::Result<()> {
    write_response_head(
        head,
        status,
        content_type,
        headers,
        connection,
        BodyFraming::ContentLength(body.len()),
    )?;
    write_all_vectored(stream, &[IoSlice::new(head), IoSlice::new(body)])?;
    stream.flush()
}

pub(super) fn write_head_response(
    stream: &mut impl Write,
    head: &mut Vec<u8>,
    status: u16,
    content_type: u16,
    content_length: usize,
    headers: &[TinyHeader],
    connection: ConnectionDirective,
) -> io::Result<()> {
    write_response_head(
        head,
        status,
        content_type,
        headers,
        connection,
        BodyFraming::ContentLength(content_length),
    )?;
    stream.write_all(head)?;
    stream.flush()
}

pub(super) fn write_stream_response<'a>(
    stream: &mut impl Write,
    head: &mut Vec<u8>,
    status: u16,
    content_type: u16,
    chunks: impl IntoIterator<Item = &'a [u8]>,
    headers: &[TinyHeader],
    connection: ConnectionDirective,
) -> io::Result<()> {
    write_response_head(
        head,
        status,
        content_type,
        headers,
        connection,
        BodyFraming::Chunked,
    )?;
    stream.write_all(head)?;
    for chunk in chunks {
        write!(stream, "{:x}\r\n", chunk.len())?;
        stream.write_all(chunk)?;
        stream.write_all(b"\r\n")?;
        stream.flush()?;
    }
    stream.write_all(b"0\r\n\r\n")?;
    stream.flush()
}

enum BodyFraming {
    ContentLength(usize),
    Chunked,
}

fn write_response_head(
    head: &mut Vec<u8>,
    status: u16,
    content_type: u16,
    headers: &[TinyHeader],
    connection: ConnectionDirective,
    framing: BodyFraming,
) -> io::Result<()> {
    head.clear();
    let reason = match status {
        200 => "OK",
        201 => "Created",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
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
    write!(head, "HTTP/1.1 {status} {reason}\r\n")?;
    if content_type != CONTENT_TYPE_NONE {
        let content_type = match content_type {
            CONTENT_TYPE_HTML => "text/html; charset=utf-8",
            CONTENT_TYPE_TEXT => "text/plain; charset=UTF-8",
            CONTENT_TYPE_JSON => "application/json",
            CONTENT_TYPE_RESPONSE_TEXT => "text/plain;charset=UTF-8",
            CONTENT_TYPE_STREAM_TEXT => "text/plain; charset=utf-8",
            _ => "application/octet-stream",
        };
        write!(head, "Content-Type: {content_type}\r\n")?;
    }
    for header in headers {
        let name = view_bytes(header, header.name);
        if is_framing_header(name) {
            continue;
        }
        let value = view_bytes(header, header.value);
        head.write_all(name)?;
        head.write_all(b": ")?;
        head.write_all(value)?;
        head.write_all(b"\r\n")?;
    }
    let connection = match connection {
        ConnectionDirective::KeepAlive => "keep-alive",
        ConnectionDirective::Close => "close",
    };
    match framing {
        BodyFraming::ContentLength(length) => write!(head, "Content-Length: {length}\r\n")?,
        BodyFraming::Chunked => head.write_all(b"Transfer-Encoding: chunked\r\n")?,
    }
    write!(head, "Connection: {connection}\r\n\r\n")
}

fn view_bytes(_header: &TinyHeader, view: TinyStringView) -> &[u8] {
    if view.len == 0 {
        return &[];
    }
    // SAFETY: response header views point at generated static data or the live request arena.
    unsafe { std::slice::from_raw_parts(view.ptr, view.len) }
}

fn write_all_vectored(stream: &mut impl Write, slices: &[IoSlice<'_>]) -> io::Result<()> {
    let written = loop {
        match stream.write_vectored(slices) {
            Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
            Ok(written) => break written,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    };
    let mut consumed = written;
    for slice in slices {
        if consumed >= slice.len() {
            consumed -= slice.len();
        } else {
            stream.write_all(&slice[consumed..])?;
            consumed = 0;
        }
    }
    Ok(())
}

fn is_framing_header(name: &[u8]) -> bool {
    name.eq_ignore_ascii_case(b"connection")
        || name.eq_ignore_ascii_case(b"content-length")
        || name.eq_ignore_ascii_case(b"transfer-encoding")
}

#[cfg(test)]
mod tests {
    use std::io::{self, IoSlice, Write};

    use super::{ConnectionDirective, write_response, write_stream_response};
    use crate::abi::{
        CONTENT_TYPE_NONE, CONTENT_TYPE_STREAM_TEXT, TinyHeader, TinyStringView,
    };

    #[test]
    fn response_selects_keep_alive_or_close() {
        let mut keep_alive = Vec::new();
        let mut head = Vec::new();
        write_response(
            &mut keep_alive,
            &mut head,
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
            &mut head,
            302,
            CONTENT_TYPE_NONE,
            b"",
            &[header(b"Location", b"/")],
            ConnectionDirective::Close,
        )
        .expect("write close response");
        assert!(find(&close, b"Connection: close\r\n"));
        assert!(find(&close, b"Location: /\r\n"));
        assert!(!find(&close, b"Content-Type:"));
    }

    #[test]
    fn streaming_response_uses_http_chunks_without_content_length() {
        let mut output = Vec::new();
        let mut head = Vec::new();
        write_stream_response(
            &mut output,
            &mut head,
            200,
            CONTENT_TYPE_STREAM_TEXT,
            [b"first\n".as_slice(), b"second\n".as_slice()],
            &[header(b"Transfer-Encoding", b"invalid-duplicate")],
            ConnectionDirective::KeepAlive,
        )
        .expect("write stream response");

        assert!(find(&output, b"Transfer-Encoding: chunked\r\n"));
        assert!(find(
            &output,
            b"Content-Type: text/plain; charset=utf-8\r\n"
        ));
        assert!(!find(&output, b"Content-Length:"));
        assert!(find(&output, b"6\r\nfirst\n\r\n7\r\nsecond\n\r\n0\r\n\r\n"));
        assert!(!find(&output, b"invalid-duplicate"));
    }

    #[test]
    fn fixed_response_writes_head_and_body_in_one_vectored_call() {
        let mut output = CountingWriter::default();
        let mut head = Vec::with_capacity(256);

        write_response(
            &mut output,
            &mut head,
            200,
            CONTENT_TYPE_NONE,
            b"hello",
            &[],
            ConnectionDirective::KeepAlive,
        )
        .expect("write response");

        assert_eq!(output.vectored_calls, 1);
        assert_eq!(output.scalar_calls, 0);
        assert!(output.bytes.ends_with(b"\r\n\r\nhello"));
    }

    #[derive(Default)]
    struct CountingWriter {
        bytes: Vec<u8>,
        scalar_calls: usize,
        vectored_calls: usize,
    }

    impl Write for CountingWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.scalar_calls += 1;
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn write_vectored(&mut self, slices: &[IoSlice<'_>]) -> io::Result<usize> {
            self.vectored_calls += 1;
            let length = slices.iter().map(|slice| slice.len()).sum();
            for slice in slices {
                self.bytes.extend_from_slice(slice);
            }
            Ok(length)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn find(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn header(name: &'static [u8], value: &'static [u8]) -> TinyHeader {
        TinyHeader {
            name: TinyStringView::from_bytes(name),
            value: TinyStringView::from_bytes(value),
        }
    }
}
