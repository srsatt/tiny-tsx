use super::{
    BAD_REQUEST, CONTENT_TYPE_HTML, CONTENT_TYPE_NONE, CONTENT_TYPE_TEXT,
    EMPTY_SQLITE_EXECUTE_RESULT, INTERNAL_ERROR, MAX_DYNAMIC_HEADER_BYTES, MAX_RESPONSE_HEADERS,
    MAX_SQLITE_RESULTS, MAX_STREAM_CHUNKS, OK, OpenAiTransport, REQUEST_OOM, RequestArena,
    TinyHeader, TinyResponseWriter, TinySqlParameter, TinySqliteExecuteResult, TinyStringView,
    copy_request_header_view, decode_sqlite_parameters, relocate_writer_view, render, request,
    request_with_body, request_with_headers,
    tinytsx_html_write_fetch_status, tinytsx_html_write_path_segment, tinytsx_html_write_path_tail,
    tinytsx_html_write_query_parameter, tinytsx_html_write_request_header,
    tinytsx_html_write_request_json_field, tinytsx_html_write_response_header,
    tinytsx_html_write_sqlite_changes, tinytsx_html_write_sqlite_last_insert_row_id,
    tinytsx_html_write_static, tinytsx_request_basic_auth_equals, tinytsx_request_body_length,
    tinytsx_request_cookie_present, tinytsx_request_if_none_match, tinytsx_request_method_equals,
    tinytsx_request_path_equals, tinytsx_request_path_matches,
    tinytsx_request_path_segment_min_length, tinytsx_request_query_has, tinytsx_response_begin,
    tinytsx_response_header_elapsed_millis, tinytsx_response_header_request_id,
    tinytsx_response_header_static, tinytsx_response_stream_begin,
    tinytsx_response_stream_chunk_begin, tinytsx_response_stream_chunk_end,
    tinytsx_response_stream_chunk_static, write_console_error,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

#[test]
fn request_arena_reuses_one_bounded_output_allocation() {
    let request = request(b"GET", b"/");
    let mut arena = RequestArena::new(128);
    let start = arena.output.as_ptr();

    drop(render(&request, &mut arena));
    drop(render(&request, &mut arena));

    assert_eq!(arena.output.as_ptr(), start);
    assert_eq!(arena.output.len(), 128);
}

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
fn request_body_length_rejects_invalid_views() {
    let request = request_with_body(b"POST", b"/", &[], b"four");
    assert_eq!(unsafe { tinytsx_request_body_length(&request) }, 4);
    assert_eq!(
        unsafe { tinytsx_request_body_length(std::ptr::null()) },
        usize::MAX
    );
}

#[test]
fn sqlite_parameters_decode_route_and_closed_json_values_in_order() {
    use tinytsx_runtime_sqlite::SqlValue;

    let body = br#"{"title":"Hello","count":3,"score":1.5,"nothing":null,"enabled":true,"disabled":false}"#;
    let request = request_with_body(b"POST", b"/posts/hello%20world", &[], body);
    let fields = [
        b"title".as_slice(),
        b"count",
        b"score",
        b"nothing",
        b"enabled",
        b"disabled",
    ];
    let parameters = [
        TinySqlParameter {
            kind: 1,
            value: 1,
            pointer: std::ptr::null(),
        },
        TinySqlParameter {
            kind: 2,
            value: fields[0].len(),
            pointer: fields[0].as_ptr(),
        },
        TinySqlParameter {
            kind: 2,
            value: fields[1].len(),
            pointer: fields[1].as_ptr(),
        },
        TinySqlParameter {
            kind: 2,
            value: fields[2].len(),
            pointer: fields[2].as_ptr(),
        },
        TinySqlParameter {
            kind: 2,
            value: fields[3].len(),
            pointer: fields[3].as_ptr(),
        },
        TinySqlParameter {
            kind: 2,
            value: fields[4].len(),
            pointer: fields[4].as_ptr(),
        },
        TinySqlParameter {
            kind: 2,
            value: fields[5].len(),
            pointer: fields[5].as_ptr(),
        },
    ];

    let decoded =
        unsafe { decode_sqlite_parameters(&request, parameters.as_ptr(), parameters.len()) }
            .expect("decode supported SQLite parameters");

    assert_eq!(
        decoded,
        vec![
            SqlValue::Text("hello world".into()),
            SqlValue::Text("Hello".into()),
            SqlValue::Integer(3),
            SqlValue::Real(1.5),
            SqlValue::Null,
            SqlValue::Integer(1),
            SqlValue::Integer(0),
        ]
    );
}

#[test]
fn sqlite_parameters_traverse_bounded_nested_request_json_paths() {
    use tinytsx_runtime_sqlite::SqlValue;

    let body =
        br#"{"profile":{"name":"TinyTSX","preferences":{"theme":"dark","alerts":true}},"score":7}"#;
    let request = request_with_body(b"POST", b"/profiles/1", &[], body);
    let paths = [
        b"profile\0name".as_slice(),
        b"profile\0preferences\0theme",
        b"profile\0preferences\0alerts",
        b"score",
    ];
    let parameters = paths.map(|path| TinySqlParameter {
        kind: 2,
        value: path.len(),
        pointer: path.as_ptr(),
    });

    assert_eq!(
        unsafe { decode_sqlite_parameters(&request, parameters.as_ptr(), parameters.len()) },
        Ok(vec![
            SqlValue::Text("TinyTSX".into()),
            SqlValue::Text("dark".into()),
            SqlValue::Integer(1),
            SqlValue::Integer(7),
        ]),
    );
}

#[test]
fn sqlite_parameters_reject_malformed_missing_and_structured_json_values() {
    let field = b"title";
    let parameter = TinySqlParameter {
        kind: 2,
        value: field.len(),
        pointer: field.as_ptr(),
    };

    for body in [
        b"{".as_slice(),
        br#"{}"#,
        br#"{"title":[]}"#,
        br#"{"title":{}}"#,
    ] {
        let request = request_with_body(b"POST", b"/posts", &[], body);
        assert_eq!(
            unsafe { decode_sqlite_parameters(&request, &parameter, 1) },
            Err(BAD_REQUEST),
            "{}",
            String::from_utf8_lossy(body)
        );
    }
}

#[test]
fn sqlite_parameters_accept_an_empty_parameter_list_without_a_pointer() {
    let request = request(b"GET", b"/posts");

    assert_eq!(
        unsafe { decode_sqlite_parameters(&request, std::ptr::null(), 0) },
        Ok(Vec::new())
    );
}

#[test]
fn sqlite_parameters_generate_distinct_version_four_uuids() {
    use tinytsx_runtime_sqlite::SqlValue;

    let request = request(b"POST", b"/posts");
    let parameter = TinySqlParameter {
        kind: 3,
        value: 0,
        pointer: std::ptr::null(),
    };
    let first =
        unsafe { decode_sqlite_parameters(&request, &parameter, 1) }.expect("first UUID parameter");
    let second = unsafe { decode_sqlite_parameters(&request, &parameter, 1) }
        .expect("second UUID parameter");

    let [SqlValue::Text(first)] = first.as_slice() else {
        panic!("UUID parameter must be text");
    };
    let [SqlValue::Text(second)] = second.as_slice() else {
        panic!("UUID parameter must be text");
    };
    assert_ne!(first, second);
    for uuid in [first, second] {
        assert_eq!(uuid.len(), 36);
        assert_eq!(&uuid[14..15], "4");
        assert!(matches!(&uuid[19..20], "8" | "9" | "a" | "b"));
        assert!(
            uuid.bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        );
    }
}

#[test]
fn sqlite_parameters_decode_closed_primitive_values() {
    use tinytsx_runtime_sqlite::SqlValue;

    let request = request(b"POST", b"/values");
    let text = b"admin";
    let parameters = [
        TinySqlParameter {
            kind: 4,
            value: text.len(),
            pointer: text.as_ptr(),
        },
        TinySqlParameter {
            kind: 5,
            value: (-42_i64) as usize,
            pointer: std::ptr::null(),
        },
        TinySqlParameter {
            kind: 6,
            value: 1.5_f64.to_bits() as usize,
            pointer: std::ptr::null(),
        },
        TinySqlParameter {
            kind: 7,
            value: 1,
            pointer: std::ptr::null(),
        },
        TinySqlParameter {
            kind: 8,
            value: 0,
            pointer: std::ptr::null(),
        },
    ];

    assert_eq!(
        unsafe { decode_sqlite_parameters(&request, parameters.as_ptr(), parameters.len()) },
        Ok(vec![
            SqlValue::Text("admin".into()),
            SqlValue::Integer(-42),
            SqlValue::Real(1.5),
            SqlValue::Integer(1),
            SqlValue::Null,
        ]),
    );
}

#[test]
fn sqlite_parameters_copy_a_required_bounded_request_header() {
    use tinytsx_runtime_sqlite::SqlValue;

    let name = b"Idempotency-Key";
    let mut value = b"payment-123".to_vec();
    let headers = [TinyHeader {
        name: TinyStringView::from_bytes(name),
        value: TinyStringView::from_bytes(&value),
    }];
    let request = request_with_headers(b"POST", b"/payments", &headers);
    let parameter = TinySqlParameter {
        kind: 9,
        value: name.len(),
        pointer: name.as_ptr(),
    };

    let decoded = unsafe { decode_sqlite_parameters(&request, &parameter, 1) }
        .expect("decode request header parameter");
    value.fill(b'x');

    assert_eq!(decoded, vec![SqlValue::Text("payment-123".into())]);
}

#[test]
fn sqlite_parameters_reject_missing_empty_oversized_and_invalid_utf8_headers() {
    let name = b"Idempotency-Key";
    let parameter = TinySqlParameter {
        kind: 9,
        value: name.len(),
        pointer: name.as_ptr(),
    };

    let request = request(b"POST", b"/payments");
    assert_eq!(
        unsafe { decode_sqlite_parameters(&request, &parameter, 1) },
        Err(BAD_REQUEST),
    );

    for value in [&[][..], &[b'x'; 257][..], &[0xff][..]] {
        let headers = [TinyHeader {
            name: TinyStringView::from_bytes(name),
            value: TinyStringView::from_bytes(value),
        }];
        let request = request_with_headers(b"POST", b"/payments", &headers);
        assert_eq!(
            unsafe { decode_sqlite_parameters(&request, &parameter, 1) },
            Err(BAD_REQUEST),
        );
    }
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
    let headers = [authorization];
    let request = request_with_headers(b"GET", b"/auth/test", &headers);

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
fn request_cookie_presence_uses_the_same_bounded_parser_as_cookie_values() {
    let cookie = TinyHeader {
        name: TinyStringView::from_bytes(b"Cookie"),
        value: TinyStringView::from_bytes(b"theme=dark; stytch_session_jwt=user%2D1; empty="),
    };
    let headers = [cookie];
    let request = request_with_headers(b"GET", b"/session", &headers);

    assert_eq!(
        unsafe {
            tinytsx_request_cookie_present(
                &request,
                b"stytch_session_jwt".as_ptr(),
                b"stytch_session_jwt".len(),
            )
        },
        1,
    );
    assert_eq!(
        unsafe { tinytsx_request_cookie_present(&request, b"empty".as_ptr(), b"empty".len()) },
        0,
    );
    assert_eq!(
        unsafe { tinytsx_request_cookie_present(&request, b"missing".as_ptr(), b"missing".len()) },
        0,
    );
}

#[test]
fn request_if_none_match_accepts_weak_tags_and_lists() {
    let header = TinyHeader {
        name: TinyStringView::from_bytes(b"If-None-Match"),
        value: TinyStringView::from_bytes(b"\"miss\", W/\"tag\""),
    };
    let headers = [header];
    let request = request_with_headers(b"GET", b"/etag/cached", &headers);

    assert_eq!(
        unsafe { tinytsx_request_if_none_match(&request, b"\"tag\"".as_ptr(), 5) },
        1
    );
    assert_eq!(
        unsafe { tinytsx_request_if_none_match(&request, b"\"other\"".as_ptr(), 7) },
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
fn request_query_presence_decodes_form_encoded_names() {
    for (target, expected) in [
        (b"/posts?%70retty".as_slice(), b"pretty".as_slice()),
        (b"/posts?pre%74ty=1".as_slice(), b"pretty".as_slice()),
        (b"/posts?pretty+name".as_slice(), b"pretty name".as_slice()),
        (b"/posts?m%C3%B8%C3%B8".as_slice(), "møø".as_bytes()),
        (b"/posts?%25".as_slice(), b"%".as_slice()),
        (b"/posts?%2".as_slice(), b"%2".as_slice()),
    ] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe { tinytsx_request_query_has(&request, expected.as_ptr(), expected.len()) },
            1,
            "{}",
            String::from_utf8_lossy(target)
        );
    }

    let request = request(b"GET", b"/posts?pretty+name");
    assert_eq!(
        unsafe { tinytsx_request_query_has(&request, b"pretty+name".as_ptr(), 11) },
        0
    );
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
fn request_path_patterns_match_terminal_multi_segment_parameters() {
    for path in [b"/".as_slice(), b"/one/two".as_slice()] {
        let request = request(b"GET", path);
        assert_eq!(
            unsafe {
                tinytsx_request_path_matches(
                    &request,
                    b"/:remaining{.*}".as_ptr(),
                    b"/:remaining{.*}".len(),
                )
            },
            1
        );
    }

    let request = request(b"GET", b"/api/one/two");
    assert_eq!(
        unsafe {
            tinytsx_request_path_matches(
                &request,
                b"/api/:remaining{.*}".as_ptr(),
                b"/api/:remaining{.*}".len(),
            )
        },
        1
    );
}

#[test]
fn request_path_segment_minimum_length_counts_percent_decoded_bytes() {
    for (target, minimum, expected) in [
        (b"/users/abc".as_slice(), 3, 1),
        (b"/users/ab".as_slice(), 3, 0),
        (b"/users/a%62c".as_slice(), 3, 1),
        (b"/users/a%62".as_slice(), 3, 0),
    ] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe { tinytsx_request_path_segment_min_length(&request, 1, minimum) },
            expected,
            "{}",
            String::from_utf8_lossy(target)
        );
    }
}

#[test]
fn request_path_patterns_match_numeric_named_segments() {
    for target in [b"/post/1".as_slice(), b"/post/123"] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe {
                tinytsx_request_path_matches(
                    &request,
                    b"/post/:id{[0-9]+}".as_ptr(),
                    b"/post/:id{[0-9]+}".len(),
                )
            },
            1,
            "{}",
            String::from_utf8_lossy(target)
        );
    }
    for target in [b"/post/nope".as_slice(), b"/post/12a", b"/post/"] {
        let request = request(b"GET", target);
        assert_eq!(
            unsafe {
                tinytsx_request_path_matches(
                    &request,
                    b"/post/:id{[0-9]+}".as_ptr(),
                    b"/post/:id{[0-9]+}".len(),
                )
            },
            0,
            "{}",
            String::from_utf8_lossy(target)
        );
    }
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
fn response_writer_decodes_a_multi_segment_path_tail() {
    let request = request(b"GET", b"/files/hello%20world/one%2Ftwo");
    let mut output = [0_u8; 19];
    let mut writer = writer(&mut output);

    let status = unsafe { tinytsx_html_write_path_tail(&mut writer, &request, 1) };

    assert_eq!(status, OK);
    assert_eq!(&output, b"hello world/one/two");
}

