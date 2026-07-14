# TinyTSX Runtime ABI

This document defines the C-compatible boundary between generated application
code and the bootstrap runtime. Rust-specific layouts never cross this boundary.

## Version 1 structures

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
pub struct TinyHtmlWriter {
    pub start: *mut u8,
    pub cursor: *mut u8,
    pub end: *mut u8,
    pub status: u32,
}
```

`TinyArena` is opaque to generated code. String views contain UTF-8 bytes and
are not NUL-terminated. A nullable view uses `{ ptr: null, len: 0 }` for null.

The first static slice does not dereference the request or writer structures;
it proves the call boundary with the same entrypoint used by later slices.

## Generated entrypoint

```rust
extern "C" {
    fn tinytsx_handle_get(
        request: *const TinyRequest,
        writer: *mut TinyHtmlWriter,
    ) -> u32;
}
```

The symbol is globally visible in generated assembly and follows the Apple
arm64 C ABI. Arguments arrive in `x0` and `x1`; status returns in `w0`/`x0`.

For the first static slice, generated code calls this runtime helper:

```rust
extern "C" fn tinytsx_html_write_static(
    writer: *mut TinyHtmlWriter,
    bytes: *const u8,
    len: usize,
) -> u32;
```

The helper appends all bytes or appends none. Later escaped writer helpers use
the same status convention.

## Status values

| Value | Name | HTTP mapping |
| ---: | --- | ---: |
| 0 | `OK` | 200 |
| 1 | `REQUEST_OOM` | 503 |
| 2 | `BAD_REQUEST` | 400 |
| 3 | `RENDER_ERROR` | 500 |
| 4 | `INTERNAL_ERROR` | 500 |
| 5 | `NOT_FOUND` | 404 |

Unknown nonzero values map to 500.

## Ownership and lifetime

Static string data lives for the process lifetime in Mach-O read-only data.
Request input views and arena-backed values live only until the generated handler
returns. Generated code must not retain pointers globally. The runtime owns and
resets the writer and arena between requests.

## Compatibility policy

The ABI is versioned by this document and by HIR `version`. Additive helper
symbols are allowed. A structure layout or entrypoint change requires a new ABI
version and an explicit compiler/runtime compatibility check.

