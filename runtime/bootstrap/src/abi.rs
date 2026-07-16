use std::{
    ffi::c_void,
    io::{self, Write},
    os::raw::{c_char, c_long},
    ptr, slice,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::environment::{self, SnapshotValue};

pub const OK: u32 = 0;
pub const REQUEST_OOM: u32 = 1;
pub const BAD_REQUEST: u32 = 2;
pub const RENDER_ERROR: u32 = 3;
pub const INTERNAL_ERROR: u32 = 4;
pub const NOT_FOUND: u32 = 5;
pub const APPLICATION_OVERLOAD: u32 = 6;

pub const CONTENT_TYPE_NONE: u16 = 0;
pub const CONTENT_TYPE_HTML: u16 = 1;
pub const CONTENT_TYPE_TEXT: u16 = 2;
pub const CONTENT_TYPE_JSON: u16 = 3;
pub const CONTENT_TYPE_RESPONSE_TEXT: u16 = 4;
pub const CONTENT_TYPE_STREAM_TEXT: u16 = 5;
pub const MAX_RESPONSE_HEADERS: usize = 8;
pub const MAX_DYNAMIC_HEADER_BYTES: usize = 256;
pub const MAX_STREAM_CHUNKS: usize = 16;

const MAX_FETCH_URL_BYTES: usize = 2048;
const MAX_PROVIDER_AUTHORIZATION_BYTES: usize = 1024;
const MAX_PROVIDER_BODY_BYTES: usize = 8192;
const MAX_PROVIDER_RESPONSE_BYTES: usize = 262_144;
const CURLOPT_URL: u32 = 10_002;
const CURLOPT_WRITEDATA: u32 = 10_001;
const CURLOPT_WRITEFUNCTION: u32 = 20_011;
const CURLOPT_POST: u32 = 47;
const CURLOPT_POSTFIELDS: u32 = 10_015;
const CURLOPT_POSTFIELDSIZE: u32 = 60;
const CURLOPT_HTTPHEADER: u32 = 10_023;
const CURLOPT_FOLLOWLOCATION: u32 = 52;
const CURLOPT_NOSIGNAL: u32 = 99;
const CURLOPT_TIMEOUT_MS: u32 = 155;
const CURLINFO_RESPONSE_CODE: u32 = 0x20_0002;
const CURL_GLOBAL_DEFAULT: c_long = 3;
const CURLE_OK: i32 = 0;

type CurlWriteCallback = unsafe extern "C" fn(*mut c_char, usize, usize, *mut c_void) -> usize;

#[link(name = "curl")]
unsafe extern "C" {
    fn curl_global_init(flags: c_long) -> i32;
    fn curl_easy_init() -> *mut c_void;
    fn curl_easy_setopt(handle: *mut c_void, option: u32, ...) -> i32;
    fn curl_easy_perform(handle: *mut c_void) -> i32;
    fn curl_easy_getinfo(handle: *mut c_void, info: u32, ...) -> i32;
    fn curl_easy_cleanup(handle: *mut c_void);
    fn curl_slist_append(list: *mut c_void, value: *const c_char) -> *mut c_void;
    fn curl_slist_free_all(list: *mut c_void);
}

static CURL_READY: OnceLock<bool> = OnceLock::new();

pub(crate) struct OpenAiTransport {
    handle: *mut c_void,
}

impl Default for OpenAiTransport {
    fn default() -> Self {
        Self {
            handle: ptr::null_mut(),
        }
    }
}

// SAFETY: a transport is owned by one logical application worker. Its mutex
// prevents simultaneous use when the worker is scheduled on another executor.
unsafe impl Send for OpenAiTransport {}

impl Drop for OpenAiTransport {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: this transport exclusively owns its easy handle.
            unsafe { curl_easy_cleanup(self.handle) };
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TinyStringView {
    pub ptr: *const u8,
    pub len: usize,
}

const EMPTY_VIEW: TinyStringView = TinyStringView {
    ptr: ptr::null(),
    len: 0,
};

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TinyHeader {
    pub name: TinyStringView,
    pub value: TinyStringView,
}

const EMPTY_HEADER: TinyHeader = TinyHeader {
    name: EMPTY_VIEW,
    value: EMPTY_VIEW,
};

impl TinyStringView {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}

#[repr(C)]
pub struct TinyArena {
    _private: [u8; 0],
}

#[repr(C)]
pub struct TinyRequest {
    pub method: TinyStringView,
    pub path: TinyStringView,
    pub query: TinyStringView,
    pub headers: *const TinyHeader,
    pub header_count: usize,
    pub arena: *mut TinyArena,
}

#[repr(C)]
pub struct TinyResponseWriter {
    pub start: *mut u8,
    pub cursor: *mut u8,
    pub end: *mut u8,
    pub status: u32,
    pub http_status: u16,
    pub content_type: u16,
    pub header_count: usize,
    pub headers: [TinyHeader; MAX_RESPONSE_HEADERS],
    pub dynamic_header_cursor: usize,
    pub dynamic_header_bytes: [u8; MAX_DYNAMIC_HEADER_BYTES],
    pub streaming: u32,
    pub stream_chunk_count: usize,
    pub stream_chunks: [TinyStringView; MAX_STREAM_CHUNKS],
    pub stream_chunk_start: *mut u8,
}

#[cfg(feature = "generated")]
unsafe extern "C" {
    pub fn tinytsx_handle_get(request: *const TinyRequest, writer: *mut TinyResponseWriter) -> u32;
    pub fn tinytsx_config_port() -> u16;
    pub fn tinytsx_config_workers() -> usize;
    pub fn tinytsx_config_request_memory() -> usize;
    pub fn tinytsx_config_worker_modules() -> usize;
    pub fn tinytsx_config_provider_transport() -> usize;
    pub fn tinytsx_config_environment_variables() -> usize;
    pub fn tinytsx_config_environment_variable(
        index: usize,
        pointer: *mut *const u8,
        length: *mut usize,
    ) -> u32;
    pub fn tinytsx_config_read_roots() -> usize;
    pub fn tinytsx_config_read_root(
        index: usize,
        pointer: *mut *const u8,
        length: *mut usize,
    ) -> u32;
    pub fn tinytsx_worker_operation(worker: usize) -> u32;
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_handle_get(
    _request: *const TinyRequest,
    _writer: *mut TinyResponseWriter,
) -> u32 {
    OK
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_port() -> u16 {
    3000
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_workers() -> usize {
    1
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_request_memory() -> usize {
    262_144
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_worker_modules() -> usize {
    0
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_provider_transport() -> usize {
    0
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_environment_variables() -> usize {
    0
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_environment_variable(
    _index: usize,
    _pointer: *mut *const u8,
    _length: *mut usize,
) -> u32 {
    INTERNAL_ERROR
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_read_roots() -> usize {
    0
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_config_read_root(
    _index: usize,
    _pointer: *mut *const u8,
    _length: *mut usize,
) -> u32 {
    INTERNAL_ERROR
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_worker_operation(_worker: usize) -> u32 {
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_worker_call_static(
    writer: *mut TinyResponseWriter,
    worker: usize,
    input: *const u8,
    input_len: usize,
) -> u32 {
    if writer.is_null() || (input.is_null() && input_len != 0) {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated static string data is valid for the duration of this call.
    let input = unsafe { slice::from_raw_parts(input, input_len) };
    write_worker_reply(writer, worker, input)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_worker_call_query(
    writer: *mut TinyResponseWriter,
    request: *const TinyRequest,
    worker: usize,
    expected: *const u8,
    expected_len: usize,
    fallback: *const u8,
    fallback_len: usize,
) -> u32 {
    if writer.is_null()
        || request.is_null()
        || (expected.is_null() && expected_len != 0)
        || (fallback.is_null() && fallback_len != 0)
    {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code supplies valid request and static string views.
    let query = unsafe { &(*request).query };
    if query.ptr.is_null() && query.len != 0 {
        return INTERNAL_ERROR;
    }
    // SAFETY: The request and generated string views remain valid synchronously.
    let query = unsafe { slice::from_raw_parts(query.ptr, query.len) };
    let expected = unsafe { slice::from_raw_parts(expected, expected_len) };
    let mut input = None;
    for part in query.split(|byte| *byte == b'&') {
        let separator = part.iter().position(|byte| *byte == b'=');
        let name = separator.map_or(part, |index| &part[..index]);
        if !part.is_empty() && form_urlencoded_name_equals(name, expected) {
            input = Some(decode_form_urlencoded(
                separator.map_or(&[][..], |index| &part[index + 1..]),
            ));
            break;
        }
    }
    let fallback = if fallback_len == 0 {
        &[][..]
    } else {
        // SAFETY: The non-empty fallback pointer was checked above.
        unsafe { slice::from_raw_parts(fallback, fallback_len) }
    };
    write_worker_reply(writer, worker, input.as_deref().unwrap_or(fallback))
}

fn decode_form_urlencoded(encoded: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(encoded.len());
    let mut cursor = 0;
    while cursor < encoded.len() {
        if encoded[cursor] == b'+' {
            output.push(b' ');
            cursor += 1;
        } else if let Some(byte) = percent_byte(encoded, cursor) {
            output.push(byte);
            cursor += 3;
        } else {
            output.push(encoded[cursor]);
            cursor += 1;
        }
    }
    output
}

fn write_worker_reply(writer: *mut TinyResponseWriter, worker: usize, input: &[u8]) -> u32 {
    match crate::application::call(worker, input) {
        Ok(output) => {
            // SAFETY: The worker reply remains alive while it is copied into the request arena.
            unsafe { tinytsx_html_write_static(writer, output.as_ptr(), output.len()) }
        }
        Err(status) => {
            // SAFETY: The generated handler supplied this non-null writer.
            unsafe { (*writer).status = status };
            status
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_static(
    writer: *mut TinyResponseWriter,
    bytes: *const u8,
    len: usize,
) -> u32 {
    if writer.is_null() || (bytes.is_null() && len != 0) {
        return INTERNAL_ERROR;
    }

    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    let start = writer.start as usize;
    let cursor = writer.cursor as usize;
    let end = writer.end as usize;
    if cursor < start || cursor > end || len > end - cursor {
        writer.status = REQUEST_OOM;
        return REQUEST_OOM;
    }

    if len != 0 {
        // SAFETY: The bounds check above proves the destination has `len` bytes.
        // The generated source points at immutable static data for at least `len` bytes.
        unsafe { ptr::copy_nonoverlapping(bytes, writer.cursor, len) };
        // SAFETY: The bounds check above proves this pointer remains in the allocation.
        writer.cursor = unsafe { writer.cursor.add(len) };
    }
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_console_error_static(bytes: *const u8, len: usize) -> u32 {
    if bytes.is_null() && len != 0 {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code points at immutable static data for `len` bytes.
    let bytes = unsafe { slice::from_raw_parts(bytes, len) };
    let mut stderr = io::stderr().lock();
    write_console_error(&mut stderr, bytes)
}

fn write_console_error(output: &mut impl Write, bytes: &[u8]) -> u32 {
    match output
        .write_all(bytes)
        .and_then(|()| output.write_all(b"\n"))
    {
        Ok(()) => OK,
        Err(_) => INTERNAL_ERROR,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_begin(
    writer: *mut TinyResponseWriter,
    http_status: u16,
    content_type: u16,
) -> u32 {
    if writer.is_null() {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    if !(100..=599).contains(&http_status)
        || !matches!(
            content_type,
            CONTENT_TYPE_NONE
                | CONTENT_TYPE_HTML
                | CONTENT_TYPE_TEXT
                | CONTENT_TYPE_JSON
                | CONTENT_TYPE_RESPONSE_TEXT
                | CONTENT_TYPE_STREAM_TEXT
        )
    {
        writer.status = INTERNAL_ERROR;
        return INTERNAL_ERROR;
    }
    writer.http_status = http_status;
    writer.content_type = content_type;
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_stream_begin(writer: *mut TinyResponseWriter) -> u32 {
    if writer.is_null() {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    writer.streaming = 1;
    writer.stream_chunk_count = 0;
    writer.stream_chunk_start = ptr::null_mut();
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_stream_chunk_static(
    writer: *mut TinyResponseWriter,
    bytes: *const u8,
    len: usize,
) -> u32 {
    if writer.is_null() || (bytes.is_null() && len != 0) {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    if writer.streaming == 0
        || !writer.stream_chunk_start.is_null()
        || writer.stream_chunk_count >= MAX_STREAM_CHUNKS
    {
        writer.status = RENDER_ERROR;
        return RENDER_ERROR;
    }
    writer.stream_chunks[writer.stream_chunk_count] = TinyStringView { ptr: bytes, len };
    writer.stream_chunk_count += 1;
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_stream_chunk_begin(
    writer: *mut TinyResponseWriter,
) -> u32 {
    if writer.is_null() {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    if writer.streaming == 0
        || !writer.stream_chunk_start.is_null()
        || writer.stream_chunk_count >= MAX_STREAM_CHUNKS
    {
        writer.status = RENDER_ERROR;
        return RENDER_ERROR;
    }
    writer.stream_chunk_start = writer.cursor;
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_stream_chunk_end(writer: *mut TinyResponseWriter) -> u32 {
    if writer.is_null() {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    if writer.streaming == 0 || writer.stream_chunk_start.is_null() {
        writer.status = RENDER_ERROR;
        return RENDER_ERROR;
    }
    let len = writer.cursor as usize - writer.stream_chunk_start as usize;
    writer.stream_chunks[writer.stream_chunk_count] = TinyStringView {
        ptr: writer.stream_chunk_start,
        len,
    };
    writer.stream_chunk_count += 1;
    writer.stream_chunk_start = ptr::null_mut();
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_path_equals(
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
) -> u32 {
    if request.is_null() || (expected.is_null() && expected_len != 0) {
        return 0;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let path = unsafe { &(*request).path };
    if path.len != expected_len || (path.ptr.is_null() && path.len != 0) {
        return 0;
    }
    // SAFETY: Both views are valid for their declared lengths during this call.
    let actual = unsafe { slice::from_raw_parts(path.ptr, path.len) };
    let expected = unsafe { slice::from_raw_parts(expected, expected_len) };
    u32::from(actual == expected)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_method_equals(
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
) -> u32 {
    if request.is_null() || (expected.is_null() && expected_len != 0) {
        return 0;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let method = unsafe { &(*request).method };
    if method.len != expected_len || (method.ptr.is_null() && method.len != 0) {
        return 0;
    }
    // SAFETY: Both views are valid for their declared lengths during this call.
    let actual = unsafe { slice::from_raw_parts(method.ptr, method.len) };
    let expected = unsafe { slice::from_raw_parts(expected, expected_len) };
    u32::from(actual == expected)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_query_has(
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
) -> u32 {
    if request.is_null() || (expected.is_null() && expected_len != 0) {
        return 0;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let query = unsafe { &(*request).query };
    if query.ptr.is_null() && query.len != 0 {
        return 0;
    }
    // SAFETY: Both views are valid for their declared lengths during this call.
    let query = unsafe { slice::from_raw_parts(query.ptr, query.len) };
    let expected = unsafe { slice::from_raw_parts(expected, expected_len) };
    u32::from(query.split(|byte| *byte == b'&').any(|part| {
        if part.is_empty() {
            return false;
        }
        let name = part
            .iter()
            .position(|byte| *byte == b'=')
            .map_or(part, |index| &part[..index]);
        form_urlencoded_name_equals(name, expected)
    }))
}

fn form_urlencoded_name_equals(encoded: &[u8], expected: &[u8]) -> bool {
    let mut encoded_index = 0;
    let mut expected_index = 0;
    while encoded_index < encoded.len() {
        let decoded = if encoded[encoded_index] == b'+' {
            encoded_index += 1;
            b' '
        } else if let Some(byte) = percent_byte(encoded, encoded_index) {
            encoded_index += 3;
            byte
        } else {
            let byte = encoded[encoded_index];
            encoded_index += 1;
            byte
        };
        if expected.get(expected_index) != Some(&decoded) {
            return false;
        }
        expected_index += 1;
    }
    expected_index == expected.len()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_query_parameter(
    writer: *mut TinyResponseWriter,
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
    fallback: *const u8,
    fallback_len: usize,
    escape_html: u32,
) -> u32 {
    if writer.is_null()
        || request.is_null()
        || (expected.is_null() && expected_len != 0)
        || (fallback.is_null() && fallback_len != 0)
    {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes request and static string views valid for this call.
    let query = unsafe { &(*request).query };
    if query.ptr.is_null() && query.len != 0 {
        return INTERNAL_ERROR;
    }
    // SAFETY: All views remain valid for synchronous request dispatch.
    let query = unsafe { slice::from_raw_parts(query.ptr, query.len) };
    let expected = unsafe { slice::from_raw_parts(expected, expected_len) };
    for part in query.split(|byte| *byte == b'&') {
        if part.is_empty() {
            continue;
        }
        let separator = part.iter().position(|byte| *byte == b'=');
        let name = separator.map_or(part, |index| &part[..index]);
        if form_urlencoded_name_equals(name, expected) {
            let value = separator.map_or(&[][..], |index| &part[index + 1..]);
            // SAFETY: The writer and request query remain valid for this synchronous copy.
            return unsafe { write_form_urlencoded_value(writer, value, escape_html != 0) };
        }
    }
    // SAFETY: The fallback view is generated static data and the writer is valid.
    let fallback = if fallback_len == 0 {
        &[]
    } else {
        // SAFETY: A non-empty fallback was validated as non-null above.
        unsafe { slice::from_raw_parts(fallback, fallback_len) }
    };
    unsafe { write_html_bytes(writer, fallback, escape_html != 0) }
}

unsafe fn write_form_urlencoded_value(
    writer: *mut TinyResponseWriter,
    encoded: &[u8],
    escape_html: bool,
) -> u32 {
    let mut cursor = 0;
    while cursor < encoded.len() {
        let byte = if encoded[cursor] == b'+' {
            cursor += 1;
            b' '
        } else if let Some(byte) = percent_byte(encoded, cursor) {
            cursor += 3;
            byte
        } else {
            let byte = encoded[cursor];
            cursor += 1;
            byte
        };
        // SAFETY: The one-byte local is valid for this synchronous arena copy.
        let status = unsafe { write_html_bytes(writer, slice::from_ref(&byte), escape_html) };
        if status != OK {
            return status;
        }
    }
    OK
}

unsafe fn write_html_bytes(
    writer: *mut TinyResponseWriter,
    bytes: &[u8],
    escape_html: bool,
) -> u32 {
    if !escape_html {
        // SAFETY: The borrowed bytes and writer are valid for this synchronous copy.
        return unsafe { tinytsx_html_write_static(writer, bytes.as_ptr(), bytes.len()) };
    }
    for byte in bytes {
        let escaped = match byte {
            b'&' => b"&amp;".as_slice(),
            b'<' => b"&lt;".as_slice(),
            b'>' => b"&gt;".as_slice(),
            b'\"' => b"&quot;".as_slice(),
            b'\'' => b"&#39;".as_slice(),
            _ => slice::from_ref(byte),
        };
        // SAFETY: The selected bytes and writer are valid for this synchronous copy.
        let status = unsafe { tinytsx_html_write_static(writer, escaped.as_ptr(), escaped.len()) };
        if status != OK {
            return status;
        }
    }
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_path_matches(
    request: *const TinyRequest,
    pattern: *const u8,
    pattern_len: usize,
) -> u32 {
    if request.is_null() || (pattern.is_null() && pattern_len != 0) {
        return 0;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let path = unsafe { &(*request).path };
    if path.ptr.is_null() && path.len != 0 {
        return 0;
    }
    // SAFETY: Both views are valid for their declared lengths during this call.
    let actual = unsafe { slice::from_raw_parts(path.ptr, path.len) };
    let pattern = unsafe { slice::from_raw_parts(pattern, pattern_len) };
    let mut actual_segments = route_segments(actual);
    let mut pattern_segments = route_segments(pattern);
    loop {
        match pattern_segments.next() {
            None => return u32::from(actual_segments.next().is_none()),
            Some(b"*") => return 1,
            Some(pattern) => {
                let Some(actual) = actual_segments.next() else {
                    return 0;
                };
                let parameter = pattern.len() > 1 && pattern[0] == b':';
                if (parameter && !route_parameter_matches(pattern, actual))
                    || (!parameter && actual != pattern)
                {
                    return 0;
                }
            }
        }
    }
}

fn route_parameter_matches(pattern: &[u8], actual: &[u8]) -> bool {
    if actual.is_empty() {
        return false;
    }
    if pattern.strip_suffix(b"{[0-9]+}").is_some() {
        return actual.iter().all(u8::is_ascii_digit);
    }
    true
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_path_segment_min_length(
    request: *const TinyRequest,
    segment: usize,
    minimum: usize,
) -> u32 {
    if request.is_null() {
        return 0;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let path = unsafe { &(*request).path };
    if path.ptr.is_null() && path.len != 0 {
        return 0;
    }
    // SAFETY: The request path remains valid for the duration of dispatch.
    let path = unsafe { slice::from_raw_parts(path.ptr, path.len) };
    let Some(value) = route_segments(path).nth(segment) else {
        return 0;
    };
    let mut length = 0;
    let mut cursor = 0;
    while cursor < value.len() {
        cursor += if percent_byte(value, cursor).is_some() {
            3
        } else {
            1
        };
        length += 1;
    }
    u32::from(length >= minimum)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_path_segment(
    writer: *mut TinyResponseWriter,
    request: *const TinyRequest,
    segment: usize,
) -> u32 {
    if writer.is_null() || request.is_null() {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let path = unsafe { &(*request).path };
    if path.ptr.is_null() && path.len != 0 {
        return BAD_REQUEST;
    }
    // SAFETY: The request path is valid for the duration of request dispatch.
    let path = unsafe { slice::from_raw_parts(path.ptr, path.len) };
    let Some(value) = route_segments(path).nth(segment) else {
        return BAD_REQUEST;
    };
    let mut cursor = 0;
    let mut literal_start = 0;
    while cursor < value.len() {
        if percent_byte(value, cursor).is_some() {
            if literal_start < cursor {
                // SAFETY: The literal is a borrowed part of the request path and the writer is valid.
                let status = unsafe {
                    tinytsx_html_write_static(
                        writer,
                        value[literal_start..cursor].as_ptr(),
                        cursor - literal_start,
                    )
                };
                if status != OK {
                    return status;
                }
            }
            let group_start = cursor;
            while percent_byte(value, cursor).is_some() {
                cursor += 3;
            }
            let status = if valid_percent_utf8(value, group_start, cursor) {
                let mut encoded = group_start;
                let mut status = OK;
                while encoded < cursor && status == OK {
                    let decoded = [percent_byte(value, encoded).expect("validated percent byte")];
                    // SAFETY: The one-byte local is valid for this synchronous copy.
                    status = unsafe { tinytsx_html_write_static(writer, decoded.as_ptr(), 1) };
                    encoded += 3;
                }
                status
            } else {
                // SAFETY: The invalid UTF-8 group remains borrowed request-path text.
                unsafe {
                    tinytsx_html_write_static(
                        writer,
                        value[group_start..cursor].as_ptr(),
                        cursor - group_start,
                    )
                }
            };
            if status != OK {
                return status;
            }
            literal_start = cursor;
            continue;
        }
        cursor += 1;
    }
    if literal_start < value.len() {
        // SAFETY: The literal is a borrowed part of the request path and the writer is valid.
        return unsafe {
            tinytsx_html_write_static(
                writer,
                value[literal_start..].as_ptr(),
                value.len() - literal_start,
            )
        };
    }
    OK
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_request_header(
    writer: *mut TinyResponseWriter,
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
) -> u32 {
    if request.is_null() || (expected.is_null() && expected_len != 0) {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code passes the request supplied by this runtime.
    let request = unsafe { &*request };
    if request.headers.is_null() && request.header_count != 0 {
        return INTERNAL_ERROR;
    }
    // SAFETY: The request owns a borrowed header table for the duration of this call.
    let headers = unsafe { slice::from_raw_parts(request.headers, request.header_count) };
    // SAFETY: Generated static data is valid for its declared length.
    let expected = unsafe { slice::from_raw_parts(expected, expected_len) };
    for header in headers {
        if (header.name.ptr.is_null() && header.name.len != 0)
            || (header.value.ptr.is_null() && header.value.len != 0)
        {
            return INTERNAL_ERROR;
        }
        // SAFETY: Header views borrow the parsed request head.
        let name = unsafe { slice::from_raw_parts(header.name.ptr, header.name.len) };
        if name.eq_ignore_ascii_case(expected) {
            // SAFETY: Header views borrow the parsed request head and the writer is valid.
            return unsafe {
                tinytsx_html_write_static(writer, header.value.ptr, header.value.len)
            };
        }
    }
    // SAFETY: The fallback literal is static for the duration of the copy.
    unsafe { tinytsx_html_write_static(writer, b"undefined".as_ptr(), b"undefined".len()) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_environment_variable(
    writer: *mut TinyResponseWriter,
    name: *const u8,
    name_len: usize,
    fallback: *const u8,
    fallback_len: usize,
    required: u32,
) -> u32 {
    if writer.is_null()
        || name.is_null()
        || name_len == 0
        || (fallback.is_null() && fallback_len != 0)
        || required > 1
    {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated names and fallbacks point at immutable static data.
    let name = unsafe { slice::from_raw_parts(name, name_len) };
    match environment::get(name) {
        Some(SnapshotValue::Present(value)) => unsafe {
            tinytsx_html_write_static(writer, value.as_ptr(), value.len())
        },
        Some(SnapshotValue::Missing) if !fallback.is_null() => unsafe {
            tinytsx_html_write_static(writer, fallback, fallback_len)
        },
        Some(SnapshotValue::Missing) if required == 0 => unsafe {
            tinytsx_html_write_static(writer, b"undefined".as_ptr(), b"undefined".len())
        },
        Some(SnapshotValue::Missing | SnapshotValue::InvalidUtf8 | SnapshotValue::TooLarge) => {
            // SAFETY: the writer was validated above.
            unsafe { (*writer).status = RENDER_ERROR };
            RENDER_ERROR
        }
        None => INTERNAL_ERROR,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_file_text(
    writer: *mut TinyResponseWriter,
    path: *const u8,
    path_len: usize,
    max_bytes: usize,
) -> u32 {
    if writer.is_null() || path.is_null() || path_len == 0 {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated file paths point at immutable static data.
    let path = unsafe { slice::from_raw_parts(path, path_len) };
    match crate::application::read_file(path, max_bytes) {
        Ok(value) => unsafe { tinytsx_html_write_static(writer, value.as_ptr(), value.len()) },
        Err(status) => {
            // SAFETY: the writer was validated above.
            unsafe { (*writer).status = status };
            status
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_fetch_status(
    writer: *mut TinyResponseWriter,
    url: *const u8,
    url_len: usize,
) -> u32 {
    if writer.is_null() || url.is_null() || url_len == 0 || url_len > MAX_FETCH_URL_BYTES {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated static data is valid for its declared length.
    let url = unsafe { slice::from_raw_parts(url, url_len) };
    let Some(status) = fetch_response_status(url) else {
        // SAFETY: The non-null writer is owned by this synchronous request.
        unsafe { (*writer).status = RENDER_ERROR };
        return RENDER_ERROR;
    };
    let mut storage = [0_u8; 20];
    let status = decimal_bytes(u64::from(status), &mut storage);
    // SAFETY: The decimal storage remains alive during the synchronous copy.
    unsafe { tinytsx_html_write_static(writer, status.as_ptr(), status.len()) }
}

#[repr(C)]
struct CurlBodyCapture {
    start: *mut u8,
    len: usize,
    capacity: usize,
    overflow: bool,
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_html_write_openai_chat_text(
    writer: *mut TinyResponseWriter,
    url: *const u8,
    url_len: usize,
    authorization: *const u8,
    authorization_len: usize,
    body: *const u8,
    body_len: usize,
) -> u32 {
    if writer.is_null()
        || url.is_null()
        || authorization.is_null()
        || body.is_null()
        || url_len == 0
        || url_len > MAX_FETCH_URL_BYTES
        || authorization_len == 0
        || authorization_len > MAX_PROVIDER_AUTHORIZATION_BYTES
        || body_len == 0
        || body_len > MAX_PROVIDER_BODY_BYTES
    {
        return INTERNAL_ERROR;
    }
    // SAFETY: Generated code supplies immutable static slices for this call.
    let url = unsafe { slice::from_raw_parts(url, url_len) };
    let authorization = unsafe { slice::from_raw_parts(authorization, authorization_len) };
    let body = unsafe { slice::from_raw_parts(body, body_len) };
    let request = crate::application::OpenAiRequest {
        url: url.to_vec(),
        authorization: authorization.to_vec(),
        body: body.to_vec(),
    };
    match crate::application::call_openai(request) {
        Ok(output) => {
            // SAFETY: the application reply remains alive during this bounded arena copy.
            unsafe { tinytsx_html_write_static(writer, output.as_ptr(), output.len()) }
        }
        Err(status) => {
            // SAFETY: the generated handler supplied this non-null writer.
            unsafe { (*writer).status = status };
            status
        }
    }
}

impl OpenAiTransport {
    pub(crate) fn perform(
        &mut self,
        url: &[u8],
        authorization: &[u8],
        body: &[u8],
    ) -> Result<Vec<u8>, u32> {
        if url.is_empty()
            || url.len() > MAX_FETCH_URL_BYTES
            || authorization.is_empty()
            || authorization.len() > MAX_PROVIDER_AUTHORIZATION_BYTES
            || body.is_empty()
            || body.len() > MAX_PROVIDER_BODY_BYTES
        {
            return Err(INTERNAL_ERROR);
        }
        let mut output = vec![0_u8; MAX_PROVIDER_RESPONSE_BYTES];
        let mut capture = CurlBodyCapture {
            start: output.as_mut_ptr(),
            len: 0,
            capacity: output.len(),
            overflow: false,
        };
        let Some(response_len) = self.post(url, authorization, body, &mut capture) else {
            return Err(if capture.overflow {
                REQUEST_OOM
            } else {
                RENDER_ERROR
            });
        };
        // SAFETY: libcurl wrote exactly `response_len` bytes into the bounded reply allocation.
        let response = unsafe { slice::from_raw_parts(capture.start, response_len) };
        let Some(content) = openai_chat_content(response) else {
            return Err(RENDER_ERROR);
        };
        let content_offset = content.as_ptr() as usize - capture.start as usize;
        let content_len = content.len();
        let Some(decoded_len) =
            decode_json_string_in_place(capture.start, content_offset, content_len)
        else {
            return Err(RENDER_ERROR);
        };
        output.truncate(decoded_len);
        Ok(output)
    }

    fn post(
        &mut self,
        url: &[u8],
        authorization: &[u8],
        body: &[u8],
        capture: &mut CurlBodyCapture,
    ) -> Option<usize> {
        if url.contains(&0)
            || authorization.contains(&0)
            || !*CURL_READY.get_or_init(|| {
                // SAFETY: This process-wide initialization is protected by `OnceLock`.
                unsafe { curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK }
            })
        {
            return None;
        }
        if self.handle.is_null() {
            // SAFETY: global initialization succeeded and this transport owns the result.
            self.handle = unsafe { curl_easy_init() };
            if self.handle.is_null() {
                return None;
            }
        }
        let mut nul_url = [0_u8; MAX_FETCH_URL_BYTES + 1];
        nul_url[..url.len()].copy_from_slice(url);
        let prefix = b"Authorization: ";
        let mut auth_header = [0_u8; MAX_PROVIDER_AUTHORIZATION_BYTES + 16];
        auth_header[..prefix.len()].copy_from_slice(prefix);
        auth_header[prefix.len()..prefix.len() + authorization.len()]
            .copy_from_slice(authorization);
        // SAFETY: all pointers supplied to libcurl remain alive through the synchronous request.
        unsafe {
            let content_type =
                curl_slist_append(ptr::null_mut(), c"Content-Type: application/json".as_ptr());
            if content_type.is_null() {
                return None;
            }
            let headers = curl_slist_append(content_type, auth_header.as_ptr().cast());
            if headers.is_null() {
                curl_slist_free_all(content_type);
                return None;
            }
            let configured = curl_easy_setopt(self.handle, CURLOPT_URL, nul_url.as_ptr())
                == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_POST, 1 as c_long) == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_POSTFIELDS, body.as_ptr()) == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_POSTFIELDSIZE, body.len() as c_long)
                    == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_HTTPHEADER, headers) == CURLE_OK
                && curl_easy_setopt(
                    self.handle,
                    CURLOPT_WRITEFUNCTION,
                    capture_provider_body as CurlWriteCallback,
                ) == CURLE_OK
                && curl_easy_setopt(
                    self.handle,
                    CURLOPT_WRITEDATA,
                    (capture as *mut CurlBodyCapture).cast::<c_void>(),
                ) == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_FOLLOWLOCATION, 0 as c_long) == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_NOSIGNAL, 1 as c_long) == CURLE_OK
                && curl_easy_setopt(self.handle, CURLOPT_TIMEOUT_MS, 10_000 as c_long) == CURLE_OK;
            let mut response_code = 0 as c_long;
            let completed = configured
                && curl_easy_perform(self.handle) == CURLE_OK
                && curl_easy_getinfo(self.handle, CURLINFO_RESPONSE_CODE, &mut response_code)
                    == CURLE_OK;
            curl_slist_free_all(headers);
            (completed && (200..=299).contains(&response_code) && !capture.overflow)
                .then_some(capture.len)
        }
    }
}

unsafe extern "C" fn capture_provider_body(
    bytes: *mut c_char,
    size: usize,
    items: usize,
    data: *mut c_void,
) -> usize {
    let Some(total) = size.checked_mul(items) else {
        return 0;
    };
    if data.is_null() || (bytes.is_null() && total != 0) {
        return 0;
    }
    // SAFETY: libcurl passes back the capture pointer supplied for this request.
    let capture = unsafe { &mut *data.cast::<CurlBodyCapture>() };
    if total > capture.capacity.saturating_sub(capture.len) {
        capture.overflow = true;
        return 0;
    }
    if total != 0 {
        // SAFETY: the capacity check proves this write stays in the request arena.
        unsafe {
            ptr::copy_nonoverlapping(bytes.cast::<u8>(), capture.start.add(capture.len), total)
        };
        capture.len += total;
    }
    total
}

fn openai_chat_content(response: &[u8]) -> Option<&[u8]> {
    let choices = find_bytes(response, b"\"choices\"")?;
    let message = choices + find_bytes(&response[choices..], b"\"message\"")?;
    json_string_field(&response[message..], b"content")
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|candidate| candidate == needle)
}

fn json_string_field<'a>(object: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut pattern = Vec::with_capacity(key.len() + 2);
    pattern.push(b'"');
    pattern.extend_from_slice(key);
    pattern.push(b'"');
    let key = find_bytes(object, &pattern)? + pattern.len();
    let mut cursor = key;
    while object.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    if object.get(cursor) != Some(&b':') {
        return None;
    }
    cursor += 1;
    while object.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    if object.get(cursor) != Some(&b'"') {
        return None;
    }
    cursor += 1;
    let start = cursor;
    let mut escaped = false;
    while let Some(&byte) = object.get(cursor) {
        if !escaped && byte == b'"' {
            return Some(&object[start..cursor]);
        }
        escaped = !escaped && byte == b'\\';
        cursor += 1;
    }
    None
}

fn decode_json_string_in_place(
    destination: *mut u8,
    encoded_offset: usize,
    encoded_len: usize,
) -> Option<usize> {
    let mut source = 0;
    let mut output = 0;
    while source < encoded_len {
        // SAFETY: the caller provides an offset and length inside the captured arena body.
        let byte = unsafe { destination.add(encoded_offset + source).read() };
        if byte != b'\\' {
            if byte < 0x20 {
                return None;
            }
            // SAFETY: output never advances faster than source, so the arena write is in bounds.
            unsafe { destination.add(output).write(byte) };
            output += 1;
            source += 1;
            continue;
        }
        source += 1;
        if source >= encoded_len {
            return None;
        }
        // SAFETY: the bound above keeps this read inside the encoded JSON string.
        let escaped = unsafe { destination.add(encoded_offset + source).read() };
        source += 1;
        let decoded = match escaped {
            b'"' | b'\\' | b'/' => escaped,
            b'b' => 0x08,
            b'f' => 0x0c,
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            b'u' => {
                if source + 4 > encoded_len {
                    return None;
                }
                // SAFETY: four bytes remain in the captured JSON string.
                let digits =
                    unsafe { slice::from_raw_parts(destination.add(encoded_offset + source), 4) };
                let code = parse_hex_quad(digits)?;
                source += 4;
                let scalar = if (0xd800..=0xdbff).contains(&code) {
                    if source + 6 > encoded_len
                        || unsafe { destination.add(encoded_offset + source).read() } != b'\\'
                        || unsafe { destination.add(encoded_offset + source + 1).read() } != b'u'
                    {
                        return None;
                    }
                    // SAFETY: the bound above leaves four low-surrogate digits.
                    let low_digits = unsafe {
                        slice::from_raw_parts(destination.add(encoded_offset + source + 2), 4)
                    };
                    let low = parse_hex_quad(low_digits)?;
                    if !(0xdc00..=0xdfff).contains(&low) {
                        return None;
                    }
                    source += 6;
                    0x1_0000 + ((u32::from(code) - 0xd800) << 10) + (u32::from(low) - 0xdc00)
                } else if (0xdc00..=0xdfff).contains(&code) {
                    return None;
                } else {
                    u32::from(code)
                };
                let character = char::from_u32(scalar)?;
                let mut utf8 = [0_u8; 4];
                let bytes = character.encode_utf8(&mut utf8).as_bytes();
                // SAFETY: a Unicode escape consumes six bytes and emits at most four.
                unsafe {
                    ptr::copy_nonoverlapping(bytes.as_ptr(), destination.add(output), bytes.len())
                };
                output += bytes.len();
                continue;
            }
            _ => return None,
        };
        // SAFETY: a two-byte escape emits one byte within the captured range.
        unsafe { destination.add(output).write(decoded) };
        output += 1;
    }
    // SAFETY: decoded bytes occupy the beginning of the same bounded allocation.
    std::str::from_utf8(unsafe { slice::from_raw_parts(destination, output) }).ok()?;
    Some(output)
}

fn parse_hex_quad(bytes: &[u8]) -> Option<u16> {
    bytes.iter().try_fold(0_u16, |value, byte| {
        let digit = match byte {
            b'0'..=b'9' => u16::from(byte - b'0'),
            b'a'..=b'f' => u16::from(byte - b'a' + 10),
            b'A'..=b'F' => u16::from(byte - b'A' + 10),
            _ => return None,
        };
        value.checked_mul(16)?.checked_add(digit)
    })
}

fn fetch_response_status(url: &[u8]) -> Option<u16> {
    if url.contains(&0)
        || !*CURL_READY.get_or_init(|| {
            // SAFETY: This process-wide initialization is protected by `OnceLock`.
            unsafe { curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK }
        })
    {
        return None;
    }
    let mut nul_terminated = [0_u8; MAX_FETCH_URL_BYTES + 1];
    nul_terminated[..url.len()].copy_from_slice(url);
    // SAFETY: libcurl owns no pointers after cleanup; all supplied storage lives through this call.
    unsafe {
        let handle = curl_easy_init();
        if handle.is_null() {
            return None;
        }
        let configured = curl_easy_setopt(handle, CURLOPT_URL, nul_terminated.as_ptr()) == CURLE_OK
            && curl_easy_setopt(
                handle,
                CURLOPT_WRITEFUNCTION,
                discard_fetch_body as CurlWriteCallback,
            ) == CURLE_OK
            && curl_easy_setopt(handle, CURLOPT_FOLLOWLOCATION, 1 as c_long) == CURLE_OK
            && curl_easy_setopt(handle, CURLOPT_NOSIGNAL, 1 as c_long) == CURLE_OK
            && curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, 10_000 as c_long) == CURLE_OK;
        let mut response_code = 0 as c_long;
        let completed = configured
            && curl_easy_perform(handle) == CURLE_OK
            && curl_easy_getinfo(handle, CURLINFO_RESPONSE_CODE, &mut response_code) == CURLE_OK;
        curl_easy_cleanup(handle);
        completed
            .then_some(response_code)
            .and_then(|code| u16::try_from(code).ok())
    }
}

unsafe extern "C" fn discard_fetch_body(
    _bytes: *mut c_char,
    size: usize,
    items: usize,
    _data: *mut c_void,
) -> usize {
    size.checked_mul(items).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_basic_auth_equals(
    request: *const TinyRequest,
    username: *const u8,
    username_len: usize,
    password: *const u8,
    password_len: usize,
) -> u32 {
    if request.is_null()
        || (username.is_null() && username_len != 0)
        || (password.is_null() && password_len != 0)
    {
        return 0;
    }
    // SAFETY: Generated code passes the request supplied by this runtime and
    // immutable credential bytes for the duration of this call.
    let request = unsafe { &*request };
    let username = unsafe { slice::from_raw_parts(username, username_len) };
    let password = unsafe { slice::from_raw_parts(password, password_len) };
    if username.contains(&b':') {
        return 0;
    }
    // SAFETY: Header views borrow the parsed request head for dispatch.
    let Some(value) = (unsafe { request_header_value(request, b"Authorization") }) else {
        return 0;
    };
    let Some(encoded) = basic_authorization_payload(value) else {
        return 0;
    };
    u32::from(base64_matches_credentials(encoded, username, password))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_request_if_none_match(
    request: *const TinyRequest,
    entity_tag: *const u8,
    entity_tag_len: usize,
) -> u32 {
    if request.is_null() || entity_tag.is_null() || entity_tag_len == 0 {
        return 0;
    }
    // SAFETY: Generated code passes request-lifetime and static byte ranges.
    let request = unsafe { &*request };
    let entity_tag = unsafe { slice::from_raw_parts(entity_tag, entity_tag_len) };
    // SAFETY: Header views borrow the request head for dispatch.
    let Some(value) = (unsafe { request_header_value(request, b"If-None-Match") }) else {
        return 0;
    };
    let expected = strip_weak_entity_tag(entity_tag);
    u32::from(value.split(|byte| *byte == b',').any(|candidate| {
        let candidate = trim_ascii_whitespace(candidate);
        candidate == b"*" || strip_weak_entity_tag(candidate) == expected
    }))
}

fn strip_weak_entity_tag(value: &[u8]) -> &[u8] {
    value.strip_prefix(b"W/").unwrap_or(value)
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

unsafe fn request_header_value<'a>(request: &'a TinyRequest, expected: &[u8]) -> Option<&'a [u8]> {
    if request.headers.is_null() && request.header_count != 0 {
        return None;
    }
    // SAFETY: The request owns this borrowed table for the duration of dispatch.
    let headers = unsafe { slice::from_raw_parts(request.headers, request.header_count) };
    for header in headers {
        if (header.name.ptr.is_null() && header.name.len != 0)
            || (header.value.ptr.is_null() && header.value.len != 0)
        {
            return None;
        }
        // SAFETY: Each view belongs to the request head backing storage.
        let name = unsafe { slice::from_raw_parts(header.name.ptr, header.name.len) };
        if name.eq_ignore_ascii_case(expected) {
            // SAFETY: The value view has the same request lifetime as its name.
            return Some(unsafe { slice::from_raw_parts(header.value.ptr, header.value.len) });
        }
    }
    None
}

fn basic_authorization_payload(value: &[u8]) -> Option<&[u8]> {
    let value = trim_ascii_spaces(value);
    if value.len() < 6 || !value[..5].eq_ignore_ascii_case(b"Basic") || value[5] != b' ' {
        return None;
    }
    let payload = trim_ascii_spaces(&value[5..]);
    if payload.is_empty()
        || payload
            .iter()
            .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'+' | b'/' | b'='))
    {
        return None;
    }
    Some(payload)
}

fn trim_ascii_spaces(mut value: &[u8]) -> &[u8] {
    while value.first() == Some(&b' ') {
        value = &value[1..];
    }
    while value.last() == Some(&b' ') {
        value = &value[..value.len() - 1];
    }
    value
}

fn base64_matches_credentials(encoded: &[u8], username: &[u8], password: &[u8]) -> bool {
    let padding = encoded
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    if padding > 2 {
        return false;
    }
    let core_len = encoded.len() - padding;
    if encoded[..core_len].contains(&b'=')
        || core_len % 4 == 1
        || (padding != 0
            && (!encoded.len().is_multiple_of(4)
                || (padding == 1 && core_len % 4 != 3)
                || (padding == 2 && core_len % 4 != 2)))
    {
        return false;
    }
    let expected_len = username.len() + 1 + password.len();
    let mut accumulator = 0_u32;
    let mut bit_count = 0_u8;
    let mut decoded_len = 0_usize;
    let mut difference = 0_u8;
    for byte in &encoded[..core_len] {
        let Some(value) = base64_value(*byte) else {
            return false;
        };
        accumulator = (accumulator << 6) | u32::from(value);
        bit_count += 6;
        if bit_count >= 8 {
            bit_count -= 8;
            let decoded = ((accumulator >> bit_count) & 0xff) as u8;
            let expected = if decoded_len < username.len() {
                username[decoded_len]
            } else if decoded_len == username.len() {
                b':'
            } else {
                password
                    .get(decoded_len - username.len() - 1)
                    .copied()
                    .unwrap_or(0)
            };
            difference |= decoded ^ expected;
            decoded_len += 1;
        }
    }
    decoded_len == expected_len && difference == 0
}

fn base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn route_segments(path: &[u8]) -> impl Iterator<Item = &[u8]> {
    path.split(|byte| *byte == b'/')
        .skip(usize::from(path.first() == Some(&b'/')))
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn percent_byte(value: &[u8], index: usize) -> Option<u8> {
    if value.get(index) != Some(&b'%') {
        return None;
    }
    Some((hex(*value.get(index + 1)?)? << 4) | hex(*value.get(index + 2)?)?)
}

fn valid_percent_utf8(value: &[u8], start: usize, end: usize) -> bool {
    let mut cursor = start;
    let mut remaining = 0_u8;
    let mut next_min = 0x80_u8;
    let mut next_max = 0xbf_u8;
    while cursor < end {
        let Some(byte) = percent_byte(value, cursor) else {
            return false;
        };
        cursor += 3;
        if remaining != 0 {
            if !(next_min..=next_max).contains(&byte) {
                return false;
            }
            remaining -= 1;
            next_min = 0x80;
            next_max = 0xbf;
            continue;
        }
        match byte {
            0x00..=0x7f => {}
            0xc2..=0xdf => remaining = 1,
            0xe0 => {
                remaining = 2;
                next_min = 0xa0;
            }
            0xe1..=0xec | 0xee..=0xef => remaining = 2,
            0xed => {
                remaining = 2;
                next_max = 0x9f;
            }
            0xf0 => {
                remaining = 3;
                next_min = 0x90;
            }
            0xf1..=0xf3 => remaining = 3,
            0xf4 => {
                remaining = 3;
                next_max = 0x8f;
            }
            _ => return false,
        }
    }
    remaining == 0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_header_static(
    writer: *mut TinyResponseWriter,
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
) -> u32 {
    if writer.is_null() || name.is_null() || (value.is_null() && value_len != 0) || name_len == 0 {
        return BAD_REQUEST;
    }
    // SAFETY: Generated code passes static byte ranges valid for the duration of the process.
    let name_bytes = unsafe { slice::from_raw_parts(name, name_len) };
    let value_bytes = unsafe { slice::from_raw_parts(value, value_len) };
    if !valid_header_name(name_bytes) || !valid_header_value(value_bytes) {
        return BAD_REQUEST;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    set_response_header(
        writer,
        TinyStringView {
            ptr: name,
            len: name_len,
        },
        TinyStringView {
            ptr: value,
            len: value_len,
        },
        name_bytes,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn tinytsx_date_now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn tinytsx_response_header_elapsed_millis(
    writer: *mut TinyResponseWriter,
    name: *const u8,
    name_len: usize,
    started_at: u64,
    ended_at: u64,
    suffix: *const u8,
    suffix_len: usize,
) -> u32 {
    if writer.is_null() || name.is_null() || name_len == 0 || (suffix.is_null() && suffix_len != 0)
    {
        return BAD_REQUEST;
    }
    // SAFETY: Generated code passes immutable static ranges for this call.
    let name_bytes = unsafe { slice::from_raw_parts(name, name_len) };
    let suffix_bytes = unsafe { slice::from_raw_parts(suffix, suffix_len) };
    if !valid_header_name(name_bytes) || !valid_header_value(suffix_bytes) {
        return BAD_REQUEST;
    }
    // SAFETY: Generated code passes the writer supplied by this runtime.
    let writer = unsafe { &mut *writer };
    let mut digits = [0_u8; 20];
    let digits = decimal_bytes(ended_at.saturating_sub(started_at), &mut digits);
    let value_len = digits.len() + suffix_bytes.len();
    if value_len > MAX_DYNAMIC_HEADER_BYTES - writer.dynamic_header_cursor {
        writer.status = REQUEST_OOM;
        return REQUEST_OOM;
    }
    let start = writer.dynamic_header_cursor;
    let end = start + value_len;
    writer.dynamic_header_bytes[start..start + digits.len()].copy_from_slice(digits);
    writer.dynamic_header_bytes[start + digits.len()..end].copy_from_slice(suffix_bytes);
    writer.dynamic_header_cursor = end;
    let value = TinyStringView {
        // SAFETY: `start` is within the fixed writer-owned storage checked above.
        ptr: unsafe { writer.dynamic_header_bytes.as_ptr().add(start) },
        len: value_len,
    };
    set_response_header(
        writer,
        TinyStringView {
            ptr: name,
            len: name_len,
        },
        value,
        name_bytes,
    )
}

fn decimal_bytes(mut value: u64, storage: &mut [u8; 20]) -> &[u8] {
    let mut cursor = storage.len();
    loop {
        cursor -= 1;
        storage[cursor] = b'0' + (value % 10) as u8;
        value /= 10;
        if value == 0 {
            return &storage[cursor..];
        }
    }
}

fn set_response_header(
    writer: &mut TinyResponseWriter,
    name: TinyStringView,
    value: TinyStringView,
    name_bytes: &[u8],
) -> u32 {
    for header in &mut writer.headers[..writer.header_count] {
        // SAFETY: Existing header views were accepted from generated static data.
        let existing = unsafe { slice::from_raw_parts(header.name.ptr, header.name.len) };
        if existing.eq_ignore_ascii_case(name_bytes) {
            header.value = value;
            return OK;
        }
    }
    if writer.header_count == MAX_RESPONSE_HEADERS {
        writer.status = REQUEST_OOM;
        return REQUEST_OOM;
    }
    writer.headers[writer.header_count] = TinyHeader { name, value };
    writer.header_count += 1;
    OK
}

fn valid_header_name(name: &[u8]) -> bool {
    name.iter().all(|byte| {
        byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
            )
    })
}

fn valid_header_value(value: &[u8]) -> bool {
    !value
        .iter()
        .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
}

pub struct RequestArena {
    output: Vec<u8>,
}

impl RequestArena {
    pub fn new(capacity: usize) -> Self {
        Self {
            output: vec![0_u8; capacity],
        }
    }
}

pub struct RenderedResponse<'a> {
    pub application_status: u32,
    pub http_status: u16,
    pub content_type: u16,
    pub body: &'a [u8],
    pub headers: Vec<(Vec<u8>, Vec<u8>)>,
    streaming: bool,
    stream_chunk_count: usize,
    stream_chunks: [TinyStringView; MAX_STREAM_CHUNKS],
}

impl RenderedResponse<'_> {
    pub fn is_streaming(&self) -> bool {
        self.streaming
    }

    pub fn stream_chunks(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        self.stream_chunks[..self.stream_chunk_count]
            .iter()
            .map(|chunk| {
                if chunk.len == 0 {
                    &[][..]
                } else {
                    // SAFETY: Chunks point at generated static data or the borrowed request arena.
                    unsafe { slice::from_raw_parts(chunk.ptr, chunk.len) }
                }
            })
    }
}

pub fn render<'a>(request: &TinyRequest, arena: &'a mut RequestArena) -> RenderedResponse<'a> {
    let start = arena.output.as_mut_ptr();
    let capacity = arena.output.len();
    // SAFETY: `start` points at a `capacity`-byte allocation.
    let end = unsafe { start.add(capacity) };
    let mut writer = TinyResponseWriter {
        start,
        cursor: start,
        end,
        status: OK,
        http_status: 200,
        content_type: CONTENT_TYPE_HTML,
        header_count: 0,
        headers: [EMPTY_HEADER; MAX_RESPONSE_HEADERS],
        dynamic_header_cursor: 0,
        dynamic_header_bytes: [0; MAX_DYNAMIC_HEADER_BYTES],
        streaming: 0,
        stream_chunk_count: 0,
        stream_chunks: [EMPTY_VIEW; MAX_STREAM_CHUNKS],
        stream_chunk_start: ptr::null_mut(),
    };

    // SAFETY: The generated handler follows ABI.md and only uses these values
    // for the duration of the call.
    let status = unsafe { tinytsx_handle_get(request, &mut writer) };
    let written = writer.cursor as usize - writer.start as usize;
    let headers = writer.headers[..writer.header_count]
        .iter()
        .map(|header| {
            // SAFETY: Generated response headers point at immutable static data.
            let name = unsafe { slice::from_raw_parts(header.name.ptr, header.name.len) }.to_vec();
            // SAFETY: Generated response headers point at immutable static data.
            let value =
                unsafe { slice::from_raw_parts(header.value.ptr, header.value.len) }.to_vec();
            (name, value)
        })
        .collect();
    RenderedResponse {
        application_status: status,
        http_status: writer.http_status,
        content_type: writer.content_type,
        body: &arena.output[..written],
        headers,
        streaming: writer.streaming != 0,
        stream_chunk_count: writer.stream_chunk_count,
        stream_chunks: writer.stream_chunks,
    }
}

pub fn configured_port() -> u16 {
    // SAFETY: The generated object always provides the configuration functions.
    unsafe { tinytsx_config_port() }
}

pub fn configured_workers() -> usize {
    // SAFETY: The generated object always provides the configuration functions.
    unsafe { tinytsx_config_workers() }
}

pub fn configured_worker_modules() -> usize {
    // SAFETY: The generated object always provides the configuration functions.
    unsafe { tinytsx_config_worker_modules() }
}

pub fn configured_provider_transport() -> bool {
    // SAFETY: The generated object always provides the configuration function.
    unsafe { tinytsx_config_provider_transport() != 0 }
}

pub fn configured_environment_variables() -> usize {
    // SAFETY: The generated object always provides the configuration function.
    unsafe { tinytsx_config_environment_variables() }
}

pub fn configured_environment_variable(index: usize) -> Result<Vec<u8>, u32> {
    let mut pointer = ptr::null();
    let mut length = 0;
    // SAFETY: The generated object writes one immutable static string view.
    let status = unsafe { tinytsx_config_environment_variable(index, &mut pointer, &mut length) };
    if status != OK {
        return Err(status);
    }
    if pointer.is_null() || length == 0 || length > 128 {
        return Err(INTERNAL_ERROR);
    }
    // SAFETY: Successful generated configuration points at `length` static bytes.
    Ok(unsafe { slice::from_raw_parts(pointer, length) }.to_vec())
}

pub fn configured_read_roots() -> usize {
    // SAFETY: The generated object always provides the configuration function.
    unsafe { tinytsx_config_read_roots() }
}

pub fn configured_read_root(index: usize) -> Result<Vec<u8>, u32> {
    let mut pointer = ptr::null();
    let mut length = 0;
    // SAFETY: The generated object writes one immutable static string view.
    let status = unsafe { tinytsx_config_read_root(index, &mut pointer, &mut length) };
    if status != OK {
        return Err(status);
    }
    if pointer.is_null() || length == 0 || length > 4096 {
        return Err(INTERNAL_ERROR);
    }
    // SAFETY: Successful generated configuration points at `length` static bytes.
    Ok(unsafe { slice::from_raw_parts(pointer, length) }.to_vec())
}

pub fn worker_operation(worker: usize) -> u32 {
    // SAFETY: The generated object validates the worker id and returns zero when absent.
    unsafe { tinytsx_worker_operation(worker) }
}

pub fn configured_request_memory() -> usize {
    // SAFETY: The generated object always provides the configuration functions.
    unsafe { tinytsx_config_request_memory() }
}

pub fn query_parts(target: &[u8]) -> (&[u8], &[u8]) {
    match target.iter().position(|byte| *byte == b'?') {
        Some(index) => (&target[..index], &target[index + 1..]),
        None => (target, &[]),
    }
}

#[cfg(test)]
pub fn request(method: &[u8], target: &[u8]) -> TinyRequest {
    request_with_headers(method, target, &[])
}

pub fn request_with_headers(method: &[u8], target: &[u8], headers: &[TinyHeader]) -> TinyRequest {
    let (path, query) = query_parts(target);
    TinyRequest {
        method: TinyStringView::from_bytes(method),
        path: TinyStringView::from_bytes(path),
        query: TinyStringView::from_bytes(query),
        headers: headers.as_ptr(),
        header_count: headers.len(),
        arena: ptr::null_mut(),
    }
}

#[allow(dead_code)]
fn _assert_views_are_readable(view: &TinyStringView) -> &[u8] {
    if view.ptr.is_null() {
        &[]
    } else {
        // SAFETY: This helper is only an ABI layout assertion used with valid views.
        unsafe { slice::from_raw_parts(view.ptr, view.len) }
    }
}

#[cfg(test)]
mod tests;