#[test]
fn response_writer_decodes_and_escapes_a_query_parameter() {
    let request = request(b"GET", b"/hello?name=%3C%3E%26%22%27+Ada");
    let expected = b"&lt;&gt;&amp;&quot;&#39; Ada";
    let mut output = vec![0_u8; expected.len()];
    let mut writer = writer(&mut output);

    let status = unsafe {
        tinytsx_html_write_query_parameter(
            &mut writer,
            &request,
            b"name".as_ptr(),
            4,
            b"World".as_ptr(),
            5,
            1,
        )
    };

    assert_eq!(status, OK);
    assert_eq!(output, expected);
}

#[test]
fn response_writer_uses_and_escapes_a_missing_query_fallback() {
    let request = request(b"GET", b"/hello?other=value");
    let expected = b"&lt;World&gt;";
    let mut output = vec![0_u8; expected.len()];
    let mut writer = writer(&mut output);

    let status = unsafe {
        tinytsx_html_write_query_parameter(
            &mut writer,
            &request,
            b"name".as_ptr(),
            4,
            b"<World>".as_ptr(),
            7,
            1,
        )
    };

    assert_eq!(status, OK);
    assert_eq!(output, expected);
}

#[test]
fn response_writer_preserves_an_explicitly_empty_query_parameter() {
    let request = request(b"GET", b"/hello?name=");
    let mut output = [0_u8; 0];
    let mut writer = writer(&mut output);

    let status = unsafe {
        tinytsx_html_write_query_parameter(
            &mut writer,
            &request,
            b"name".as_ptr(),
            4,
            b"World".as_ptr(),
            5,
            1,
        )
    };

    assert_eq!(status, OK);
    assert_eq!(writer.cursor, writer.start);
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
fn response_writer_serializes_selected_request_json_primitives() {
    let body = br#"{"name":"TinyTSX & \"Bun\"","count":7,"enabled":true,"note":null}"#;
    let request = request_with_body(b"POST", b"/json-body", &[], body);
    let mut output = [0_u8; 128];
    let mut writer = writer(&mut output);

    for field in [b"name".as_slice(), b"count", b"enabled", b"note"] {
        let status = unsafe {
            tinytsx_html_write_request_json_field(
                &mut writer,
                &request,
                field.as_ptr(),
                field.len(),
            )
        };
        assert_eq!(status, OK);
    }

    let written = writer.cursor as usize - writer.start as usize;
    assert_eq!(&output[..written], br#""TinyTSX & \"Bun\""7truenull"#);
}

#[test]
fn response_writer_traverses_bounded_nested_request_json_paths() {
    let body =
        br#"{"profile":{"name":"TinyTSX","preferences":{"theme":"dark","alerts":true}},"score":7}"#;
    let request = request_with_body(b"POST", b"/profiles/1", &[], body);
    let mut output = [0_u8; 64];
    let mut writer = writer(&mut output);

    for path in [
        b"profile\0name".as_slice(),
        b"profile\0preferences\0theme",
        b"profile\0preferences\0alerts",
        b"score",
    ] {
        assert_eq!(
            unsafe {
                tinytsx_html_write_request_json_field(
                    &mut writer,
                    &request,
                    path.as_ptr(),
                    path.len(),
                )
            },
            OK,
        );
    }

    let written = writer.cursor as usize - writer.start as usize;
    assert_eq!(&output[..written], br#""TinyTSX""dark"true7"#);
}

#[test]
fn response_writer_rejects_invalid_request_json_fields() {
    for body in [
        b"{".as_slice(),
        br#"{}"#,
        br#"{"value":[]}"#,
        br#"{"value":{}}"#,
    ] {
        let request = request_with_body(b"POST", b"/json-body", &[], body);
        let mut output = [0_u8; 32];
        let mut writer = writer(&mut output);
        assert_eq!(
            unsafe {
                tinytsx_html_write_request_json_field(&mut writer, &request, b"value".as_ptr(), 5)
            },
            BAD_REQUEST,
        );
        assert_eq!(writer.cursor, writer.start);
    }
}

#[test]
fn request_json_paths_enforce_static_shape_and_selected_string_bounds() {
    let body = format!(r#"{{"profile":{{"name":"{}"}}}}"#, "x".repeat(4_097));
    let request = request_with_body(b"POST", b"/profiles/1", &[], body.as_bytes());
    let mut output = [0_u8; 32];
    let mut writer = writer(&mut output);

    assert_eq!(
        unsafe {
            tinytsx_html_write_request_json_field(
                &mut writer,
                &request,
                b"profile\0name".as_ptr(),
                b"profile\0name".len(),
            )
        },
        BAD_REQUEST,
    );

    for path in [b"a\0b\0c\0d\0e".as_slice(), b"a\0\0b", &[b'x'; 129]] {
        assert_eq!(
            unsafe {
                tinytsx_html_write_request_json_field(
                    &mut writer,
                    &request,
                    path.as_ptr(),
                    path.len(),
                )
            },
            INTERNAL_ERROR,
        );
    }
    assert_eq!(writer.cursor, writer.start);
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
fn response_writer_retains_static_and_arena_backed_stream_chunks() {
    let mut output = [0_u8; 7];
    let mut writer = writer(&mut output);

    assert_eq!(unsafe { tinytsx_response_stream_begin(&mut writer) }, OK);
    assert_eq!(
        unsafe { tinytsx_response_stream_chunk_static(&mut writer, b"first".as_ptr(), 5) },
        OK
    );
    assert_eq!(
        unsafe { tinytsx_response_stream_chunk_begin(&mut writer) },
        OK
    );
    assert_eq!(
        unsafe { tinytsx_html_write_static(&mut writer, b"second\n".as_ptr(), 7) },
        OK
    );
    assert_eq!(
        unsafe { tinytsx_response_stream_chunk_end(&mut writer) },
        OK
    );

    assert_eq!(writer.streaming, 1);
    assert_eq!(writer.stream_chunk_count, 2);
    assert_eq!(view(&writer.stream_chunks[0]), b"first");
    assert_eq!(view(&writer.stream_chunks[1]), b"second\n");
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
fn request_id_reuses_a_valid_header_and_generates_for_invalid_input() {
    for (input, expected) in [
        (b"hono-is-hot".as_slice(), Some(b"hono-is-hot".as_slice())),
        (b"invalid!".as_slice(), None),
    ] {
        let headers = [TinyHeader {
            name: TinyStringView::from_bytes(b"X-Request-Id"),
            value: TinyStringView::from_bytes(input),
        }];
        let request = request_with_headers(b"GET", b"/", &headers);
        let mut output = [0_u8; 64];
        let mut writer = writer(&mut output);
        assert_eq!(
            unsafe {
                tinytsx_response_header_request_id(
                    &mut writer,
                    &request,
                    b"X-Request-Id".as_ptr(),
                    12,
                    255,
                )
            },
            OK
        );
        assert_eq!(
            unsafe {
                tinytsx_html_write_response_header(&mut writer, b"X-Request-Id".as_ptr(), 12)
            },
            OK
        );
        let value = view(&writer.headers[0].value);
        assert_eq!(&output[..value.len()], value);
        if let Some(expected) = expected {
            assert_eq!(value, expected);
        } else {
            assert_eq!(value.len(), 36);
            assert_eq!(value[14], b'4');
            assert!(matches!(value[19], b'8' | b'9' | b'a' | b'b'));
        }
    }
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
fn rendered_header_views_relocate_from_writer_storage_to_the_request_arena() {
    let source = *b"prefix-value";
    let destination = source;
    let mut dynamic = TinyStringView::from_bytes(&source[7..]);
    let mut static_view = TinyStringView::from_bytes(b"static");

    relocate_writer_view(
        &mut dynamic,
        source.as_ptr() as usize,
        source.len(),
        destination.as_ptr(),
    );
    relocate_writer_view(
        &mut static_view,
        source.as_ptr() as usize,
        source.len(),
        destination.as_ptr(),
    );

    assert_eq!(dynamic.ptr, destination[7..].as_ptr());
    assert_eq!(view(&dynamic), b"value");
    assert_eq!(view(&static_view), b"static");
}

#[test]
fn request_derived_response_headers_move_into_reusable_arena_storage() {
    let request_value = *b"request-id";
    let request_header = TinyHeader {
        name: TinyStringView::from_bytes(b"X-Request-Id"),
        value: TinyStringView::from_bytes(&request_value),
    };
    let mut response_value = request_header.value;
    let mut storage = Vec::with_capacity(request_value.len());

    copy_request_header_view(&mut response_value, &[request_header], &mut storage);

    assert_eq!(view(&response_value), b"request-id");
    assert_eq!(response_value.ptr, storage.as_ptr());
    assert_ne!(response_value.ptr, request_value.as_ptr());
}

#[test]
fn sqlite_execute_results_write_changes_row_ids_and_null() {
    let mut output = [0_u8; 64];
    let mut writer = writer(&mut output);
    writer.sqlite_results[2] = TinySqliteExecuteResult {
        changes: 7,
        last_insert_row_id: -42,
        present: 1,
        has_last_insert_row_id: 1,
    };
    writer.sqlite_results[3] = TinySqliteExecuteResult {
        changes: 0,
        last_insert_row_id: 0,
        present: 1,
        has_last_insert_row_id: 0,
    };

    assert_eq!(
        unsafe { tinytsx_html_write_sqlite_changes(&mut writer, 2) },
        OK
    );
    assert_eq!(
        unsafe { tinytsx_html_write_sqlite_last_insert_row_id(&mut writer, 2, 0) },
        OK,
    );
    assert_eq!(
        unsafe { tinytsx_html_write_sqlite_last_insert_row_id(&mut writer, 3, 1) },
        OK,
    );
    assert_eq!(&output[..8], b"7-42null");
    assert_eq!(
        unsafe { tinytsx_html_write_sqlite_changes(&mut writer, 1) },
        INTERNAL_ERROR,
    );
}

#[test]
fn fetch_status_writes_the_local_http_response_code() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind local fetch peer");
    let address = listener.local_addr().expect("local fetch peer address");
    let peer = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local fetch");
        let mut request = [0_u8; 1024];
        let _ = stream.read(&mut request).expect("read local fetch");
        stream
            .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .expect("write local fetch response");
    });
    let url = format!("http://{address}/status");
    let mut output = [0_u8; 3];
    let mut writer = writer(&mut output);

    let result = unsafe { tinytsx_html_write_fetch_status(&mut writer, url.as_ptr(), url.len()) };

    assert_eq!(result, OK);
    assert_eq!(&output, b"204");
    peer.join().expect("join local fetch peer");
}

#[test]
fn openai_chat_posts_json_and_decodes_the_assistant_text() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind local provider");
    let address = listener.local_addr().expect("local provider address");
    let peer = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local provider request");
        let mut request = [0_u8; 4096];
        let length = stream
            .read(&mut request)
            .expect("read local provider request");
        let response =
            br#"{"choices":[{"message":{"content":"Hello\nfrom local \u03bb \ud83d\ude00"}}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            response.len(),
        )
        .expect("write local provider head");
        stream
            .write_all(response)
            .expect("write local provider body");
        request[..length].to_vec()
    });
    let url = format!("http://{address}/v1/chat/completions");
    let authorization = b"Bearer local-test-key";
    let body = br#"{"model":"local-model","messages":[{"role":"user","content":"hello"}]}"#;
    let output = OpenAiTransport::default()
        .perform(url.as_bytes(), authorization, body)
        .expect("perform local provider request");

    assert_eq!(output, "Hello\nfrom local λ 😀".as_bytes());
    let request = peer.join().expect("join local provider");
    assert!(request.starts_with(b"POST /v1/chat/completions HTTP/1.1\r\n"));
    let authorization = b"Authorization: Bearer local-test-key\r\n";
    assert!(
        request
            .windows(authorization.len())
            .any(|window| window.eq_ignore_ascii_case(authorization))
    );
    assert!(request.ends_with(body));
}

