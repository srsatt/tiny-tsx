#![cfg(all(target_os = "macos", target_arch = "aarch64"))]

use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static NATIVE_BUILD: Mutex<()> = Mutex::new(());

struct Server(Child);

struct ExpectedResponse<'a> {
    method: &'a str,
    status: u16,
    path: &'a str,
    body: &'a str,
    content_type: Option<&'a str>,
    headers: &'a [(&'a str, &'a str)],
    millisecond_headers: &'a [&'a str],
    request_headers: &'a [(&'a str, &'a str)],
    stderr: &'a [&'a str],
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn builds_and_serves_static_tsx_as_native_macho() {
    build_and_serve(
        "examples/static-page/server.tsx",
        "<html><body><h1>Hello from TinyTSX</h1></body></html>",
        "text/html; charset=utf-8",
    );
}

#[test]
fn builds_and_serves_hono_through_source_level_serve() {
    let _build_guard = NATIVE_BUILD.lock().expect("lock native E2E build");
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    let entry = directory.join("server.ts");
    let binary = directory.join("server");
    let port = available_port();
    fs::write(
        &entry,
        format!(
            r#"
import {{ serve }} from '@hono/node-server'
import {{ Hono }} from 'hono'

const app = new Hono()
app.get('/', (context) => context.text('served from source config'))
serve({{ fetch: app.fetch, port: {port} }})
"#,
        ),
    )
    .expect("write served application");

    let build = Command::new(env!("CARGO_BIN_EXE_tinytsx"))
        .current_dir(&root)
        .arg("build")
        .arg(&entry)
        .arg("--output")
        .arg(&binary)
        .args([
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ])
        .output()
        .expect("build source-configured server");
    assert!(
        build.status.success(),
        "build failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr),
    );
    let report: serde_json::Value = serde_json::from_slice(
        &fs::read(with_suffix(&binary, ".build.json")).expect("read build report"),
    )
    .expect("parse build report");
    assert_eq!(report["port"], port);

    let server = Server(
        Command::new(&binary)
            .spawn()
            .expect("start served application"),
    );
    let mut stream = connect_with_retry(port);
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send served request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read served response");
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(
        response.ends_with("served from source config"),
        "{response}"
    );

    drop(server);
    fs::remove_dir_all(directory).expect("remove served application artifacts");
}

