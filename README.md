# TinyTSX Prototype — Native TSX Server Compiler

You are a senior compiler engineer, runtime engineer, and performance-oriented systems programmer.

Your task is to design and incrementally implement a prototype called **TinyTSX**.

TinyTSX is an ahead-of-time compiler for a deliberately restricted subset of TypeScript and TSX. It compiles backend applications into small native executables.

The first development platform and target is:

* macOS;
* Apple Silicon;
* arm64 / AArch64;
* Mach-O executables;
* the macOS arm64 calling convention;
* the system assembler and linker available through Xcode Command Line Tools.

That Apple target remains the primary development platform. The compiler now
also emits AArch64 ELF and supports native builds on Linux arm64.

The intended programming model is:

```tsx
interface PageProps {
  name: string;
}

function Page(props: PageProps): JSX.Element {
  return (
    <html>
      <head>
        <title>TinyTSX</title>
      </head>
      <body>
        <h1>Hello, {props.name}!</h1>
      </body>
    </html>
  );
}

export function GET(request: Request): Response {
  const name = request.query("name") ?? "World";

  return Response.html(<Page name={name} />);
}
```

The compiler produces a native executable for the selected host target:

```bash
tinytsx build server.tsx \
  --target aarch64-apple-darwin \
  --workers 8 \
  --request-memory 262144 \
  --release \
  --output dist/server
```

The resulting executable must:

* contain no Node.js;
* contain no Bun;
* contain no V8;
* contain no JavaScriptCore;
* contain no QuickJS;
* contain no JavaScript interpreter;
* contain no JIT compiler;
* contain no WebAssembly runtime;
* contain no runtime TypeScript or JavaScript parser;
* execute statically compiled native application code;
* render TSX directly into HTML;
* use bounded request-scoped memory;
* isolate request out-of-memory failures;
* start quickly;
* remain small.

The long-term target is a server executable below 1 MiB for simple applications.

The first working prototype may be larger while using a bootstrap runtime. Binary size optimization must begin only after the end-to-end compiler pipeline works.

The central product idea is:

> TypeScript syntax.
> First-class TSX.
> Native machine code.
> Bounded request memory.
> No JavaScript engine.

## Current implementation: native Hono basic and JSX SSR

The repository compiles the complete pinned upstream Hono basic application to
a native Apple-arm64 Mach-O server. Its 34-module runtime graph lowers to 16
concrete routes plus installed GET/POST fallbacks without Node.js, Bun, or a
JavaScript engine. The exact pinned JSX SSR example also compiles through 31
Hono runtime modules with typed props, closed arrays/records, escaping, Unicode,
finite route specialization, and native 404s. The original static-page vertical
slice remains available. A separate request-time JSX route also lowers decoded
query data through nested component props and emits Bun-equivalent escaping
from the bounded request arena. The pinned upstream `streamText()` path also
emits finite native HTTP/1.1 chunks without collecting its body in that arena.

Install the pinned build-time frontend and compile the Rust driver:

```bash
npm install --prefix frontend
npm run build --prefix frontend
cargo build -p tinytsx
```

Inspect the source, HIR, or generated AArch64 assembly:

```bash
./target/debug/tinytsx check examples/static-page/server.tsx
./target/debug/tinytsx check examples/static-page/server.tsx --emit-hir
./target/debug/tinytsx check examples/static-page/server.tsx --emit-asm
./target/debug/tinytsx check examples/static-page/server.tsx \
  --target aarch64-unknown-linux-gnu --emit-asm
```

Build and run the native bootstrap server:

```bash
./target/debug/tinytsx build examples/static-page/server.tsx \
  --port 3000 \
  --workers 1 \
  --request-memory 262144 \
  --runtime bootstrap \
  --release \
  --emit-hir \
  --emit-asm \
  --output dist/static-server

./dist/static-server
```

In another terminal:

```bash
curl -i http://127.0.0.1:3000/
```

The response body is:

```html
<html><body><h1>Hello from TinyTSX</h1></body></html>
```

`tinytsx run examples/static-page/server.tsx --port 3000` combines the build and
run steps for development. `--emit-hir` and `--emit-asm` on `build` preserve
`<output>.hir.json` and `<output>.s`; every build also writes
`<output>.build.json`.

Build and run the complete pinned Hono basic example:

```bash
npm run build:hono-basic-example
./dist/hono-basic-example
curl -i http://127.0.0.1:3000/
```

The root response is the upstream contract: status 200, body `Hono!!`,
`Content-Type: text/plain;charset=UTF-8`, `X-Powered-By: Hono`, and a numeric
`X-Response-Time` header. The native E2E also checks `/hello` and the installed
not-found handler from that same complete executable.

Build and run the exact pinned Hono JSX SSR example:

```bash
npm run build:hono-jsx-ssr-example
./dist/hono-jsx-ssr-example
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/post/1
```

The Bun reference and native E2E require byte-identical root and post HTML and
the same `404 Not Found` behavior for `/post/99` and `/post/nope`.

Run all implemented checks, including the native HTTP end-to-end test:

```bash
npm test
cargo clippy --workspace --all-targets -- -D warnings
```

The compiler also accepts relative ESM component modules. The compatibility
program continuously audits the pinned Hono source graph and validates
allowlisted Test262, Hono, Web Platform Test, and native host API behavior:

```bash
npm run audit:hono
npm run audit:hono-basic
npm run audit:hono-jsx-ssr
npm run test:hono-intake
npm run test:hono-jsx-reference
npm run test:test262-intake
npm run test:test262-native
npm run test:wpt-intake
npm run test:wpt-native
npm run test:native-api
npm run test:wasm
```

Test262 evidence is recorded per case. Ten complete cases currently execute as
standalone native Mach-O assertion programs: `typeof undefined`, `typeof
bigint`, the bounded `for`/throw/catch counter, and the bounded dense-array
`unshift`, array-spread/apply, numeric-subtraction, and record-membership
programs, plus the direct string throw/catch, `Date.now()` type, and closed class
constructor cases. Four other allowlisted cases remain syntax-only and are not
reported as semantic conformance. Three complete selected URLSearchParams WPT
files execute natively. See `doc/COMPATIBILITY.md` for pins, test layers, and
the deliberately narrower boundaries of each result.