#[test]
fn openai_transport_reuses_one_http_connection() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind local provider");
    let address = listener.local_addr().expect("local provider address");
    let peer = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept local provider connection");
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .expect("bound provider read");
        for request_index in 0..2 {
            read_http_request(&mut stream);
            let response = br#"{"choices":[{"message":{"content":"reused"}}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: {}\r\n\r\n",
                response.len(),
                if request_index == 0 { "keep-alive" } else { "close" },
            )
            .expect("write local provider head");
            stream
                .write_all(response)
                .expect("write local provider body");
        }
    });
    let url = format!("http://{address}/v1/chat/completions");
    let mut transport = OpenAiTransport::default();

    for _ in 0..2 {
        let output = transport
            .perform(
                url.as_bytes(),
                b"Bearer local-test-key",
                br#"{"model":"local-model","messages":[]}"#,
            )
            .expect("perform local provider request");
        assert_eq!(output, b"reused");
    }
    peer.join().expect("join local provider");
}

fn read_http_request(stream: &mut std::net::TcpStream) {
    let mut request = Vec::new();
    let mut byte = [0_u8; 1];
    while !request.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).expect("read provider head");
        request.push(byte[0]);
    }
    let head = std::str::from_utf8(&request).expect("provider head is utf8");
    let content_length = head
        .lines()
        .find_map(|line| {
            line.strip_prefix("Content-Length: ")
                .or_else(|| line.strip_prefix("content-length: "))
        })
        .expect("provider content length")
        .parse::<usize>()
        .expect("numeric provider content length");
    let mut body = vec![0_u8; content_length];
    stream.read_exact(&mut body).expect("read provider body");
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

