# Implementation decisions

## D-001: Build-time frontend process

The Rust CLI invokes the repository's compiled Node.js frontend for `check` and
`build`. Node.js and TypeScript are build dependencies only and are absent from
the application executable. JSON on stdout is the frontend/compiler boundary;
diagnostics go to stderr.

## D-002: Link generated objects through rustc

The compiler invokes `clang` to assemble textual Apple arm64 assembly, then asks
Cargo/rustc to link the generated object into the bootstrap runtime. This keeps
Rust standard-library link details with Rust while preserving the required
direct TSX-to-assembly application path.

## D-003: Static-first writer ABI

Even the static vertical slice renders through `tinytsx_handle_get` and the
writer ABI. It does not return a Rust string or embed the page in runtime source.
Dynamic escaping and arenas can therefore extend the implementation without
changing generated application semantics.