`npm run test:wasm` exercises a separate optional no-WASI interpreter profile.
It is not a compiler target and is not linked into normal bootstrap servers;
the native TypeScript/TSX backend still emits Apple-arm64 assembly directly.
See `doc/WASM.md` for its limits and promotion gates.

An exploratory static performance comparison against an equivalent idiomatic Bun
server is available separately:

```bash
npm run benchmark:static
npm run benchmark:hono
npm run benchmark:hono-jsx-ssr
```

The harness verifies equivalent status, content type, content length, and body,
then records repeated startup-to-first-response, RSS, throughput, and latency
samples through `oha`. See `benchmarks/README.md` for methodology and limitations.

The present bootstrap accepts GET and POST requests over bounded HTTP/1.1
keep-alive on a configurable fixed native worker pool. One acceptor submits
owned connections to a bounded queue with 64 waiting slots per worker;
saturation returns HTTP 503. A live connection stays on one executor, closes
after 100 requests or five idle seconds, and reuses that worker's request arena
for every response.

---

# 1. Core product definition

TinyTSX is not intended to be:

* a full TypeScript compiler;
* a JavaScript implementation;
* a Node.js replacement;
* a Bun-compatible runtime;
* a React runtime;
* a Next.js runtime;
* a general-purpose native language;
* a universal npm package executor.

TinyTSX is a small native web application platform that uses TypeScript and TSX as its source language.

The source language must be treated as its own statically compiled language with TypeScript-compatible syntax and tooling.

The project should preserve:

* familiar TypeScript syntax;
* `.ts` and `.tsx` source files;
* interfaces;
* type aliases;
* statically typed function components;
* editor autocomplete;
* TypeScript diagnostics;
* JSX prop checking;
* local ESM modules;
* a useful subset of pure TypeScript libraries.

The project must deliberately reject dynamic JavaScript semantics that prevent efficient native compilation.

---

# 2. Critical implementation constraints

## 2.1 No LLVM, Wasm, or virtual-machine target

The TinyTSX application compiler must not generate:

* LLVM IR;
* WebAssembly;
* Cranelift IR;
* JavaScript;
* JavaScript bytecode;
* JVM bytecode;
* a custom interpreted bytecode.

The first application backend must generate readable arm64 assembly for macOS.

The pipeline should be:

```text
TypeScript / TSX
        ↓
TypeScript frontend
        ↓
TinyTSX typed HIR
        ↓
subset validation and lowering
        ↓
macOS arm64 assembly
        ↓
Mach-O object file
        ↓
link with the TinyTSX runtime
        ↓
native Mach-O executable
```

It is acceptable to invoke the macOS compiler toolchain for assembling and linking:

```bash
clang -c generated.s -o generated.o
clang generated.o runtime.a -o server
```

Do not write a Mach-O object writer in the first implementation.

Do not write a custom linker.

Do not emit raw machine code until the textual assembly backend works reliably.

The TinyTSX compiler and runtime may themselves be written in Rust and built with `rustc`. The “no LLVM” constraint applies to the path taken by user TS/TSX code. TinyTSX must not lower the user program through LLVM IR.

## 2.2 AArch64 native targets

The initial and primary target is:

```text
aarch64-apple-darwin
```

Support:

* Apple Silicon Macs with Mach-O and the Apple arm64 ABI;
* Linux arm64 with ELF and the AArch64 ELF ABI;
* dynamic linking to system frameworks or `libSystem` where useful.

Do not initially support:

* x86-64 macOS;
* Windows;
* cross-host final linking;
* universal binaries;
* iOS;
* direct ELF generation.

Cross-host assembly inspection is supported with `check --target ... --emit-asm`.
Final executable linking requires a host matching the selected target.

Current target module structure:

```text
codegen/
  mod.rs
  assembly.rs
  aarch64.rs
  aarch64_backend/
    mod.rs
    functions.rs
    handlers.rs
    response.rs
    values.rs
    data.rs
    tests.rs
  constant_data.rs
  macos_arm64.rs
  linux_arm64.rs
```

## 2.3 First-class TSX without React

Do not compile JSX into:

```text
React.createElement(...)
```

Do not create runtime element objects.

Do not create:

* virtual DOM nodes;
* props hash maps;
* children arrays;
* component instances;
* a generic JSX renderer;
* a React-like reconciliation system.

Instead, compile TSX directly into HTML writer operations.

For example:

```tsx
<h1>Hello, {props.name}!</h1>
```

should conceptually become:

```text
write_static("<h1>Hello, ")
write_escaped_text(props.name)
write_static("!</h1>")
```

A component such as:

```tsx
function Greeting(props: GreetingProps): JSX.Element {
  return <h1>Hello, {props.name}</h1>;
}
```

should lower to a native render function conceptually equivalent to:

```rust
fn render_greeting(
    request: *const TinyRequest,
    writer: *mut TinyResponseWriter,
    props: *const GreetingProps,
) -> TinyStatus;
```

`JSX.Element` is a compiler-only type. It must not require a runtime object representation.

## 2.4 Request execution model

Every active request must execute exclusively on one native worker thread.

This does not mean creating a new operating-system thread for every request.

The default runtime must use:

* a fixed native worker pool;
* one acceptor or dispatcher;
* a bounded connection queue;
* one request at a time per worker;
* no execution migration between workers;
* no multiplexing of multiple application requests on one worker;
* no user-facing async executor in the MVP.

Each request should have:

* a dedicated request context;
* a dedicated request arena;
* a dedicated response writer;
* exclusive access to its worker for the duration of execution.

An experimental mode may later support:

```bash
--concurrency=spawn-per-request
```

This mode must not be the default and should exist mainly for benchmark comparison.

## 2.5 A vertical slice is more important than generality

Do not begin by building a general compiler framework.

The first meaningful goal is:

```text
one TSX source file
    ↓
native executable
    ↓
real HTTP request
    ↓
dynamic escaped HTML response
```

Every architecture decision must serve that path.

---

# 3. Implementation languages

## 3.1 Compiler core

Implement the compiler core in Rust.

Rust should be used for:

* the CLI;
* HIR data structures;
* subset validation;
* type layouts;
* symbol management;
* arm64 assembly emission;
* build orchestration;
* diagnostics;
* build reports;
* test infrastructure.

Use a Cargo workspace, but do not split the code into many empty crates.

Begin with the smallest reasonable project structure.

