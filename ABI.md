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
    pub dynamic_header_cursor: usize,
    pub dynamic_header_bytes: [u8; 256],
    pub streaming: u32,
    pub stream_chunk_count: usize,
    pub stream_chunks: [TinyStringView; 16],
    pub stream_chunk_start: *mut u8,
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

extern "C" fn tinytsx_response_stream_begin(
    writer: *mut TinyResponseWriter,
) -> u32;

extern "C" fn tinytsx_response_stream_chunk_static(
    writer: *mut TinyResponseWriter,
    bytes: *const u8,
    len: usize,
) -> u32;

extern "C" fn tinytsx_response_stream_chunk_begin(
    writer: *mut TinyResponseWriter,
) -> u32;

extern "C" fn tinytsx_response_stream_chunk_end(
    writer: *mut TinyResponseWriter,
) -> u32;

extern "C" fn tinytsx_console_error_static(
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

extern "C" fn tinytsx_request_basic_auth_equals(
    request: *const TinyRequest,
    username: *const u8,
    username_len: usize,
    password: *const u8,
    password_len: usize,
) -> u32;

extern "C" fn tinytsx_request_if_none_match(
    request: *const TinyRequest,
    entity_tag: *const u8,
    entity_tag_len: usize,
) -> u32;

extern "C" fn tinytsx_response_header_static(
    writer: *mut TinyResponseWriter,
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
) -> u32;

extern "C" fn tinytsx_date_now_millis() -> u64;

extern "C" fn tinytsx_response_header_elapsed_millis(
    writer: *mut TinyResponseWriter,
    name: *const u8,
    name_len: usize,
    started_at: u64,
    ended_at: u64,
    suffix: *const u8,
    suffix_len: usize,
) -> u32;
```

`tinytsx_html_write_static` retains its v1 symbol name, but the operation is a
content-neutral byte append. It appends all bytes or appends none. Later escaped
writer helpers use the same status convention.

Streaming responses retain at most 16 ordered chunk views. Static chunks point
directly at immutable generated data and do not consume the request arena.
Dynamic chunks bracket normal bounded-writer calls with `chunk_begin` and
`chunk_end`, so their views borrow the reusable arena. The bootstrap emits
HTTP/1.1 chunk framing, filters application framing headers, flushes each chunk,
and writes the terminal zero chunk. Exceeding the chunk bound or misnesting the
brackets returns `RENDER_ERROR`.

`tinytsx_console_error_static` writes one immutable UTF-8 line to stderr. It is
currently used for closed `console.error` effects retained by a staged Hono
error handler.

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

`tinytsx_request_basic_auth_equals` finds `Authorization` case-insensitively,
parses Hono's supported case-insensitive Basic scheme and spacing, decodes
standard Base64 without allocation, and compares the decoded username/password
bytes against generated static credentials. It returns a boolean in `w0`;
malformed, missing, and mismatched credentials return zero.

`tinytsx_request_if_none_match` compares a borrowed `If-None-Match` header with
a generated static entity tag. It implements Hono's weak comparison, wildcard,
and comma-separated candidate behavior for the compiled GET response.

`tinytsx_response_header_static` validates HTTP token names and values, replaces
existing names case-insensitively, and stores at most eight custom headers.
`tinytsx_date_now_millis` supplies a wall-clock millisecond reading for the
current AOT timing slice. Generated code brackets the native handler body and
passes both readings to `tinytsx_response_header_elapsed_millis`. That helper
formats the saturating difference plus a static suffix into the writer-owned
256-byte store, then uses the same validation, replacement, and eight-header
bound as static headers.

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
resets the writer, its dynamic header bytes, and the arena between requests.

## Compatibility policy

The ABI is versioned by this document and by HIR `version`. Additive helper
symbols are allowed. A structure layout or entrypoint change requires a new ABI
version and an explicit compiler/runtime compatibility check.
