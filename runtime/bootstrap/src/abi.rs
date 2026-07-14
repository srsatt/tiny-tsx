use std::{ptr, slice};

pub const OK: u32 = 0;
pub const REQUEST_OOM: u32 = 1;
pub const BAD_REQUEST: u32 = 2;
pub const RENDER_ERROR: u32 = 3;
pub const INTERNAL_ERROR: u32 = 4;
pub const NOT_FOUND: u32 = 5;

pub const CONTENT_TYPE_HTML: u16 = 1;
pub const CONTENT_TYPE_TEXT: u16 = 2;
pub const CONTENT_TYPE_JSON: u16 = 3;
pub const CONTENT_TYPE_RESPONSE_TEXT: u16 = 4;
pub const MAX_RESPONSE_HEADERS: usize = 8;

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
}

#[cfg(feature = "generated")]
unsafe extern "C" {
    pub fn tinytsx_handle_get(request: *const TinyRequest, writer: *mut TinyResponseWriter) -> u32;
    pub fn tinytsx_config_port() -> u16;
    pub fn tinytsx_config_request_memory() -> usize;
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
unsafe extern "C" fn tinytsx_config_request_memory() -> usize {
    262_144
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
            CONTENT_TYPE_HTML | CONTENT_TYPE_TEXT | CONTENT_TYPE_JSON | CONTENT_TYPE_RESPONSE_TEXT
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
    for header in &mut writer.headers[..writer.header_count] {
        // SAFETY: Existing header views were accepted from generated static data.
        let existing = unsafe { slice::from_raw_parts(header.name.ptr, header.name.len) };
        if existing.eq_ignore_ascii_case(name_bytes) {
            header.value = TinyStringView {
                ptr: value,
                len: value_len,
            };
            return OK;
        }
    }
    if writer.header_count == MAX_RESPONSE_HEADERS {
        writer.status = REQUEST_OOM;
        return REQUEST_OOM;
    }
    writer.headers[writer.header_count] = TinyHeader {
        name: TinyStringView {
            ptr: name,
            len: name_len,
        },
        value: TinyStringView {
            ptr: value,
            len: value_len,
        },
    };
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

pub struct RenderedResponse {
    pub application_status: u32,
    pub http_status: u16,
    pub content_type: u16,
    pub body: Vec<u8>,
    pub headers: Vec<(Vec<u8>, Vec<u8>)>,
}

pub fn render(request: &TinyRequest, capacity: usize) -> RenderedResponse {
    let mut output = vec![0_u8; capacity];
    let start = output.as_mut_ptr();
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
    };

    // SAFETY: The generated handler follows ABI.md and only uses these values
    // for the duration of the call.
    let status = unsafe { tinytsx_handle_get(request, &mut writer) };
    let written = writer.cursor as usize - writer.start as usize;
    output.truncate(written);
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
        body: output,
        headers,
    }
}

pub fn configured_port() -> u16 {
    // SAFETY: The generated object always provides the configuration functions.
    unsafe { tinytsx_config_port() }
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

pub fn request(method: &[u8], target: &[u8]) -> TinyRequest {
    let (path, query) = query_parts(target);
    TinyRequest {
        method: TinyStringView::from_bytes(method),
        path: TinyStringView::from_bytes(path),
        query: TinyStringView::from_bytes(query),
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
