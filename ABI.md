# TinyTSX Runtime ABI

This document defines the C-compatible boundary between generated application
code and the bootstrap runtime. Rust-specific layouts never cross this boundary.

## Version 2 structures

ABI v2 is paired with HIR v2. It adds response metadata to the writer so
generated code can select HTTP status and content type before writing the body.

```rust
#[repr(C)]
pub struct TinyStringView {
    pub ptr: *const u8,
    pub len: usize,
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
pub struct TinyHeader {
    pub name: TinyStringView,
    pub value: TinyStringView,
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
    pub headers: [TinyHeader; 8],
}
```

`TinyArena` is opaque to generated code. String views contain UTF-8 bytes and
are not NUL-terminated. A nullable view uses `{ ptr: null, len: 0 }` for null.

## Generated entrypoint

```rust
extern "C" {
    fn tinytsx_handle_get(
        request: *const TinyRequest,
        writer: *mut TinyResponseWriter,
    ) -> u32;
}
```

The symbol is globally visible in generated assembly and follows the Apple
arm64 C ABI. Arguments arrive in `x0` and `x1`; application status returns in
`w0`/`x0`.

Generated code begins a response and then appends body bytes with these helpers:

```rust
extern "C" fn tinytsx_response_begin(
    writer: *mut TinyResponseWriter,
    http_status: u16,
    content_type: u16,
) -> u32;

extern "C" fn tinytsx_html_write_static(
    writer: *mut TinyResponseWriter,
    bytes: *const u8,
    len: usize,
) -> u32;

extern "C" fn tinytsx_request_path_matches(
    request: *const TinyRequest,
    pattern: *const u8,
    pattern_len: usize,
) -> u32;

extern "C" fn tinytsx_request_method_equals(
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
) -> u32;

extern "C" fn tinytsx_request_query_has(
    request: *const TinyRequest,
    expected: *const u8,
    expected_len: usize,
) -> u32;

extern "C" fn tinytsx_html_write_path_segment(
    writer: *mut TinyResponseWriter,
    request: *const TinyRequest,
    segment: usize,
) -> u32;

extern "C" fn tinytsx_html_write_request_header(
    writer: *mut TinyResponseWriter,
    request: *const TinyRequest,
    name: *const u8,
    name_len: usize,
) -> u32;

extern "C" fn tinytsx_response_header_static(
    writer: *mut TinyResponseWriter,
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
) -> u32;
```

`tinytsx_html_write_static` retains its v1 symbol name, but the operation is a
content-neutral byte append. It appends all bytes or appends none. Later escaped
writer helpers use the same status convention.

`tinytsx_request_path_matches` currently accepts literal segments, non-empty
named segments written as `:name`, and a terminal `*`. The terminal wildcard
matches its base path, a trailing slash, or deeper segments. Generated code
validates the pattern before linking. `tinytsx_html_write_path_segment` writes
the selected zero-based path segment and applies Hono-compatible percent
decoding for valid UTF-8 groups; malformed groups remain encoded. Both
operations use borrowed request views and the bounded response writer without
allocating a dynamic route map.

`tinytsx_request_method_equals` compares the borrowed method view. Generated
dispatch currently emits GET and POST handlers; the bootstrap returns 405 for
other methods before entering application code.

`tinytsx_request_query_has` matches an exact raw query name in bare, empty, or
valued form. `tinytsx_html_write_request_header` searches the bounded borrowed
request-header table case-insensitively and writes either the value or the
JavaScript template fallback `undefined`.

`tinytsx_response_header_static` validates HTTP token names and values, replaces
existing names case-insensitively, and stores at most eight custom headers.

## Content types

| Value | Response header |
| ---: | --- |
| 0 | omitted |
| 1 | `text/html; charset=utf-8` |
| 2 | `text/plain; charset=UTF-8` |
| 3 | `application/json` |
| 4 | `text/plain;charset=UTF-8` |

The text and JSON spellings match the pinned Hono `Context.text()` and
`Context.json()` response contracts. Unknown content-type values are rejected by
`tinytsx_response_begin`.

## Application status values

| Value | Name | HTTP mapping on failure |
| ---: | --- | ---: |
| 0 | `OK` | generated `http_status` |
| 1 | `REQUEST_OOM` | 503 |
| 2 | `BAD_REQUEST` | 400 |
| 3 | `RENDER_ERROR` | 500 |
| 4 | `INTERNAL_ERROR` | 500 |
| 5 | `NOT_FOUND` | 404 |

Unknown nonzero values map to 500. On `OK`, the runtime sends the HTTP status,
content type, and body selected through the response writer.

## Ownership and lifetime

Static string data lives for the process lifetime in Mach-O read-only data.
Request input views and arena-backed values live only until the generated handler
returns. Generated code must not retain pointers globally. The runtime owns and
resets the writer and arena between requests.

## Compatibility policy

The ABI is versioned by this document and by HIR `version`. Additive helper
symbols are allowed. A structure layout or entrypoint change requires a new ABI
version and an explicit compiler/runtime compatibility check.