## 3.2 TypeScript frontend

Use the official TypeScript Compiler API for the first frontend.

The frontend may be a small Node.js package used only at build time.

Its responsibilities are:

* load the project and `tsconfig.json`;
* build a TypeScript `Program`;
* collect TypeScript diagnostics;
* use the TypeScript `TypeChecker`;
* resolve local ESM imports;
* validate the TinyTSX language subset;
* normalize TypeScript types into TinyTSX types;
* lower TypeScript and TSX into a small typed HIR;
* preserve source locations for diagnostics;
* serialize the HIR for the Rust compiler.

The frontend is allowed to depend on Node.js because Node.js is only a compiler dependency.

The generated server executable must not depend on Node.js.

Pin the TypeScript version in the repository.

Do not attempt to support every TypeScript release.

## 3.3 Runtime

Implement the runtime in Rust.

Create two runtime profiles.

### Bootstrap runtime

The bootstrap runtime may use:

* Rust `std`;
* `std::net::TcpListener`;
* native Rust threads;
* channels or a bounded queue;
* ordinary heap allocations outside generated request values;
* macOS system libraries through normal Rust APIs.

Its purpose is to prove the compiler and runtime ABI.

Binary size is not a hard requirement for this profile.

### Tiny runtime

The later tiny runtime should minimize:

* standard-library usage;
* formatting infrastructure;
* unwinding;
* global allocation;
* generic-heavy abstractions;
* dependencies;
* runtime reflection.

It may continue linking dynamically to macOS `libSystem`.

Do not attempt unsupported direct macOS syscalls merely to avoid `libSystem`.

The sub-1MiB goal applies to the stripped application executable, not to operating-system libraries already supplied by macOS.

---

# 4. Initial user-facing API

Create a TinyTSX SDK containing TypeScript declarations.

Example source:

```tsx
interface HomeProps {
  name: string;
}

function Home(props: HomeProps): JSX.Element {
  return (
    <html lang="en">
      <head>
        <title>TinyTSX</title>
      </head>

      <body>
        <main>
          <h1>Hello, {props.name}!</h1>
          <p>This page was compiled into native machine code.</p>
        </main>
      </body>
    </html>
  );
}

export function GET(request: Request): Response {
  const name = request.query("name") ?? "World";

  return Response.html(<Home name={name} />);
}
```

The build command should eventually look like:

```bash
tinytsx build examples/hello/server.tsx \
  --port 3000 \
  --workers 8 \
  --request-memory 262144 \
  --runtime bootstrap \
  --release \
  --output dist/hello-server
```

Run:

```bash
./dist/hello-server
```

Test:

```bash
curl 'http://127.0.0.1:3000/?name=Alice'
```

Expected result:

```html
<html lang="en">
  <head>
    <title>TinyTSX</title>
  </head>
  <body>
    <main>
      <h1>Hello, Alice!</h1>
      <p>This page was compiled into native machine code.</p>
    </main>
  </body>
</html>
```

Test escaping:

```bash
curl 'http://127.0.0.1:3000/?name=%3Cscript%3Ealert(1)%3C%2Fscript%3E'
```

The response must contain escaped text, never a real `<script>` element.

---

# 5. TinyTSX language subset

Support only explicitly listed syntax.

## 5.1 Initial supported syntax

Support:

* `const`;
* `let`;
* function declarations;
* function parameters;
* direct function calls;
* `return`;
* block statements;
* `if` and `else`;
* string literals;
* boolean literals;
* integer literals where required;
* `null`;
* strict equality;
* strict inequality;
* string concatenation;
* nullish coalescing;
* direct property access;
* interfaces;
* supported type aliases;
* closed record literals;
* local static ESM imports;
* named exports;
* TSX intrinsic elements;
* TSX function components;
* component props;
* fragments;
* dynamic text children;
* dynamic string attributes.

## 5.2 Initial types

Support:

```text
void
boolean
string
string | null
i32
u32
i64
u64
closed records
function signatures
Request
Response
JSX.Element
```

A string should initially be represented as:

```rust
#[repr(C)]
struct TinyStringView {
    ptr: *const u8,
    len: usize,
}
```

String data may point into:

* static `.rodata`;
* request input memory;
* request arena memory.

Document the lifetime rules.

Use UTF-8 internally.

Do not attempt complete JavaScript UTF-16 semantics.

## 5.3 Closed record shapes

An interface such as:

```ts
interface User {
  id: i64;
  name: string;
  active: boolean;
}
```

must lower to a fixed native memory layout.

Do not represent ordinary objects as hash maps.

Do not permit undeclared properties.

Do not permit property insertion after construction.

Do not permit prototype-based behavior.

## 5.4 Unsupported syntax

Reject the following at compile time:

* reachable runtime values whose only representation is `any`;
* unrestricted `unknown`;
* unsafe type assertions;
* `eval`;
* the `Function` constructor;
* `Proxy`;
* classes outside the documented closed-class subset;
* prototypes;
* prototype mutation;
* `Object.defineProperty`;
* `Object.setPrototypeOf`;
* dynamic property assignment;
* arbitrary computed property names;
* dynamic imports;
* CommonJS `require`;
* decorators;
* getters and setters;
* Error objects and arbitrary thrown values outside the bounded native string
  completion subset;
* `finally` and exception forms outside same-function string `try`/`catch`;
* generators;
* symbols;
* arbitrary `BigInt`;
* `Map`;
* `Set`;
* weak collections;
* regular expressions;
* arbitrary npm packages;
* reflection;
* JavaScript implicit coercion;
* loose equality;
* mutable global application state;
* recursive object graphs;
* recursion in the first implementation;
* async/await in the first vertical slice.

Every rejected construct must produce a source-level diagnostic.

Example:

```text
error[TINY1311]: native function parameters must be required strings

  src/server.tsx:14:18
   |
14 | function parse(value: any) {
   |                       ^^^

help: replace `any` with a supported concrete runtime type
```

Never silently miscompile unsupported syntax.

---

# 6. TSX semantics

## 6.1 Compiler-only JSX.Element

Declare:

```ts
declare namespace JSX {
  interface Element {
    readonly __tinytsxElement: unique symbol;
  }
}
```

`JSX.Element` may initially appear only:

* as the return value of a component;
* as a child of another TSX element;
* as an argument to `Response.html`;
* inside a supported conditional rendering expression.

