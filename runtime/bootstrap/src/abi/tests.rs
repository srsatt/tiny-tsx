use super::{
    INTERNAL_ERROR, OK, REQUEST_OOM, TinyHtmlWriter, TinyStringView, request,
    tinytsx_html_write_static,
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

fn writer(output: &mut [u8]) -> TinyHtmlWriter {
    let start = output.as_mut_ptr();
    TinyHtmlWriter {
        start,
        cursor: start,
        // SAFETY: `start` points at the beginning of `output`.
        end: unsafe { start.add(output.len()) },
        status: OK,
    }
}

fn view(value: &TinyStringView) -> &[u8] {
    if value.ptr.is_null() {
        return &[];
    }
    // SAFETY: Tests only read views while their request input remains alive.
    unsafe { std::slice::from_raw_parts(value.ptr, value.len) }
}
