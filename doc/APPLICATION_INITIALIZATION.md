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

For the pinned first-route tracer the exact plan is:

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

The retained handler then runs against an initialized upstream `Context`. The
evaluator follows Hono's actual `Context.text` fast-path condition into the
standard `new Response(text)` constructor and derives status 200,
`text/plain;charset=UTF-8`, and the closed body.

Multiple closed routes now enter HIR v2 in registration order. Generated native
code compares the borrowed request path with each exact path, emits the matched
response, and returns `NOT_FOUND` only after all routes miss. A two-route tracer
proves `/` and `/hello` preserve Hono's merged paths and dispatch independently.
Both the `hono/tiny` tracer and the full-package first-route tracer compile; the
latter is also covered by real Mach-O HTTP E2E tests.

Closed middleware registrations are retained as `ALL` routes during symbolic
initialization. For a matching static route, the evaluator invokes preceding
middleware around the handler and applies post-handler effects in reverse
order. The current executable case resolves and invokes the actual upstream
`poweredBy()` factory and async middleware closure. Its
`res.headers.set('X-Powered-By', 'Hono')` effect becomes a static response header
and is verified on the native root route.

This is deliberately a narrow AOT fast path. Dynamic route patterns,
request-dependent handler bodies, non-200 response construction, dynamic
headers, pre-handler control flow, and the general Context/Request/Response
runtime remain pending. Middleware path matching currently covers exact paths,
`*`, and suffix-wildcard prefixes; it is not a general native Hono router.

Partial evaluation must execute the upstream source semantics. The trace is not
permission to replace Hono routing with a separately implemented interface. If
initialization depends on runtime input or an unsupported effect, compilation
must retain that work for native execution or report a source diagnostic.
