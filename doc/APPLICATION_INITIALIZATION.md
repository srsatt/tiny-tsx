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
entry. Resolution follows runtime imports and re-exports independently of the
application-facing `api.d.ts` overlay.

The symbolic evaluator now executes both constructor bodies with the empty
default options record. It evaluates `super(options)`, instance field
initializers, the closed seven-key `forEach`, closure assignments, destructuring
rest, `Object.assign`, nullish/conditional selection, and symbolic router
construction. Full Hono initializes 21 closed fields with no unsupported
constructor effects, including:

```text
_basePath = "/"
#path = "/"
routes = []
get/post/put/delete/options/patch/all = closures
on/use = closures
getPath = imported getPath function
router = constructed SmartRouter
```

Compilation currently emits `TINY1401`: constructor execution is complete, but
the traced `app.get(...)` closure invocation and its route effects are not yet
lowered.

The next evaluator must follow the actual imported implementation and support:

1. closures capturing `this`, method name, path, and route handler;
2. the selected `app.get(...)` call and its `#addRoute` effects;
3. router insertion and an immutable route artifact;
4. native request dispatch consuming that artifact.

Partial evaluation must execute the upstream source semantics. The trace is not
permission to replace Hono routing with a separately implemented interface. If
initialization depends on runtime input or an unsupported effect, compilation
must retain that work for native execution or report a source diagnostic.