#[test]
fn worker_pool_keeps_connections_alive_and_recovers_after_saturation() {
    const WORKERS: usize = 2;
    const QUEUED_CONNECTIONS: usize = WORKERS * 64;

    let _build_guard = NATIVE_BUILD.lock().expect("lock native E2E build");
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    let binary = directory.join("worker-server");
    let port = available_port();
    let mut build_command = Command::new(env!("CARGO_BIN_EXE_tinytsx"));
    build_command
        .current_dir(&root)
        .args(["build", "tests/compat/hono/multi-route-smoke.ts", "--port"])
        .arg(port.to_string())
        .arg("--workers")
        .arg(WORKERS.to_string())
        .arg("--output")
        .arg(&binary)
        .args([
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ]);
    let build = build_command.output().expect("build worker server");
    assert!(
        build.status.success(),
        "build failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr),
    );
    let report: serde_json::Value = serde_json::from_slice(
        &fs::read(with_suffix(&binary, ".build.json")).expect("read report"),
    )
    .expect("parse build report");
    assert_eq!(report["workers"], WORKERS);
    assert_eq!(report["memory"]["policy"], "arena");
    assert_eq!(report["memory"]["managedHeapRequired"], false);
    assert_eq!(report["memory"]["summary"]["managed"], 0);
    assert!(
        report["runtimeFeatures"]
            .as_array()
            .expect("runtime feature list")
            .iter()
            .any(|feature| feature == "bounded-worker-pool")
    );
    assert!(
        report["runtimeFeatures"]
            .as_array()
            .expect("runtime feature list")
            .iter()
            .any(|feature| feature == "keep-alive")
    );

    let child = Command::new(&binary).spawn().expect("start worker server");
    let _server = Server(child);

    let mut persistent = connect_with_retry(port);
    persistent
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set persistent timeout");
    persistent
        .write_all(
            b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\nGET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .expect("send pipelined Hono requests");
    let mut persistent_response = String::new();
    persistent
        .read_to_string(&mut persistent_response)
        .expect("read pipelined Hono responses");
    assert_eq!(occurrences(&persistent_response, "HTTP/1.1 200 OK\r\n"), 2);
    assert!(persistent_response.contains("Connection: keep-alive\r\n"));
    assert!(persistent_response.contains("Hono!!HTTP/1.1 200 OK\r\n"));
    assert!(persistent_response.ends_with("This is /hello"));

    let mut body_pipeline = connect_with_retry(port);
    body_pipeline
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set body pipeline timeout");
    body_pipeline
        .write_all(
            b"POST /missing HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\n\r\nbodyGET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .expect("send body and pipelined request");
    let mut body_pipeline_response = String::new();
    body_pipeline
        .read_to_string(&mut body_pipeline_response)
        .expect("read body pipeline responses");
    assert!(body_pipeline_response.starts_with("HTTP/1.1 404 Not Found\r\n"));
    assert!(body_pipeline_response.contains("404 Not FoundHTTP/1.1 200 OK\r\n"));
    assert!(body_pipeline_response.ends_with("This is /hello"));

    let mut bounded = connect_with_retry(port);
    bounded
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("set bounded connection timeout");
    let mut requests = Vec::new();
    for _ in 0..100 {
        requests.extend_from_slice(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    }
    bounded
        .write_all(&requests)
        .expect("send bounded keep-alive requests");
    let mut bounded_response = String::new();
    bounded
        .read_to_string(&mut bounded_response)
        .expect("read bounded keep-alive responses");
    assert_eq!(occurrences(&bounded_response, "HTTP/1.1 200 OK\r\n"), 100);
    assert_eq!(
        occurrences(&bounded_response, "Connection: keep-alive\r\n"),
        99
    );
    assert_eq!(occurrences(&bounded_response, "Connection: close\r\n"), 1);

    let mut malformed = connect_with_retry(port);
    malformed
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set malformed timeout");
    malformed
        .write_all(
            b"POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n",
        )
        .expect("send ambiguous request framing");
    let mut malformed_response = String::new();
    malformed
        .read_to_string(&mut malformed_response)
        .expect("read malformed response");
    assert!(malformed_response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
    assert!(malformed_response.contains("Connection: close\r\n"));

    let mut oversized = connect_with_retry(port);
    oversized
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set oversized timeout");
    oversized
        .write_all(b"POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1048577\r\n\r\n")
        .expect("send oversized body declaration");
    let mut oversized_response = String::new();
    oversized
        .read_to_string(&mut oversized_response)
        .expect("read oversized response");
    assert!(oversized_response.starts_with("HTTP/1.1 413 Payload Too Large\r\n"));
    assert!(oversized_response.contains("Connection: close\r\n"));

    let mut stalled = vec![connect_with_retry(port)];
    stalled[0]
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n")
        .expect("stall first worker");
    thread::sleep(Duration::from_millis(50));

    let mut parallel = TcpStream::connect(("127.0.0.1", port)).expect("connect parallel request");
    parallel
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set parallel timeout");
    parallel
        .write_all(b"GET /hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send parallel request");
    let mut parallel_response = String::new();
    parallel
        .read_to_string(&mut parallel_response)
        .expect("parallel worker responds while first is stalled");
    assert!(
        parallel_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "{parallel_response}"
    );
    assert!(parallel_response.ends_with("This is /hello"));

    stalled[0]
        .write_all(b"Connection: close\r\n\r\n")
        .expect("finish first worker request");
    stalled[0]
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set first worker timeout");
    let mut first_response = String::new();
    stalled[0]
        .read_to_string(&mut first_response)
        .expect("read first worker response");
    assert!(first_response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(first_response.ends_with("Hono!!"));
    stalled.clear();

    for _ in 0..WORKERS + QUEUED_CONNECTIONS {
        let mut connection =
            TcpStream::connect(("127.0.0.1", port)).expect("connect saturated request");
        connection
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n")
            .expect("stall saturated request");
        stalled.push(connection);
    }
    thread::sleep(Duration::from_millis(100));

    let mut overload = TcpStream::connect(("127.0.0.1", port)).expect("connect overload request");
    overload
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set overload timeout");
    overload
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send overload request");
    let mut overload_response = String::new();
    overload
        .read_to_string(&mut overload_response)
        .expect("read overload response");
    assert!(
        overload_response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"),
        "{overload_response}"
    );
    assert!(overload_response.ends_with("server overloaded"));

    drop(stalled);
    thread::sleep(Duration::from_millis(200));
    let mut recovered = TcpStream::connect(("127.0.0.1", port)).expect("connect recovery request");
    recovered
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set recovery timeout");
    recovered
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send recovery request");
    let mut recovered_response = String::new();
    recovered
        .read_to_string(&mut recovered_response)
        .expect("read recovery response");
    assert!(
        recovered_response.starts_with("HTTP/1.1 200 OK\r\n"),
        "{recovered_response}"
    );

    fs::remove_dir_all(directory).expect("remove worker test artifacts");
}

#[test]
fn request_arena_resets_and_worker_recovers_after_oom() {
    let _build_guard = NATIVE_BUILD.lock().expect("lock native E2E build");
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    let binary = directory.join("arena-server");
    let port = available_port();
    let build = Command::new(env!("CARGO_BIN_EXE_tinytsx"))
        .current_dir(&root)
        .args(["build", "tests/compat/hono/multi-route-smoke.ts", "--port"])
        .arg(port.to_string())
        .args(["--workers", "1", "--request-memory", "8", "--output"])
        .arg(&binary)
        .args([
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ])
        .output()
        .expect("build arena server");
    assert!(
        build.status.success(),
        "build failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr),
    );

    let child = Command::new(&binary).spawn().expect("start arena server");
    let _server = Server(child);
    let mut stream = connect_with_retry(port);
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set arena timeout");
    stream
        .write_all(
            b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\nGET /hello HTTP/1.1\r\nHost: localhost\r\n\r\n",
        )
        .expect("send normal then OOM requests");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read normal and OOM responses");
    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(response.contains("Hono!!HTTP/1.1 503 Service Unavailable\r\n"));
    assert!(response.ends_with("request memory exhausted"));

    let mut recovered = TcpStream::connect(("127.0.0.1", port)).expect("connect after OOM");
    recovered
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send request after OOM");
    let mut recovered_response = String::new();
    recovered
        .read_to_string(&mut recovered_response)
        .expect("read response after OOM");
    assert!(recovered_response.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(recovered_response.ends_with("Hono!!"));

    fs::remove_dir_all(directory).expect("remove arena test artifacts");
}

#[test]
fn builds_and_serves_an_imported_component() {
    build_and_serve(
        "examples/multi-module/server.tsx",
        "<html><body><main><h1>Imported component</h1></main></body></html>",
        "text/html; charset=utf-8",
    );
}

#[test]
fn builds_staged_constants_into_the_native_object() {
    build_and_serve(
        "examples/staged-constants/server.tsx",
        "<html><body><h1>Staged constants</h1></body></html>",
        "text/html; charset=utf-8",
    );
}

#[test]
fn builds_and_serves_native_text_through_direct_function_calls() {
    build_and_serve(
        "examples/text-response/server.ts",
        "Hono!!",
        "text/plain; charset=UTF-8",
    );
}

#[test]
fn builds_and_serves_the_pinned_hono_basic_route() {
    build_and_serve_with_options(
        "tests/compat/hono/basic-smoke.ts",
        expected("GET", 200, "/", "Hono!!", "text/plain;charset=UTF-8", &[]),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_dispatches_the_first_two_hono_basic_routes() {
    build_and_serve_with_options(
        "tests/compat/hono/multi-route-smoke.ts",
        expected("GET", 200, "/", "Hono!!", "text/plain;charset=UTF-8", &[]),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[(200, "/hello", "This is /hello", "text/plain;charset=UTF-8")],
    );
}

#[test]
fn builds_and_serves_a_closed_hono_fetch_status() {
    build_and_serve_with_options(
        "tests/compat/hono/fetch-status-smoke.ts",
        expected(
            "GET",
            200,
            "/fetch-url",
            "https://example.com/ is 200",
            "text/plain;charset=UTF-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_a_hono_named_route_parameter() {
    build_and_serve_with_options(
        "tests/compat/hono/parameter-route-smoke.ts",
        expected(
            "GET",
            200,
            "/entry/hello%20world%2Fok",
            "Your ID is hello world/ok",
            "text/plain;charset=UTF-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_nested_hono_routes() {
    build_and_serve_with_options(
        "tests/compat/hono/nested-route-smoke.ts",
        expected(
            "GET",
            200,
            "/book",
            "List Books",
            "text/plain;charset=UTF-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[(
            200,
            "/book/hello%20world",
            "Get Book: hello world",
            "text/plain;charset=UTF-8",
        )],
    );
}

#[test]
fn builds_and_serves_a_hono_post_route() {
    build_and_serve_with_options(
        "tests/compat/hono/post-route-smoke.ts",
        expected(
            "POST",
            200,
            "/book",
            "Create Book",
            "text/plain;charset=UTF-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_a_hono_json_post_response() {
    build_and_serve_with_options(
        "tests/compat/hono/json-post-smoke.ts",
        expected(
            "POST",
            201,
            "/api/posts",
            "{\"message\":\"Created!\"}",
            "application/json",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_honos_wildcard_api_fallback() {
    build_and_serve_with_options(
        "tests/compat/hono/wildcard-route-smoke.ts",
        expected(
            "GET",
            404,
            "/api/missing/path",
            "API endpoint is not found",
            "text/plain; charset=UTF-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_a_same_method_hono_handler_chain() {
    build_and_serve_with_options(
        "tests/compat/hono/handler-chain-smoke.ts",
        expected(
            "GET",
            200,
            "/chain",
            "chained",
            "text/plain;charset=UTF-8",
            &[("X-Chain", "yes")],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_static_response_headers() {
    build_and_serve_with_options(
        "tests/compat/hono/response-headers-smoke.ts",
        expected(
            "GET",
            200,
            "/headers",
            "Headers",
            "text/plain;charset=UTF-8",
            &[("X-Test", "yes")],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_the_upstream_powered_by_middleware() {
    build_and_serve_with_options(
        "tests/compat/hono/powered-by-smoke.ts",
        expected(
            "GET",
            200,
            "/",
            "Hono!!",
            "text/plain;charset=UTF-8",
            &[("X-Powered-By", "Hono")],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
        ],
        &[],
    );
}

#[test]
fn response_time_clone_preserves_fetch_wpt_string_content_type() {
    build_and_serve_with_options(
        "tests/compat/hono/response-time-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 200,
            path: "/timed",
            body: "timed",
            content_type: Some("text/plain;charset=UTF-8"),
            headers: &[],
            millisecond_headers: &["X-Response-Time"],
            request_headers: &[],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn rejects_an_unauthorized_upstream_basic_auth_request() {
    build_and_serve_with_options(
        "tests/compat/hono/basic-auth-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 401,
            path: "/auth/test",
            body: "Unauthorized",
            content_type: None,
            headers: &[("WWW-Authenticate", "Basic realm=\"Secure Area\"")],
            millisecond_headers: &[],
            request_headers: &[],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
        ],
        &[],
    );
}

#[test]
fn serves_an_authorized_upstream_basic_auth_request() {
    build_and_serve_with_options(
        "tests/compat/hono/basic-auth-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 200,
            path: "/auth/test",
            body: "You are authorized",
            content_type: Some("text/plain;charset=UTF-8"),
            headers: &[],
            millisecond_headers: &[],
            request_headers: &[("Authorization", "Basic aG9ubzphY29vbHByb2plY3Q=")],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
        ],
        &[],
    );
}

#[test]
fn preserves_hono_error_and_middleware_order_for_rejected_basic_auth() {
    build_and_serve_with_options(
        "tests/compat/hono/basic-auth-error-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 500,
            path: "/auth/test",
            body: "Custom Error Message",
            content_type: Some("text/plain; charset=UTF-8"),
            headers: &[("X-Powered-By", "Hono")],
            millisecond_headers: &[],
            request_headers: &[],
            stderr: &["Error"],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
            "--alias",
            "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
            "--api",
            "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_the_upstream_etag_middleware() {
    build_and_serve_with_options(
        "tests/compat/hono/etag-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 200,
            path: "/etag/cached",
            body: "Is this cached?",
            content_type: Some("text/plain;charset=UTF-8"),
            headers: &[("ETag", "\"90ea638841fff3c326fc22cbd156f1146ac0ac02\"")],
            millisecond_headers: &[],
            request_headers: &[],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/etag=vendor/hono/src/middleware/etag/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/etag=tests/compat/hono/etag-api.d.ts",
        ],
        &[],
    );
}

#[test]
fn serves_not_modified_for_a_matching_upstream_etag() {
    build_and_serve_with_options(
        "tests/compat/hono/etag-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 304,
            path: "/etag/cached",
            body: "",
            content_type: None,
            headers: &[("ETag", "\"90ea638841fff3c326fc22cbd156f1146ac0ac02\"")],
            millisecond_headers: &[],
            request_headers: &[(
                "If-None-Match",
                "\"90ea638841fff3c326fc22cbd156f1146ac0ac02\"",
            )],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/etag=vendor/hono/src/middleware/etag/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/etag=tests/compat/hono/etag-api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_upstream_pretty_json_by_query_presence() {
    build_and_serve_with_options(
        "tests/compat/hono/pretty-json-smoke.ts",
        expected(
            "GET",
            200,
            "/api/posts",
            "[{\"id\":1,\"title\":\"Good Morning\"}]",
            "application/json",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/pretty-json=vendor/hono/src/middleware/pretty-json/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/pretty-json=tests/compat/hono/pretty-json-api.d.ts",
        ],
        &[
            (
                200,
                "/api/posts?pretty",
                "[\n  {\n    \"id\": 1,\n    \"title\": \"Good Morning\"\n  }\n]",
                "application/json",
            ),
            (
                200,
                "/api/posts?%70retty",
                "[\n  {\n    \"id\": 1,\n    \"title\": \"Good Morning\"\n  }\n]",
                "application/json",
            ),
        ],
    );
}

#[test]
fn builds_and_serves_upstream_hono_redirect() {
    build_and_serve_with_options(
        "tests/compat/hono/redirect-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 302,
            path: "/redirect",
            body: "",
            content_type: None,
            headers: &[("Location", "/")],
            millisecond_headers: &[],
            request_headers: &[],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_an_upstream_hono_request_header() {
    build_and_serve_with_options(
        "tests/compat/hono/request-header-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 200,
            path: "/user-agent",
            body: "Your UserAgent is tiny-client/1.0",
            content_type: Some("text/plain;charset=UTF-8"),
            headers: &[],
            millisecond_headers: &[],
            request_headers: &[("User-Agent", "tiny-client/1.0")],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_upstream_custom_middleware() {
    build_and_serve_with_options(
        "tests/compat/hono/custom-middleware-smoke.ts",
        expected(
            "GET",
            200,
            "/hello",
            "This is /hello",
            "text/plain;charset=UTF-8",
            &[("X-message", "This is addHeader middleware!")],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_upstream_custom_not_found() {
    build_and_serve_with_options(
        "tests/compat/hono/not-found-smoke.ts",
        expected(
            "GET",
            404,
            "/missing",
            "Custom 404 Not Found",
            "text/plain; charset=UTF-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_upstream_custom_error_handler() {
    build_and_serve_with_options(
        "tests/compat/hono/error-handler-smoke.ts",
        ExpectedResponse {
            method: "GET",
            status: 500,
            path: "/error",
            body: "Custom Error Message",
            content_type: Some("text/plain; charset=UTF-8"),
            headers: &[],
            millisecond_headers: &[],
            request_headers: &[],
            stderr: &["Error: Error has occurred"],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[],
    );
}

#[test]
fn builds_and_serves_the_complete_pinned_hono_basic_source() {
    build_and_serve_with_options(
        "vendor/hono-examples/basic/src/index.ts",
        ExpectedResponse {
            method: "GET",
            status: 200,
            path: "/",
            body: "Hono!!",
            content_type: Some("text/plain;charset=UTF-8"),
            headers: &[("X-Powered-By", "Hono")],
            millisecond_headers: &["X-Response-Time"],
            request_headers: &[],
            stderr: &[],
        },
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
            "--alias",
            "hono/etag=vendor/hono/src/middleware/etag/index.ts",
            "--alias",
            "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
            "--alias",
            "hono/pretty-json=vendor/hono/src/middleware/pretty-json/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
            "--api",
            "hono/etag=tests/compat/hono/etag-api.d.ts",
            "--api",
            "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
            "--api",
            "hono/pretty-json=tests/compat/hono/pretty-json-api.d.ts",
        ],
        &[(200, "/hello", "This is /hello", "text/plain;charset=UTF-8")],
    );
}

#[test]
fn builds_and_serves_the_exact_pinned_hono_jsx_ssr_source() {
    let root = include_str!("../../tests/compat/hono/fixtures/jsx-ssr-root.html")
        .strip_suffix('\n')
        .expect("root fixture ends with a newline");
    let post = include_str!("../../tests/compat/hono/fixtures/jsx-ssr-post-1.html")
        .strip_suffix('\n')
        .expect("post fixture ends with a newline");
    build_and_serve_with_options(
        "vendor/hono-examples/jsx-ssr/src/index.tsx",
        expected("GET", 200, "/", root, "text/html; charset=utf-8", &[]),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/html=vendor/hono/src/helper/html/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/html=tests/compat/hono/html-api.d.ts",
        ],
        &[
            (200, "/post/1", post, "text/html; charset=utf-8"),
            (
                404,
                "/post/99",
                "404 Not Found",
                "text/plain; charset=UTF-8",
            ),
            (
                404,
                "/post/nope",
                "404 Not Found",
                "text/plain; charset=UTF-8",
            ),
        ],
    );
}

#[test]
fn builds_and_serves_request_time_hono_jsx_with_exact_escaping() {
    build_and_serve_with_options(
        "tests/compat/hono/dynamic-jsx-smoke.tsx",
        expected(
            "GET",
            200,
            "/dynamic",
            "<main data-name=\"World\">Hello, <strong>World</strong>!</main>",
            "text/html; charset=utf-8",
            &[],
        ),
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[
            (
                200,
                "/dynamic?name=%3C%3E%26%22%27+Ada",
                "<main data-name=\"&lt;&gt;&amp;&quot;&#39; Ada\">Hello, <strong>&lt;&gt;&amp;&quot;&#39; Ada</strong>!</main>",
                "text/html; charset=utf-8",
            ),
            (
                200,
                "/dynamic?name=",
                "<main data-name=\"\">Hello, <strong></strong>!</main>",
                "text/html; charset=utf-8",
            ),
        ],
    );
}

#[test]
fn builds_and_serves_hono_through_a_separate_application_worker_pool() {
    build_and_serve_with_options(
        "tests/compat/workers/hono-worker-smoke.ts",
        expected(
            "GET",
            200,
            "/worker?input=hello+worker",
            "HELLO WORKER",
            "text/plain;charset=UTF-8",
            &[],
        ),
        &[
            "--workers",
            "2",
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
        &[
            (200, "/worker", "HELLO WORKER", "text/plain;charset=UTF-8"),
            (
                200,
                "/worker?input=disposable%20worker",
                "DISPOSABLE WORKER",
                "text/plain;charset=UTF-8",
            ),
        ],
    );
}

#[test]
fn builds_and_serves_upstream_hono_stream_text_without_body_buffering() {
    let _build_guard = NATIVE_BUILD.lock().expect("lock native E2E build");
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    let binary = directory.join("stream-server");
    let port = available_port();

    let build = Command::new(env!("CARGO_BIN_EXE_tinytsx"))
        .current_dir(&root)
        .args([
            "build",
            "tests/compat/hono/stream-text-smoke.ts",
            "--port",
            &port.to_string(),
            "--request-memory",
            "1",
            "--output",
        ])
        .arg(&binary)
        .args([
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--alias",
            "hono/streaming=vendor/hono/src/helper/streaming/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
            "--api",
            "hono/streaming=tests/compat/hono/streaming-api.d.ts",
        ])
        .output()
        .expect("build streaming server");
    assert!(
        build.status.success(),
        "build failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr),
    );
    let report: serde_json::Value = serde_json::from_slice(
        &fs::read(with_suffix(&binary, ".build.json")).expect("read stream build report"),
    )
    .expect("parse stream build report");
    assert!(
        report["runtimeFeatures"]
            .as_array()
            .expect("runtime feature list")
            .iter()
            .any(|feature| feature == "bounded-response-streaming")
    );

    let child = Command::new(&binary)
        .spawn()
        .expect("start streaming server");
    let _server = Server(child);
    let mut stream = connect_with_retry(port);
    stream
        .write_all(b"GET /stream HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send stream request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read stream response");

    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(response.contains("Content-Type: text/plain; charset=UTF-8\r\n"));
    assert!(response.contains("X-Content-Type-Options: nosniff\r\n"));
    assert!(response.contains("Transfer-Encoding: chunked\r\n"));
    assert!(!response.contains("Content-Length:"));
    assert!(
        response.ends_with("6\r\nfirst\n\r\n7\r\nsecond\n\r\n6\r\nthird\n\r\n0\r\n\r\n"),
        "{response}"
    );

    fs::remove_dir_all(directory).expect("remove test artifacts");
}

fn build_and_serve(entry: &str, expected_body: &str, expected_content_type: &str) {
    build_and_serve_with_options(
        entry,
        expected("GET", 200, "/", expected_body, expected_content_type, &[]),
        &[],
        &[],
    );
}

fn expected<'a>(
    method: &'a str,
    status: u16,
    path: &'a str,
    body: &'a str,
    content_type: &'a str,
    headers: &'a [(&'a str, &'a str)],
) -> ExpectedResponse<'a> {
    ExpectedResponse {
        method,
        status,
        path,
        body,
        content_type: Some(content_type),
        headers,
        millisecond_headers: &[],
        request_headers: &[],
        stderr: &[],
    }
}

fn build_and_serve_with_options(
    entry: &str,
    expected: ExpectedResponse<'_>,
    frontend_options: &[&str],
    additional_routes: &[(u16, &str, &str, &str)],
) {
    let _build_guard = NATIVE_BUILD.lock().expect("lock native E2E build");
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    let binary = directory.join("server");
    let port = available_port();

    let mut build_command = Command::new(env!("CARGO_BIN_EXE_tinytsx"));
    build_command
        .current_dir(&root)
        .args(["build", entry, "--port"])
        .arg(port.to_string())
        .arg("--output")
        .arg(&binary)
        .args(frontend_options);
    let build = build_command.output().expect("start TinyTSX compiler");
    assert!(
        build.status.success(),
        "build failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr),
    );

    let bytes = fs::read(&binary).expect("read native executable");
    assert_eq!(&bytes[..4], &[0xcf, 0xfa, 0xed, 0xfe], "Mach-O 64 magic");
    assert!(with_suffix(&binary, ".build.json").is_file());

    let mut server_command = Command::new(&binary);
    if !expected.stderr.is_empty() {
        server_command.stderr(Stdio::piped());
    }
    let child = server_command.spawn().expect("start generated server");
    let mut server = Server(child);
    let mut stream = connect_with_retry(port);
    write!(
        stream,
        "{} {} HTTP/1.1\r\nHost: localhost\r\n",
        expected.method, expected.path,
    )
    .expect("send request");
    for (name, value) in expected.request_headers {
        write!(stream, "{name}: {value}\r\n").expect("send request header");
    }
    write!(stream, "Connection: close\r\n\r\n").expect("finish request");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");

    assert!(
        response.starts_with(&format!("HTTP/1.1 {} ", expected.status)),
        "{response}"
    );
    if let Some(content_type) = expected.content_type {
        assert!(
            response.contains(&format!("Content-Type: {content_type}\r\n")),
            "{response}"
        );
    } else {
        assert!(!response.contains("\r\nContent-Type:"), "{response}");
    }
    assert!(
        response.contains(&format!("Content-Length: {}\r\n", expected.body.len())),
        "{response}"
    );
    assert!(response.ends_with(expected.body));
    for (name, value) in expected.headers {
        assert!(
            response.contains(&format!("{name}: {value}\r\n")),
            "{response}"
        );
    }
    for name in expected.millisecond_headers {
        let prefix = format!("{name}: ");
        let value = response
            .lines()
            .find_map(|line| line.strip_prefix(&prefix))
            .unwrap_or_else(|| panic!("missing {name} header in {response}"));
        let milliseconds = value
            .strip_suffix("ms")
            .unwrap_or_else(|| panic!("{name} is not measured in milliseconds: {value}"));
        assert!(
            !milliseconds.is_empty() && milliseconds.bytes().all(|byte| byte.is_ascii_digit()),
            "{name} is not a numeric millisecond duration: {value}"
        );
    }
    if !expected.stderr.is_empty() {
        let stderr = server.0.stderr.take().expect("captured server stderr");
        let mut stderr = BufReader::new(stderr);
        for expected_line in expected.stderr {
            let mut line = String::new();
            stderr.read_line(&mut line).expect("read server stderr");
            assert_eq!(line.trim_end(), *expected_line);
        }
    }

    for (status, path, body, content_type) in additional_routes {
        let mut route = TcpStream::connect(("127.0.0.1", port)).expect("connect for route");
        write!(
            route,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        )
        .expect("send route request");
        let mut route_response = String::new();
        route
            .read_to_string(&mut route_response)
            .expect("read route response");
        assert!(
            route_response.starts_with(&format!("HTTP/1.1 {status} ")),
            "{route_response}"
        );
        assert!(
            route_response.contains(&format!("Content-Type: {content_type}\r\n")),
            "{route_response}"
        );
        assert!(route_response.ends_with(body), "{route_response}");
    }

    if expected.path != "/missing" {
        let mut missing =
            TcpStream::connect(("127.0.0.1", port)).expect("connect for missing route");
        missing
            .write_all(b"GET /missing HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .expect("send missing-route request");
        let mut missing_response = String::new();
        missing
            .read_to_string(&mut missing_response)
            .expect("read missing-route response");
        assert!(
            missing_response.starts_with("HTTP/1.1 404 Not Found\r\n"),
            "{missing_response}"
        );
        assert!(
            missing_response.ends_with("not found")
                || missing_response.ends_with("404 Not Found")
                || missing_response.ends_with("Custom 404 Not Found"),
            "{missing_response}"
        );
    }

    fs::remove_dir_all(directory).expect("remove test artifacts");
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("compiler is in repository")
        .to_owned()
}

fn build_frontend(root: &Path) {
    let status = Command::new("npm")
        .current_dir(root)
        .args(["run", "build", "--prefix", "frontend"])
        .status()
        .expect("start TypeScript build");
    assert!(status.success(), "TypeScript frontend build failed");
}

fn temporary_directory() -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("valid clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("tinytsx-e2e-{timestamp}"));
    fs::create_dir_all(&path).expect("create test directory");
    path
}

fn available_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("bind temporary port")
        .local_addr()
        .expect("read temporary address")
        .port()
}

fn connect_with_retry(port: u16) -> TcpStream {
    for _ in 0..100 {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(stream) => return stream,
            Err(_) => thread::sleep(Duration::from_millis(25)),
        }
    }
    panic!("generated server did not listen on port {port}");
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

fn occurrences(value: &str, pattern: &str) -> usize {
    value.match_indices(pattern).count()
}
