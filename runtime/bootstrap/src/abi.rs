use std::{ptr, slice};

pub const OK: u32 = 0;
pub const REQUEST_OOM: u32 = 1;
pub const BAD_REQUEST: u32 = 2;
pub const RENDER_ERROR: u32 = 3;
pub const INTERNAL_ERROR: u32 = 4;
pub const NOT_FOUND: u32 = 5;

#[repr(C)]
pub struct TinyStringView {
    pub ptr: *const u8,
    pub len: usize,
}

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
pub struct TinyHtmlWriter {
    pub start: *mut u8,
    pub cursor: *mut u8,
    pub end: *mut u8,
    pub status: u32,
}

#[cfg(feature = "generated")]
unsafe extern "C" {
    pub fn tinytsx_handle_get(request: *const TinyRequest, writer: *mut TinyHtmlWriter) -> u32;
    pub fn tinytsx_config_port() -> u16;
    pub fn tinytsx_config_request_memory() -> usize;
}

#[cfg(not(feature = "generated"))]
unsafe extern "C" fn tinytsx_handle_get(
    _request: *const TinyRequest,
    _writer: *mut TinyHtmlWriter,
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
    writer: *mut TinyHtmlWriter,
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

pub fn render(request: &TinyRequest, capacity: usize) -> (u32, Vec<u8>) {
    let mut output = vec![0_u8; capacity];
    let start = output.as_mut_ptr();
    // SAFETY: `start` points at a `capacity`-byte allocation.
    let end = unsafe { start.add(capacity) };
    let mut writer = TinyHtmlWriter {
        start,
        cursor: start,
        end,
        status: OK,
    };

    // SAFETY: The generated handler follows ABI.md and only uses these values
    // for the duration of the call.
    let status = unsafe { tinytsx_handle_get(request, &mut writer) };
    let written = writer.cursor as usize - writer.start as usize;
    output.truncate(written);
    (status, output)
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
