#![cfg(all(target_os = "macos", target_arch = "aarch64"))]

use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command},
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
    content_type: &'a str,
    headers: &'a [(&'a str, &'a str)],
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
        &[("/hello", "This is /hello", "text/plain;charset=UTF-8")],
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
        content_type,
        headers,
    }
}

fn build_and_serve_with_options(
    entry: &str,
    expected: ExpectedResponse<'_>,
    frontend_options: &[&str],
    additional_routes: &[(&str, &str, &str)],
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

    let child = Command::new(&binary)
        .spawn()
        .expect("start generated server");
    let _server = Server(child);
    let mut stream = connect_with_retry(port);
    write!(
        stream,
        "{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        expected.method, expected.path,
    )
    .expect("send request");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");

    assert!(
        response.starts_with(&format!("HTTP/1.1 {} ", expected.status)),
        "{response}"
    );
    assert!(
        response.contains(&format!("Content-Type: {}\r\n", expected.content_type)),
        "{response}"
    );
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

    for (path, body, content_type) in additional_routes {
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
            route_response.starts_with("HTTP/1.1 200 OK\r\n"),
            "{route_response}"
        );
        assert!(
            route_response.contains(&format!("Content-Type: {content_type}\r\n")),
            "{route_response}"
        );
        assert!(route_response.ends_with(body), "{route_response}");
    }

    let mut missing = TcpStream::connect(("127.0.0.1", port)).expect("connect for missing route");
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
        missing_response.ends_with("not found"),
        "{missing_response}"
    );

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
