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

The evaluator now invokes the actual installed `get` closure from upstream
Hono. It binds the rest parameter, evaluates the closure's branch and
`forEach`, resolves private `#addRoute`, executes imported `mergePath`, and
records both `router.add(...)` and `routes.push(...)`. The pinned full-package
tracer produces this closed initialization artifact with zero issues:

```text
routes:
  - method: GET
    path: /
    basePath: /
    handler: closure
router insertions: 1
```

Compilation currently emits `TINY1402`: upstream constructor and registration
execution are complete, but this route artifact does not yet enter HIR or native
request dispatch.

The next compiler slice must lower the immutable route artifact into HIR,
preserve its handler closure, and make native request dispatch consume it.

Partial evaluation must execute the upstream source semantics. The trace is not
permission to replace Hono routing with a separately implemented interface. If
initialization depends on runtime input or an unsupported effect, compilation
must retain that work for native execution or report a source diagnostic.
