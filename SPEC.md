# TinyTSX Prototype Specification

TinyTSX compiles a deliberately restricted TypeScript/TSX source language into
native macOS arm64 server executables. User code is lowered ahead of time to a
typed HIR and then to readable Apple arm64 assembly. The produced executable
contains no JavaScript engine, interpreter, JIT, WebAssembly runtime, or runtime
TypeScript parser.

## First vertical slice

The initial implementation accepts one `.tsx` entry module containing:

- one or more zero-argument function components returning static TSX;
- a named `GET(request: Request): Response` export;
- `Response.html(<Component />)` as the GET response;
- intrinsic elements from the initial language allowlist;
- static string attributes and static text.

It lowers the source to JSON HIR, coalesces each component's static markup into
one HTML fragment, emits macOS arm64 assembly, and links that object into the
bootstrap Rust HTTP runtime.

The bootstrap runtime accepts HTTP/1.1 GET requests on a configured loopback
port, processes one connection at a time, sends `Connection: close`, and emits
`Content-Length` and `Content-Type: text/html; charset=utf-8` headers.

## Architecture

```text
entry.tsx
  -> official TypeScript Compiler API (build-time Node.js process)
  -> validated, source-located JSON HIR
  -> Rust compiler driver
  -> deterministic Apple arm64 assembly
  -> clang object
  -> Rust bootstrap runtime + native generated object
  -> Mach-O executable
```

The generated handler owns application rendering. The runtime owns sockets,
HTTP parsing, response headers, and process lifecycle. Their only shared seam is
the C-compatible ABI in `ABI.md`.

## Target and tools

- host and target: Apple Silicon macOS (`aarch64-apple-darwin`);
- compiler driver and runtime: Rust;
- source frontend: pinned TypeScript Compiler API, executed only at build time;
- assembler: Xcode Command Line Tools `clang`;
- linker: the linker selected by `rustc`, with the generated object passed as a
  native link input.

Other operating systems and architectures are intentionally rejected for the
first vertical slice.

## Request and concurrency model

The bootstrap slice uses one native thread and one request at a time. The ABI is
kept independent of this choice so a fixed worker pool can replace it later.
Each eventual worker owns one reusable request arena. A request resets its arena
before execution, uses only bounded request-scoped storage, and resets it again
after completion. Request OOM maps to HTTP 503 and must not terminate the process.

The arena and worker pool are milestones after dynamic output; they are not
silently approximated in the static slice.

## Determinism and diagnostics

For the same normalized HIR and compiler version, generated assembly is byte-for-
byte deterministic. Unsupported constructs are compile errors with source file,
line, and column. TinyTSX never falls back to executing JavaScript.

## Non-goals

TinyTSX is not a complete TypeScript or JavaScript implementation, Node/Bun
replacement, React runtime, virtual DOM, package executor, or general-purpose
native language. The prototype does not initially support dynamic imports,
classes, async functions, exceptions, mutation of object shapes, runtime JSX
objects, npm application dependencies, or mutable global application state.

## Verification gates

Every language feature requires positive and negative frontend tests. Every
backend feature requires assembly snapshots or structural assertions. A native
build is complete only when an automated test starts the produced executable,
sends a real TCP HTTP request, verifies the response, and stops the process.

