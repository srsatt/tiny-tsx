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
    pub arena: *mut TinyArena,
}

#[repr(C)]
pub struct TinyResponseWriter {
    pub start: *mut u8,
    pub cursor: *mut u8,
    pub end: *mut u8,
    pub status: u32,
    pub http_status: u16,
    pub content_type: u16,
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
```

`tinytsx_html_write_static` retains its v1 symbol name, but the operation is a
content-neutral byte append. It appends all bytes or appends none. Later escaped
writer helpers use the same status convention.

## Content types

| Value | Response header |
| ---: | --- |
| 1 | `text/html; charset=utf-8` |
| 2 | `text/plain; charset=UTF-8` |
| 3 | `application/json; charset=UTF-8` |

The text spelling matches Hono's pinned `Context.text()` response contract.
Unknown content-type values are rejected by `tinytsx_response_begin`.

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
