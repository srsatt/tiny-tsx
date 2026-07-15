use super::{
    BAD_REQUEST, CONTENT_TYPE_HTML, CONTENT_TYPE_NONE, CONTENT_TYPE_TEXT, INTERNAL_ERROR,
    MAX_DYNAMIC_HEADER_BYTES, MAX_RESPONSE_HEADERS, OK, REQUEST_OOM, TinyHeader,
    TinyResponseWriter, TinyStringView, request, request_with_headers,
    tinytsx_html_write_path_segment, tinytsx_html_write_request_header, tinytsx_html_write_static,
    tinytsx_request_basic_auth_equals, tinytsx_request_method_equals, tinytsx_request_path_equals,
    tinytsx_request_path_matches, tinytsx_request_query_has, tinytsx_response_begin,
    tinytsx_response_header_elapsed_millis, tinytsx_response_header_static, write_console_error,
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

    assert_eq!(
        unsafe { tinytsx_request_path_equals(&request, b"/users".as_ptr(), b"/users".len()) },
        1
    );
    assert_eq!(
        unsafe { tinytsx_request_path_equals(&request, b"/other".as_ptr(), b"/other".len()) },
        0
    );
}

#[test]
fn request_method_matching_distinguishes_get_and_post() {
    let request = request(b"POST", b"/book");

    assert_eq!(
        unsafe { tinytsx_request_method_equals(&request, b"POST".as_ptr(), 4) },
        1
    );
    assert_eq!(
        unsafe { tinytsx_request_method_equals(&request, b"GET".as_ptr(), 3) },
        0
    );
}

#[test]
fn request_basic_auth_matches_the_configured_credentials() {
    let authorization = TinyHeader {
        name: TinyStringView::from_bytes(b"authorization"),
        value: TinyStringView::from_bytes(b"basic   aG9ubzphY29vbHByb2plY3Q=  "),
    };
    let request = request_with_headers(b"GET", b"/auth/test", &[authorization]);

    assert_eq!(
        unsafe {
            tinytsx_request_basic_auth_equals(
                &request,
                b"hono".as_ptr(),
                4,
                b"acoolproject".as_ptr(),
                12,
            )
        },
        1
    );
    assert_eq!(
        unsafe {
            tinytsx_request_basic_auth_equals(&request, b"hono".as_ptr(), 4, b"wrong".as_ptr(), 5)
        },
        0
    );
}

#[test]
fn request_query_presence_matches_bare_empty_and_valued_parameters() {
    for target in [
        b"/posts?pretty".as_slice(),
        b"/posts?pretty=".as_slice(),
        b"/posts?lang=en&pretty=1".as_slice(),
    ] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe { tinytsx_request_query_has(&request, b"pretty".as_ptr(), 6) },
            1,
            "{}",
            String::from_utf8_lossy(target)
        );
    }
}

#[test]
fn request_query_presence_requires_an_exact_parameter_name() {
    for target in [
        b"/posts".as_slice(),
        b"/posts?prettier=1".as_slice(),
        b"/posts?notpretty".as_slice(),
    ] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe { tinytsx_request_query_has(&request, b"pretty".as_ptr(), 6) },
            0,
            "{}",
            String::from_utf8_lossy(target)
        );
    }
}

#[test]
fn request_path_patterns_match_nonempty_named_segments() {
    let matching = request(b"GET", b"/entry/abc-123?expand=true");

    assert_eq!(
        unsafe {
            tinytsx_request_path_matches(&matching, b"/entry/:id".as_ptr(), b"/entry/:id".len())
        },
        1
    );
    assert_eq!(
        unsafe {
            tinytsx_request_path_matches(&matching, b"/other/:id".as_ptr(), b"/other/:id".len())
        },
        0
    );
    let empty = request(b"GET", b"/entry/");
    assert_eq!(
        unsafe {
            tinytsx_request_path_matches(&empty, b"/entry/:id".as_ptr(), b"/entry/:id".len())
        },
        0
    );
}

#[test]
fn request_path_patterns_match_terminal_wildcards() {
    for target in [b"/api".as_slice(), b"/api/", b"/api/x", b"/api/x/y"] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe { tinytsx_request_path_matches(&request, b"/api/*".as_ptr(), b"/api/*".len()) },
            1,
            "{}",
            String::from_utf8_lossy(target)
        );
    }
    let other = request(b"GET", b"/other");
    assert_eq!(
        unsafe { tinytsx_request_path_matches(&other, b"/api/*".as_ptr(), b"/api/*".len()) },
        0
    );
}

#[test]
fn response_writer_decodes_a_named_path_segment() {
    let request = request(b"GET", b"/entry/hello%20world%2Fok");
    let mut output = [0_u8; 14];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_html_write_path_segment(&mut writer, &request, 1) };

    assert_eq!(status, OK);
    assert_eq!(&output, b"hello world/ok");
}

