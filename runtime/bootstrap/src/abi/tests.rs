use super::{
    CONTENT_TYPE_HTML, CONTENT_TYPE_TEXT, INTERNAL_ERROR, OK, REQUEST_OOM, TinyResponseWriter,
    TinyStringView, request, tinytsx_html_write_static, tinytsx_request_path_equals,
    tinytsx_response_begin,
};

#[test]
fn request_exposes_method_path_and_query_as_borrowed_views() {
    let request = request(b"GET", b"/users/42?expand=profile&lang=en");

    assert_eq!(view(&request.method), b"GET");
    assert_eq!(view(&request.path), b"/users/42");
    assert_eq!(view(&request.query), b"expand=profile&lang=en");
}

#[test]
fn request_without_query_exposes_an_empty_query_view() {
    let request = request(b"POST", b"/users");

    assert_eq!(view(&request.method), b"POST");
    assert_eq!(view(&request.path), b"/users");
    assert_eq!(view(&request.query), b"");
}

#[test]
fn request_path_matching_uses_the_path_without_the_query() {
    let request = request(b"GET", b"/users?expand=true");

    assert_eq!(unsafe {
        tinytsx_request_path_equals(&request, b"/users".as_ptr(), b"/users".len())
    }, 1);
    assert_eq!(unsafe {
        tinytsx_request_path_equals(&request, b"/other".as_ptr(), b"/other".len())
    }, 0);
}

#[test]
fn response_writer_accepts_an_exact_fit() {
    let mut output = [0_u8; 4];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_html_write_static(&mut writer, b"Hono".as_ptr(), 4) };

    assert_eq!(status, OK);
    assert_eq!(writer.status, OK);
    assert_eq!(writer.cursor, writer.end);
    assert_eq!(&output, b"Hono");
}

#[test]
fn response_writer_reports_oom_without_overwriting_the_buffer() {
    let mut output = [0xAA_u8; 3];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_html_write_static(&mut writer, b"Hono".as_ptr(), 4) };

    assert_eq!(status, REQUEST_OOM);
    assert_eq!(writer.status, REQUEST_OOM);
    assert_eq!(writer.cursor, writer.start);
    assert_eq!(output, [0xAA; 3]);
}

#[test]
fn response_writer_rejects_a_null_source_with_nonzero_length() {
    let mut output = [0_u8; 1];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_html_write_static(&mut writer, std::ptr::null(), 1) };

    assert_eq!(status, INTERNAL_ERROR);
}

#[test]
fn response_begin_sets_valid_http_metadata() {
    let mut output = [];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_response_begin(&mut writer, 201, CONTENT_TYPE_TEXT) };

    assert_eq!(status, OK);
    assert_eq!(writer.http_status, 201);
    assert_eq!(writer.content_type, CONTENT_TYPE_TEXT);
}

#[test]
fn response_begin_rejects_invalid_content_types() {
    let mut output = [];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_response_begin(&mut writer, 200, 99) };

    assert_eq!(status, INTERNAL_ERROR);
    assert_eq!(writer.status, INTERNAL_ERROR);
}

fn writer(output: &mut [u8]) -> TinyResponseWriter {
    let start = output.as_mut_ptr();
    TinyResponseWriter {
        start,
        cursor: start,
        // SAFETY: `start` points at the beginning of `output`.
        end: unsafe { start.add(output.len()) },
        status: OK,
        http_status: 200,
        content_type: CONTENT_TYPE_HTML,
    }
}

fn view(value: &TinyStringView) -> &[u8] {
    if value.ptr.is_null() {
        return &[];
    }
    // SAFETY: Tests only read views while their request input remains alive.
    unsafe { std::slice::from_raw_parts(value.ptr, value.len) }
}