Do not permit arbitrary runtime storage or introspection of JSX elements.

## 6.2 Static fragment coalescing

The compiler must combine adjacent static HTML into one constant where possible.

This:

```tsx
<div class="card">
  <h1>Hello</h1>
  <p>Static content</p>
</div>
```

should ideally become one `.rodata` fragment.

Do not generate one runtime call per individual tag when a larger static fragment is possible.

## 6.3 Dynamic text

This:

```tsx
<h1>Hello, {props.name}</h1>
```

must lower to:

```text
write_static("<h1>Hello, ")
write_escaped_text(props.name)
write_static("</h1>")
```

## 6.4 Attributes

Support initially:

* `class`;
* `className`;
* `id`;
* `href`;
* `title`;
* `lang`;
* `name`;
* `value`;
* `type`;
* `placeholder`;
* `data-*`;
* `aria-*`;
* boolean attributes;
* static string attributes;
* dynamic string attributes.

Do not initially support:

* event handlers;
* `onClick`;
* `onInput`;
* refs;
* style objects;
* spread attributes;
* `dangerouslySetInnerHTML`.

Allow `style` only as a plain static or dynamic string.

## 6.5 Escaping

Distinguish at least:

* HTML text context;
* quoted HTML attribute context.

Dynamic text must call:

```text
html_write_escaped_text
```

Dynamic attributes must call:

```text
html_write_escaped_attribute
```

Escape at least:

```text
&
<
>
"
'
```

Do not initially provide a raw HTML escape hatch.

## 6.6 Intrinsic tags

Support a practical minimum:

```text
html
head
title
meta
link
body
main
section
article
header
footer
nav
div
span
h1
h2
h3
p
a
ul
ol
li
strong
em
code
pre
form
label
input
button
```

Recognize void tags such as:

```text
input
meta
link
```

Reject children on void elements.

## 6.7 Conditions and lists

Do not implement these before static and dynamic TSX work end to end.

The next language milestone should support:

```tsx
{props.visible && <span>Visible</span>}
```

and:

```tsx
{props.kind === "admin"
  ? <strong>Admin</strong>
  : <span>User</span>}
```

Lower them to ordinary native branches.

Later support a restricted pattern:

```tsx
<ul>
  {props.items.map(item => <li>{item}</li>)}
</ul>
```

Lower it directly into a native loop.

Do not create an intermediate array of JSX nodes.

Do not implement a general JavaScript `Array.prototype`.

---

# 7. TinyTSX HIR

Do not compile directly from the TypeScript AST to arm64 assembly.

Introduce a deliberately small typed HIR.

The HIR should remove TypeScript-specific syntax while retaining useful language-level meaning.

Suggested structure:

```rust
struct Program {
    modules: Vec<Module>,
    functions: Vec<Function>,
    components: Vec<Component>,
    records: Vec<RecordLayout>,
    static_strings: Vec<StaticString>,
    entrypoints: Entrypoints,
}
```

Suggested types:

```rust
enum Type {
    Void,
    Bool,
    I32,
    U32,
    I64,
    U64,
    StringView,
    NullableStringView,
    Record(RecordId),
    RequestRef,
    Response,
    JsxElement,
}
```

Suggested expressions:

```rust
enum Expr {
    StringLiteral(StringId),
    BoolLiteral(bool),
    IntegerLiteral(i64),
    Null,
    Local(LocalId),
    Property {
        base: ExprId,
        field: FieldId,
    },
    DirectCall {
        function: FunctionId,
        arguments: Vec<ExprId>,
    },
    IntrinsicCall {
        intrinsic: Intrinsic,
        arguments: Vec<ExprId>,
    },
    NullishCoalesce {
        value: ExprId,
        fallback: ExprId,
    },
    StrictEquals {
        left: ExprId,
        right: ExprId,
    },
    RecordLiteral {
        record: RecordId,
        fields: Vec<ExprId>,
    },
    ComponentInvocation {
        component: ComponentId,
        props: ExprId,
    },
}
```

Suggested statements:

```rust
enum Statement {
    Let {
        local: LocalId,
        value: ExprId,
    },
    Assign {
        local: LocalId,
        value: ExprId,
    },
    Expression(ExprId),
    If {
        condition: ExprId,
        then_block: BlockId,
        else_block: Option<BlockId>,
    },
    Return(Option<ExprId>),
}
```

Suggested HTML operations:

```rust
enum HtmlOp {
    WriteStatic(StringId),
    WriteEscapedText(ExprId),
    WriteEscapedAttribute(ExprId),
    CallComponent {
        component: ComponentId,
        props: ExprId,
    },
    If {
        condition: ExprId,
        then_ops: Vec<HtmlOp>,
        else_ops: Vec<HtmlOp>,
    },
    ForEach {
        source: ExprId,
        item: LocalId,
        body: Vec<HtmlOp>,
    },
}
```

Every node that may produce a diagnostic must preserve a source span.

For the MVP, serialize the frontend HIR as JSON.

Provide:

```bash
tinytsx check server.tsx --emit-hir
```

Readable HIR is valuable during early compiler development.

---

# 8. Runtime ABI

Define a small ABI shared between generated application code and the Rust runtime.

Document it in `ABI.md`.

Suggested structures:

```rust
#[repr(C)]
pub struct TinyStringView {
    pub ptr: *const u8,
    pub len: usize,
}

#[repr(C)]
pub struct TinyNullableStringView {
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
}
```

Suggested status values:

```text
0 = OK
1 = REQUEST_OOM
2 = BAD_REQUEST
3 = RENDER_ERROR
4 = INTERNAL_ERROR
5 = NOT_FOUND
```

Generated handler entrypoint:

```rust
extern "C" fn tinytsx_handle_get(
    request: *const TinyRequest,
    writer: *mut TinyResponseWriter,
) -> u32;
```

The runtime is responsible for:

* accepting connections;
* parsing HTTP;
* assigning requests to worker threads;
* preparing request memory;
* preparing the response writer;
* invoking generated code;
* converting the status into an HTTP response;
* writing HTTP headers;
* writing the body;
* resetting request memory;
* closing the connection.

Generated application code is responsible for:

* application logic;
* querying request values through intrinsics;
* component calls;
* HTML generation;
* escaping;
* returning a status code.

