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
        "Hono!!",
        "text/plain; charset=UTF-8",
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
    );
}

fn build_and_serve(entry: &str, expected_body: &str, expected_content_type: &str) {
    build_and_serve_with_options(entry, expected_body, expected_content_type, &[]);
}

fn build_and_serve_with_options(
    entry: &str,
    expected_body: &str,
    expected_content_type: &str,
    frontend_options: &[&str],
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
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("send request");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");

    assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
    assert!(
        response.contains(&format!("Content-Type: {expected_content_type}\r\n")),
        "{response}"
    );
    assert!(
        response.contains(&format!("Content-Length: {}\r\n", expected_body.len())),
        "{response}"
    );
    assert!(response.ends_with(expected_body));

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