#[test]
fn response_headers_accept_exact_capacity_and_reject_overflow() {
    let mut output = [];
    let mut writer = writer(&mut output);
    let names = (0..=MAX_RESPONSE_HEADERS)
        .map(|index| format!("x-test-{index}"))
        .collect::<Vec<_>>();

    for name in &names[..MAX_RESPONSE_HEADERS] {
        assert_eq!(
            unsafe {
                tinytsx_response_header_static(
                    &mut writer,
                    name.as_ptr(),
                    name.len(),
                    b"x".as_ptr(),
                    1,
                )
            },
            OK
        );
    }
    assert_eq!(writer.header_count, MAX_RESPONSE_HEADERS);
    let overflow = &names[MAX_RESPONSE_HEADERS];
    assert_eq!(
        unsafe {
            tinytsx_response_header_static(
                &mut writer,
                overflow.as_ptr(),
                overflow.len(),
                b"x".as_ptr(),
                1,
            )
        },
        REQUEST_OOM
    );
    assert_eq!(writer.header_count, MAX_RESPONSE_HEADERS);
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
        sqlite_results: [EMPTY_SQLITE_EXECUTE_RESULT; MAX_SQLITE_RESULTS],
        streaming: 0,
        stream_chunk_count: 0,
        stream_chunks: [TinyStringView {
            ptr: std::ptr::null(),
            len: 0,
        }; MAX_STREAM_CHUNKS],
        stream_chunk_start: std::ptr::null_mut(),
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