Avoid exposing Rust-specific data layouts across the ABI.

---

# 9. AArch64 native backend

## 9.1 Assembly target

Generate textual arm64 assembly accepted by Clang for Mach-O or ELF.

Use the selected Apple or Linux AArch64 ABI and object-format spelling.

Start with:

* direct calls;
* stack-based locals;
* fixed registers for temporary values;
* predictable stack frames;
* no optimizer;
* no sophisticated register allocator.

Use `clang` to assemble and link.

Example build steps:

```bash
clang -c generated.s -o generated.o
ar rcs libtinytsx_runtime.a runtime.o
clang generated.o libtinytsx_runtime.a -o dist/server
strip -x dist/server
```

The exact commands may change based on Rust static-library output.

## 9.2 Calling convention

Follow the macOS arm64 ABI.

At minimum:

* function arguments use `x0` through `x7`;
* return values use `x0`;
* stack alignment must remain correct;
* callee-saved registers must be preserved;
* the link register must be saved when needed;
* direct calls use `bl`;
* function returns use `ret`.

Document the subset of the ABI actually used.

## 9.3 Simple code-generation strategy

Do not implement a graph-coloring register allocator.

For the first backend:

* place most locals in stack slots;
* use a small fixed set of temporary registers;
* spill aggressively;
* prioritize correctness;
* generate direct calls only;
* forbid indirect function values;
* compute record field offsets statically.

The initial backend may generate inefficient code.

Optimization comes after correctness and benchmarks.

## 9.4 Static data

Place static strings and static HTML fragments in Mach-O read-only data sections.

Use assembler-supported labels and relocations.

Do not manually emit Mach-O relocation tables.

---

# 10. Request memory model

## 10.1 Per-worker request arena

Each worker owns a reusable request arena.

Default size:

```text
256 KiB
```

Build option:

```bash
--request-memory 262144
```

Each request begins with:

```text
arena.cursor = arena.start
```

Request-scoped allocations use a bump allocator.

After the request:

```text
arena.cursor = arena.start
```

No individual request-scoped deallocation is required.

Use the arena for:

* dynamic response HTML;
* decoded query values when copying is required;
* request-scoped records;
* temporary strings;
* future request-scoped arrays;
* future JSON values.

## 10.2 No GC in the MVP

The MVP must not include:

* tracing GC;
* reference counting;
* a persistent mutable heap;
* global mutable application state.

Static constants live in the executable’s static data.

Request values live in the request arena.

Persistent application state should be prohibited initially.

## 10.3 OOM behavior

Arena allocation must be fallible.

A request that exceeds its memory limit must not:

* abort the process;
* panic across the ABI;
* corrupt memory;
* affect another worker;
* poison the worker permanently.

Expected behavior:

```text
allocation fails
    ↓
writer enters REQUEST_OOM state
    ↓
generated handler stops
    ↓
runtime returns HTTP 503
    ↓
connection closes
    ↓
arena resets
    ↓
worker handles the next request
```

An end-to-end test must verify that a normal request succeeds after an OOM request.

## 10.4 Stack policy

Each worker uses an operating-system thread stack.

The bootstrap runtime may use normal Rust thread defaults.

Later, allow configurable worker stack size:

```bash
--worker-stack 262144
```

Recursion should initially be rejected by the compiler.

---

# 11. Concurrency model

## 11.1 Bootstrap implementation

The first runtime should use:

* one listening socket;
* one acceptor thread;
* a fixed worker pool;
* a bounded connection queue;
* one request per accepted connection;
* `Connection: close`.

Each worker:

1. receives one socket;
2. parses one request;
3. resets its arena;
4. invokes the generated handler;
5. writes one response;
6. closes the connection;
7. returns to the queue.

## 11.2 Worker ownership

During request execution:

* the request remains on the same worker;
* the request arena belongs to that worker;
* generated code does not synchronize with other workers;
* no shared mutable request state exists;
* no application callback runs concurrently on the same worker.

## 11.3 Overload behavior

The queue must be bounded.

When all workers and queue slots are occupied, choose a simple deterministic strategy:

* stop accepting temporarily;
* or accept and immediately return 503;
* or close the connection.

Document the behavior.

Never permit unbounded queue growth.

## 11.4 Future experiments

After the worker-pool runtime works, add benchmark-only alternatives:

```text
single-threaded
fixed-worker-pool
spawn-per-request
one-listener-per-worker
```

Do not implement all modes before the primary worker pool works.

---

# 12. HTTP scope

The first HTTP implementation should support:

* HTTP/1.1;
* GET;
* request line parsing;
* path;
* query string;
* a bounded header buffer;
* `Content-Length`;
* `Content-Type`;
* `Connection: close`;
* status 200;
* status 400;
* status 404;
* status 500;
* status 503.

Do not initially support:

* keep-alive;
* POST;
* request bodies;
* chunked request bodies;
* streaming responses;
* TLS;
* HTTP/2;
* HTTP/3;
* WebSockets;
* compression.

Set a maximum request-header size, for example:

```text
16 KiB
```

Reject oversized requests.

TLS should initially be delegated to an external reverse proxy.

---

# 13. SDK declarations

Provide a package such as:

```text
@tinytsx/core
```

It should contain declarations similar to:

```ts
declare class Request {
  readonly method: string;
  readonly path: string;

  query(name: string): string | null;
}

declare class Response {
  static html(element: JSX.Element, status?: i32): Response;
}

interface HtmlAttributes {
  id?: string;
  class?: string;
  className?: string;
  title?: string;
  lang?: string;
  style?: string;
}

interface AnchorAttributes extends HtmlAttributes {
  href?: string;
}

declare namespace JSX {
  interface Element {
    readonly __tinytsxElement: unique symbol;
  }

  interface IntrinsicElements {
    html: HtmlAttributes;
    head: HtmlAttributes;
    title: HtmlAttributes;
    meta: HtmlAttributes;
    link: HtmlAttributes;
    body: HtmlAttributes;
    main: HtmlAttributes;
    section: HtmlAttributes;
    article: HtmlAttributes;
    header: HtmlAttributes;
    footer: HtmlAttributes;
    nav: HtmlAttributes;
    div: HtmlAttributes;
    span: HtmlAttributes;
    h1: HtmlAttributes;
    h2: HtmlAttributes;
    h3: HtmlAttributes;
    p: HtmlAttributes;
    a: AnchorAttributes;
    ul: HtmlAttributes;
    ol: HtmlAttributes;
    li: HtmlAttributes;
    strong: HtmlAttributes;
    em: HtmlAttributes;
    code: HtmlAttributes;
    pre: HtmlAttributes;
    form: HtmlAttributes;
    label: HtmlAttributes;
    input: HtmlAttributes;
    button: HtmlAttributes;
  }
}
```