#[test]
fn response_writer_preserves_malformed_percent_encoded_utf8() {
    let request = request(b"GET", b"/entry/a%FFb%2");
    let mut output = [0_u8; 7];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_html_write_path_segment(&mut writer, &request, 1) };

    assert_eq!(status, OK);
    assert_eq!(&output, b"a%FFb%2");
}

#[test]
fn response_writer_reads_request_headers_case_insensitively() {
    let headers = [TinyHeader {
        name: TinyStringView::from_bytes(b"User-Agent"),
        value: TinyStringView::from_bytes(b"tiny-client/1.0"),
    }];
    let request = request_with_headers(b"GET", b"/", &headers);
    let mut output = [0_u8; 15];
    let mut writer = writer(&mut output);

    let status = unsafe {
        tinytsx_html_write_request_header(&mut writer, &request, b"user-agent".as_ptr(), 10)
    };

    assert_eq!(status, OK);
    assert_eq!(&output, b"tiny-client/1.0");
}

#[test]
fn response_writer_formats_a_missing_request_header_as_undefined() {
    let request = request(b"GET", b"/");
    let mut output = [0_u8; 9];
    let mut writer = writer(&mut output);

    let status = unsafe {
        tinytsx_html_write_request_header(&mut writer, &request, b"User-Agent".as_ptr(), 10)
    };

    assert_eq!(status, OK);
    assert_eq!(&output, b"undefined");
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
fn console_error_writes_one_line() {
    let mut output = Vec::new();

    let status = write_console_error(&mut output, b"Error: failed");

    assert_eq!(status, OK);
    assert_eq!(output, b"Error: failed\n");
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
fn response_begin_accepts_an_absent_content_type() {
    let mut output = [];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_response_begin(&mut writer, 302, CONTENT_TYPE_NONE) };

    assert_eq!(status, OK);
    assert_eq!(writer.http_status, 302);
    assert_eq!(writer.content_type, CONTENT_TYPE_NONE);
}

#[test]
fn response_begin_rejects_invalid_content_types() {
    let mut output = [];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_response_begin(&mut writer, 200, 99) };

    assert_eq!(status, INTERNAL_ERROR);
    assert_eq!(writer.status, INTERNAL_ERROR);
}

#[test]
fn response_headers_set_case_insensitively() {
    let mut output = [];
    let mut writer = writer(&mut output);

    assert_eq!(
        unsafe {
            tinytsx_response_header_static(
                &mut writer,
                b"X-Powered-By".as_ptr(),
                12,
                b"Hono".as_ptr(),
                4,
            )
        },
        OK
    );
    assert_eq!(
        unsafe {
            tinytsx_response_header_static(
                &mut writer,
                b"x-powered-by".as_ptr(),
                12,
                b"TinyTSX".as_ptr(),
                7,
            )
        },
        OK
    );

    assert_eq!(writer.header_count, 1);
    assert_eq!(view(&writer.headers[0].name), b"X-Powered-By");
    assert_eq!(view(&writer.headers[0].value), b"TinyTSX");
}

#[test]
fn response_headers_format_elapsed_milliseconds_in_writer_storage() {
    let mut output = [];
    let mut writer = writer(&mut output);

    let status = unsafe {
        tinytsx_response_header_elapsed_millis(
            &mut writer,
            b"X-Response-Time".as_ptr(),
            15,
            1_000,
            1_042,
            b"ms".as_ptr(),
            2,
        )
    };

    assert_eq!(status, OK);
    assert_eq!(writer.header_count, 1);
    assert_eq!(view(&writer.headers[0].name), b"X-Response-Time");
    assert_eq!(view(&writer.headers[0].value), b"42ms");
    assert_eq!(writer.dynamic_header_cursor, 4);
}

#[test]
fn response_headers_reject_invalid_names_and_values() {
    let mut output = [];
    let mut writer = writer(&mut output);

    assert_eq!(
        unsafe {
            tinytsx_response_header_static(&mut writer, b"bad name".as_ptr(), 8, b"x".as_ptr(), 1)
        },
        BAD_REQUEST
    );
    assert_eq!(
        unsafe {
            tinytsx_response_header_static(
                &mut writer,
                b"x-test".as_ptr(),
                6,
                b"a\r\nb".as_ptr(),
                4,
            )
        },
        BAD_REQUEST
    );
    assert_eq!(writer.header_count, 0);
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
        header_count: 0,
        headers: [empty_header(); MAX_RESPONSE_HEADERS],
        dynamic_header_cursor: 0,
        dynamic_header_bytes: [0; MAX_DYNAMIC_HEADER_BYTES],
    }
}

const fn empty_header() -> TinyHeader {
    TinyHeader {
        name: TinyStringView {
            ptr: std::ptr::null(),
            len: 0,
        },
        value: TinyStringView {
            ptr: std::ptr::null(),
            len: 0,
        },
    }
}

fn view(value: &TinyStringView) -> &[u8] {
    if value.ptr.is_null() {
        return &[];
    }
    // SAFETY: Tests only read views while their request input remains alive.
    unsafe { std::slice::from_raw_parts(value.ptr, value.len) }
}
