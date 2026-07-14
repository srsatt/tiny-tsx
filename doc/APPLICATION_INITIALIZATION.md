# Application initialization

Hono applications export a constructed object rather than a standalone GET
function. TinyTSX treats that default export as the root of compile-time module
initialization.

The frontend currently recognizes this general source shape:

```ts
const app = new Application(options)
app.method(argument, handler)
export default app
```

The analyzer records the exported binding, named constructor, constructor
arguments, ordered top-level calls, and whether each argument is a closed string,
function value, or another expression. It does not assign Hono-specific meaning
to method names.

For the pinned basic tracer the exact plan is:

```text
binding: app
constructor: Hono
constructor arguments: []
calls:
  - get(string "/", function)
runtime constructor chain:
  - vendor/hono/src/hono.ts:Hono
      operations: superCall, assignment
  - vendor/hono/src/hono-base.ts:Hono
      operations: variable, forEach, assignment, assignment, variable, call, assignment
```

This trace is now selected before validating bodies in imported modules. An
unused async closure in `HonoBase.route()` therefore no longer blocks the basic
entry. Compilation currently emits `TINY1400` because the initialization plan
is recognized and its runtime class chain is resolved, but its constructor
operations are not executed yet. Resolution follows runtime imports and
re-exports independently of the application-facing `api.d.ts` overlay.

The next evaluator must follow the actual imported implementation and support:

1. imported class resolution and `new Hono()`;
2. base/subclass constructor execution and `super`;
3. closed fields and the staged seven-key method installation loop;
4. closures capturing `this`, method name, path, and route handler;
5. the selected `app.get(...)` call and its `#addRoute` effects;
6. an immutable route artifact consumed by native request dispatch.

Partial evaluation must execute the upstream source semantics. The trace is not
permission to replace Hono routing with a separately implemented interface. If
initialization depends on runtime input or an unsupported effect, compilation
must retain that work for native execution or report a source diagnostic.