The user should receive normal editor support:

* component prop validation;
* missing prop diagnostics;
* invalid prop diagnostics;
* intrinsic element autocomplete;
* TypeScript navigation;
* local module imports.

---

# 14. Bun compatibility baseline

Performance comparison against Bun is a core project requirement.

The benchmark must avoid comparing unrelated applications.

Create a compatibility package:

```text
@tinytsx/bun-runtime
```

This package should implement the TinyTSX user-facing API on Bun:

* `Request.query`;
* `Response.html`;
* the custom JSX runtime;
* component rendering;
* HTML escaping;
* the same supported intrinsic tags.

The goal is for the same application source file to work in two modes.

## 14.1 Shared source

Use one application source:

```text
benchmarks/dynamic-page/app.tsx
```

Example:

```tsx
interface PageProps {
  name: string;
}

function Page(props: PageProps): JSX.Element {
  return (
    <html>
      <body>
        <h1>Hello, {props.name}!</h1>
      </body>
    </html>
  );
}

export function GET(request: Request): Response {
  const name = request.query("name") ?? "World";

  return Response.html(<Page name={name} />);
}
```

Build it with TinyTSX:

```bash
tinytsx build benchmarks/dynamic-page/app.tsx \
  --workers 8 \
  --request-memory 262144 \
  --release \
  --output benchmarks/dist/tinytsx-dynamic
```

Run the same source with Bun through a thin compatibility launcher:

```bash
bun run benchmarks/bun-server.ts \
  benchmarks/dynamic-page/app.tsx
```

The launcher may import the same exported `GET` function and adapt Bun’s incoming request to the TinyTSX SDK shape.

Application logic and TSX components must remain shared.

## 14.2 Two Bun baselines

Create two Bun comparisons.

### Exact-source compatibility baseline

Run the same TinyTSX application through the Bun compatibility runtime.

This measures:

* native AOT deployment versus a JavaScript runtime;
* identical source semantics;
* identical escaping;
* identical HTML structure.

### Idiomatic Bun baseline

Create a small idiomatic `Bun.serve` implementation that performs the same work without deliberately inefficient abstractions.

This prevents the benchmark from becoming a strawman.

The idiomatic Bun version must return exactly the same response body and headers.

Clearly distinguish these two baselines in benchmark reports.

---

# 15. Benchmark workloads

Implement at least four workloads.

## 15.1 Static page

```tsx
export function GET(): Response {
  return Response.html(
    <html>
      <body>
        <h1>Hello from TinyTSX</h1>
      </body>
    </html>
  );
}
```

This measures:

* static fragment handling;
* startup;
* HTTP overhead;
* binary size;
* maximum throughput.

The static HTML should ideally live almost entirely in read-only executable data.

## 15.2 Dynamic escaped page

```tsx
export function GET(request: Request): Response {
  const name = request.query("name") ?? "World";

  return Response.html(<h1>Hello, {name}!</h1>);
}
```

This measures:

* query parsing;
* dynamic insertion;
* escaping;
* request arena usage.

## 15.3 Repeated list

After restricted list support exists:

```tsx
interface Item {
  name: string;
}

function Page(props: { items: readonly Item[] }): JSX.Element {
  return (
    <ul>
      {props.items.map(item => <li>{item.name}</li>)}
    </ul>
  );
}
```

This measures:

* native loops;
* record layout;
* repeated rendering;
* allocation behavior.

## 15.4 Request OOM

Generate an intentionally oversized response.

Verify:

* TinyTSX returns 503;
* the process remains alive;
* the following normal request succeeds;
* arena memory returns to its initial state.

Bun does not need to reproduce TinyTSX’s exact arena failure semantics, but its memory behavior should still be recorded.

---

# 16. Benchmark methodology

Benchmarks must be reproducible.

## 16.1 Environment recording

Record:

* Mac model;
* Apple chip model;
* CPU core count;
* macOS version;
* Rust version;
* Bun version;
* TinyTSX commit;
* build mode;
* worker count;
* request-memory limit;
* benchmark client;
* concurrency;
* duration.

Save this metadata with each result.

## 16.2 Test conditions

Before official benchmark runs:

* connect the Mac to power;
* disable Low Power Mode;
* close unnecessary applications;
* avoid running IDE indexing or large builds;
* wait for compilation to finish before measuring;
* warm up servers before throughput measurements;
* use release builds;
* run the client and server consistently on the same machine;
* perform multiple independent runs;
* report the median rather than only the best run.

Do not silently discard bad results.

## 16.3 Metrics

Measure:

* executable size;
* executable section sizes;
* dynamic dependencies;
* cold startup time;
* warm startup time where meaningful;
* idle resident memory;
* peak resident memory;
* total allocated request-arena bytes;
* request-arena high-water mark;
* requests per second;
* p50 latency;
* p95 latency;
* p99 latency;
* maximum latency;
* CPU utilization;
* context switches where practical;
* throughput at several concurrency levels.

Suggested concurrency levels:

```text
1
4
8
16
32
64
128
```

Do not use concurrency far beyond what the machine can meaningfully sustain without documenting it.

## 16.4 Benchmark tools

Use simple macOS-compatible tools.

Possible tools include:

```text
oha
wrk
hyperfine
/usr/bin/time -l
vmmap
otool
size
nm
```

Prefer one primary HTTP benchmark tool for consistent reports.

Example:

```bash
oha \
  --duration 20s \
  --connections 32 \
  'http://127.0.0.1:3000/?name=Alice'
```

Cold-start measurements may use:

```bash
hyperfine \
  --warmup 3 \
  './benchmarks/scripts/start-and-probe-tinytsx.sh' \
  './benchmarks/scripts/start-and-probe-bun.sh'
```

Do not include compilation time in server startup measurements.

Measure compilation separately.

## 16.5 Benchmark correctness

Before measuring performance, verify that TinyTSX and Bun return:

* the same HTTP status;
* the same content type;
* the same response bytes;
* equivalent escaping;
* equivalent behavior for missing query values.

Create an automated conformance test that queries both implementations and compares responses.

Never benchmark implementations that produce different output.

## 16.6 Result format

Store machine-readable results:

```json
{
  "runtime": "tinytsx",
  "workload": "dynamic-page",
  "commit": "abc123",
  "platform": "aarch64-apple-darwin",
  "workers": 8,
  "requestMemoryBytes": 262144,
  "binaryBytes": 612304,
  "concurrency": 32,
  "durationSeconds": 20,
  "requestsPerSecond": 123456,
  "latencyMs": {
    "p50": 0.24,
    "p95": 0.61,
    "p99": 1.20
  },
  "idleRssBytes": 3145728,
  "peakRssBytes": 6291456
}
```

Also generate a readable Markdown report.

Do not claim performance wins based on a single run.

---

# 17. Binary size analysis

For every release build, report:

* total executable size;
* text section size;
* constant data size;
* writable data size;
* dynamic dependencies;
* exported symbols;
* runtime features included.

Useful macOS commands:

```bash
ls -l dist/server
size -m dist/server
otool -L dist/server
nm -gU dist/server
```

Strip release binaries:

```bash
strip -x dist/server
```

The initial goals are:

```text
bootstrap static-page server: no hard size requirement
tiny static-page server: below 1 MiB
stretch goal: below 512 KiB
```

Do not compromise correctness merely to reach an arbitrary size.

---

# 18. Repository structure

Start with a compact repository:

```text
tinytsx/
├── Cargo.toml
├── package.json
├── README.md
├── SPEC.md
├── LANGUAGE.md
├── ABI.md
├── ROADMAP.md
│
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── cli.ts
│       ├── program.ts
│       ├── subset-validator.ts
│       ├── type-normalizer.ts
│       ├── jsx-lowering.ts
│       ├── hir.ts
│       └── diagnostics.ts
│
├── compiler/
│   └── src/
│       ├── main.rs
│       ├── hir.rs
│       ├── layout.rs
│       ├── diagnostics.rs
│       ├── build.rs
│       └── codegen/
│           ├── mod.rs
│           ├── assembly.rs
│           ├── aarch64.rs
│           ├── aarch64_backend/
│           ├── constant_data.rs
│           ├── macos_arm64.rs
│           └── linux_arm64.rs
│
├── runtime/
│   ├── bootstrap/
│   ├── tiny/
│   └── abi/
│
├── sdk/
│   ├── package.json
│   └── index.d.ts
│
├── bun-runtime/
│   ├── package.json
│   └── src/
│       ├── server.ts
│       ├── request.ts
│       ├── response.ts
│       └── jsx-runtime.ts
│
├── examples/
│   ├── static-page/
│   └── dynamic-page/
│
├── benchmarks/
│   ├── workloads/
│   ├── bun/
│   ├── scripts/
│   ├── results/
│   └── README.md
│
└── tests/
    ├── ui/
    ├── hir/
    ├── codegen/
    ├── html/
    ├── runtime/
    └── e2e/
```

Do not create empty packages only because the structure lists them.

Split modules when implementation pressure justifies it.

---

# 19. Development milestones

## Milestone 0 — project definition

Create:

* `SPEC.md`;
* `LANGUAGE.md`;
* `ABI.md`;
* `ROADMAP.md`;
* minimal Cargo project;
* minimal frontend package;
* static TSX example.

Clearly document:

* supported syntax;
* unsupported syntax;
* JSX semantics;
* target platform;
* request memory model;
* concurrency model;
* non-goals;
* benchmark methodology.

## Milestone 1 — TypeScript frontend and HIR

Implement:

```bash
tinytsx check examples/static-page/server.tsx
```

The command should:

* load TypeScript;
* collect normal TS diagnostics;
* validate the TinyTSX subset;
* lower TSX to HTML operations;
* serialize HIR;
* preserve source spans.

Add:

```bash
--emit-hir
```

Add negative tests for:

* runtime `any` values;
* unsupported class forms;
* async functions;
* dynamic properties;
* unsupported JSX attributes.

## Milestone 2 — static TSX native server

Support:

```tsx
function Page(): JSX.Element {
  return (
    <html>
      <body>
        <h1>Hello from TinyTSX</h1>
      </body>
    </html>
  );
}

export function GET(request: Request): Response {
  return Response.html(<Page />);
}
```

Implement:

* static TSX fragment coalescing;
* arm64 assembly emission;
* assembly through `clang`;
* linking with the bootstrap runtime;
* a real native Mach-O executable;
* a real HTTP response.

This is the first end-to-end milestone.

## Milestone 3 — dynamic props and escaping

Support:

```tsx
interface PageProps {
  name: string;
}

function Page(props: PageProps): JSX.Element {
  return <h1>Hello, {props.name}!</h1>;
}
```

Support:

```ts
request.query("name") ?? "World"
```

Add complete escaping tests.

## Milestone 4 — bounded request arena

Move response output into a fixed request arena.

Implement deterministic request OOM handling.

Test:

1. normal response succeeds;
2. oversized response gets 503;
3. process remains alive;
4. another normal response succeeds.

## Milestone 5 — native worker pool

Add:

* configurable worker count;
* bounded queue;
* one request per worker;
* per-worker arena;
* concurrency tests;
* response-isolation tests.

## Milestone 6 — Bun compatibility runtime

Implement the Bun adapter that runs the same application source.

Add automated response equivalence tests.

Do not begin performance claims until equivalence tests pass.

## Milestone 7 — benchmark suite

Add:

* static page benchmark;
* dynamic escaped page benchmark;
* startup benchmark;
* binary-size report;
* RSS report;
* TinyTSX versus exact-source Bun;
* TinyTSX versus idiomatic Bun;
* machine-readable results.

## Milestone 8 — tiny macOS runtime

Reduce runtime size by replacing heavyweight bootstrap components.

Optimize only after profiling.

Activate a sub-1MiB CI or local size gate when it becomes realistic.

## Milestone 9 — conditional TSX and lists

Add:

* conditional rendering;
* ternaries;
* restricted list iteration;
* direct native loops.

Extend the Bun compatibility layer and benchmark workloads accordingly.

---

# 20. Acceptance criteria for the first prototype

The first prototype is successful when all of the following are true:

1. The application source is valid TSX.

2. The project builds locally on an Apple Silicon Mac.

3. The command:

```bash
tinytsx build examples/dynamic-page/server.tsx \
  --port 3000 \
  --workers 8 \
  --request-memory 262144 \
  --release \
  --output dist/server
```

creates a native Mach-O executable.

1. The executable contains no JavaScript engine, interpreter, JIT, or runtime
   source parser.

2. The executable handles a real HTTP GET request.

3. A TSX component renders valid HTML.

4. Dynamic values are escaped correctly.

5. TSX does not create a runtime element tree.

6. The generated application code is arm64 native code.

7. Every request executes exclusively on one worker thread.

8. Request memory is bounded.

9. Request OOM does not terminate the process.

10. A normal request succeeds after an OOM request.

11. Unsupported TypeScript syntax is rejected at compile time.

12. The repository contains automated end-to-end tests.

13. The same application source can be executed through the Bun compatibility runtime.

14. TinyTSX and Bun responses are automatically compared for equality.

15. The benchmark suite records throughput, latency, startup, memory, and binary size.

16. Benchmark results include multiple runs and environment metadata.

17. The tiny runtime eventually produces a stripped executable below 1 MiB for the static or simple dynamic workload.

---

# 21. Engineering rules

1. Prefer a working vertical slice over a general framework.

2. Never silently fall back to JavaScript execution.

3. Never parse TypeScript or JavaScript at application runtime.

4. Never represent ordinary TSX as a runtime virtual DOM.

5. Never allow unbounded request-path allocation.

6. Never allow request OOM to abort the server process.

7. Reject unsupported syntax with source-level diagnostics.

8. Keep the generated-code/runtime ABI small and documented.

9. Keep macOS-specific code isolated.

10. Do not write a Mach-O writer before the assembly pipeline works.

11. Do not write an optimizer before benchmarks identify a problem.

12. Do not optimize binary size before the end-to-end server works.

13. Do not begin React, RSC, or Next.js compatibility during the MVP.

14. Do not claim Bun performance wins without equivalent output and repeatable measurements.

15. Preserve the same application source for the exact-source Bun benchmark.

16. Include an idiomatic Bun baseline to avoid a misleading comparison.

17. Every newly supported language feature requires positive and negative tests.

18. Document semantic differences from JavaScript and TypeScript.

19. Generated code must be deterministic for the same source and compiler version.

20. Keep temporary build artifacts available through `--keep-temps`.

---

# 22. Initial CLI

Implement:

```bash
tinytsx check <entry.tsx>
tinytsx build <entry.tsx>
tinytsx run <entry.tsx>
```

Suggested build options:

```text
--output <path>
--port <number>
--workers <number>
--worker-stack <bytes>
--request-memory <bytes>
--runtime bootstrap|tiny
--release
--emit-hir
--emit-asm
--keep-temps
--print-size
```

Example build output:

```text
TinyTSX build

Entry:               examples/dynamic-page/server.tsx
Target:              aarch64-apple-darwin
Runtime:             bootstrap
Workers:             8
Worker stack:        system default
Request memory:      262144 bytes
TypeScript modules:  1
Components:          1
Static HTML bytes:   148
Dynamic insertions:  1
GC:                  disabled
JavaScript engine:   none

Output:              dist/server
Binary size:         846320 bytes
```

Numbers shown above are examples and must not be hardcoded.

---

# 23. Build report

Generate a machine-readable report:

```text
dist/server.build.json
```

Example:

```json
{
  "target": "aarch64-apple-darwin",
  "runtime": "bootstrap",
  "binaryBytes": 846320,
  "workers": 8,
  "requestMemoryBytes": 262144,
  "gc": "disabled",
  "modules": 1,
  "components": 1,
  "staticHtmlBytes": 148,
  "dynamicHtmlExpressions": 1,
  "runtimeFeatures": [
    "http1",
    "query",
    "html-escape",
    "worker-pool"
  ]
}
```

Use this report in benchmark tooling.

---

# 24. First concrete deliverable

Do not implement the entire roadmap in one pass.

The first concrete deliverable must include only:

1. `SPEC.md`, `LANGUAGE.md`, and `ABI.md`.

2. A TypeScript frontend that accepts one static `server.tsx`.

3. Support for:

```tsx
function Page(): JSX.Element {
  return (
    <html>
      <body>
        <h1>Hello from TinyTSX</h1>
      </body>
    </html>
  );
}

export function GET(request: Request): Response {
  return Response.html(<Page />);
}
```

1. HIR containing:

* one component;
* one GET handler;
* one coalesced static HTML fragment.

1. An arm64 assembly emitter.

2. A bootstrap Rust runtime using:

* `TcpListener`;
* a configurable fixed native worker pool;
* GET;
* `Connection: close`;
* `Content-Length`;
* `Content-Type`.

1. A build command producing a native macOS executable.

2. An end-to-end HTTP test.

3. `--emit-hir`.

4. `--emit-asm`.

5. A README containing exact working commands.

After this works:

1. add dynamic props;
2. add HTML escaping;
3. add the request arena;
4. add the worker pool;
5. add the Bun compatibility runtime;
6. add benchmarks;
7. begin size reduction.

Do not stop after writing architecture documentation.

The first implementation cycle must end with an actual native server responding to an actual HTTP request.

---

# 25. Expected working style

Start by inspecting the repository.

Then:

1. summarize the current repository state;
2. create a small implementation plan;
3. write the language and ABI documents;
4. create the static TSX example;
5. implement TSX-to-HIR lowering;
6. emit macOS arm64 assembly;
7. build the bootstrap runtime;
8. assemble and link the executable;
9. start the server;
10. send a real HTTP request;
11. add an automated end-to-end test;
12. report the resulting executable size.

When choosing between alternatives:

* select the smallest implementation that preserves the architecture;
* record important tradeoffs in `SPEC.md`;
* avoid speculative abstraction;
* preserve the ability to replace the bootstrap runtime without changing generated application semantics;
* preserve the same application source for later Bun benchmarks.

If a feature is too difficult for the current milestone, narrow the language subset.

Never replace native execution with an interpreter, a JavaScript fallback, or a Wasm runtime.

Begin with Milestones 0–2 and continue until the static TSX application produces a real native macOS server executable.
