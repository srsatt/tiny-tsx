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

A route segment of the closed form `:name` now matches one non-empty request
segment. The handler's `c.req.param('name')` becomes a request-time HIR value;
template and string concatenation stream literal and parameter chunks directly
into the bounded writer. The runtime percent-decodes valid UTF-8 groups and
preserves malformed groups. A native E2E covers the basic example's
`/entry/:id` handler, including an encoded space and slash in the parameter.

Initialization also tracks additional top-level instances of the application
class. For the basic example's nested book application, it constructs `book`,
executes its registrations, then invokes upstream `app.route('/book', book)`.
The evaluator follows `basePath()`, `#clone()`, the closed `routes.map(...)`,
and `#addRoute` against shared route storage. Native E2E coverage verifies
`/book` and the request-dependent `/book/:id`; no separate nesting interface is
substituted for Hono's implementation.

GET and POST registrations now share ordered method-plus-path dispatch. The
nested `POST /book` text route is native. The basic example's closed
`POST /api/posts` handler also follows upstream `Context.json()` through closed
JSON serialization, header construction and iteration, `#newResponse`, and
`new Response`; native output preserves status 201 and `application/json`.

A terminal `*` route is now retained as a native pattern. It matches the base
path, its trailing slash, and deeper segments, consistent with the pinned Hono
router for this subset. The basic example's `GET /api/*` fallback therefore
serves its own status 404 and `API endpoint is not found` body instead of falling
through to the bootstrap's unmatched-route response.

Multiple registrations with the same method and path now form one ordered
handler chain. Earlier handlers are not emitted as duplicate native routes;
their post-`next()` effects are applied in reverse around the terminal response.
A focused native E2E verifies an async first handler mutating the response header
after a final text handler. In the complete basic source, the two GET
`/api/posts` registrations now become one route. The upstream `prettyJSON()`
middleware reads the symbolic request query, consumes the closed JSON response,
clones it, and replaces its body conditionally. Native dispatch selects the
compact body when `pretty` is absent and the indented body when it is present.

The upstream `Context.redirect('/')` path now follows its closed `String`
conversion, ASCII RegExp guard, `header()` mutation, and variadic `newResponse`
wrapper. The resulting native route has status 302, `Location: /`, an empty
body, and no content type.

The `/user-agent` handler retains a symbolic request-header part in its response
body. Native code performs case-insensitive lookup against the borrowed request
head and streams the value. Middleware evaluation uses a cloned response and
commits it only when the effect is fully supported, preventing an unresolved
runtime response-time header from erasing this otherwise valid body.

The same transaction boundary lets the supported `/hello/*` middleware commit
its finalized-response clone and static `X-message` header while the later
runtime response-time middleware remains unresolved and rolls back alone.

An explicit `notFound()` application call is also retained. After route
registration completes, the evaluator invokes Hono's installed private closure
with matching global middleware and lowers the result as final GET/POST
fallback dispatch. This is derived from Hono state rather than a compiler-owned
replacement router.

An explicit `onError()` call similarly installs the upstream application error
closure. A closed throw from a route transfers control to that closure, records
its `console.error` effect, and lowers its response. Generated dispatch repeats
the log and 500 response on every matching request; the exception is not erased
at compile time.

Async/await syntax is admitted only inside constructed-application handlers
that the initialization evaluator consumes completely. This does not introduce
native Promise objects, suspension, or a task executor.

Closed middleware registrations are retained as `ALL` routes during symbolic
initialization. For a matching static route, the evaluator invokes preceding
middleware around the handler and applies post-handler effects in reverse
order. The current executable case resolves and invokes the actual upstream
`poweredBy()` factory and async middleware closure. Its
`res.headers.set('X-Powered-By', 'Hono')` effect becomes a static response header
and is verified on the native root route.

This is deliberately a narrow AOT fast path. Optional and constrained route
patterns, broader request-dependent bodies, general
response construction, dynamic headers, pre-handler control flow, and the
general Context/Request/Response
runtime remain pending. Middleware path matching currently covers exact paths,
`*`, and suffix-wildcard prefixes; it is not a general native Hono router.

Partial evaluation must execute the upstream source semantics. The trace is not
permission to replace Hono routing with a separately implemented interface. If
initialization depends on runtime input or an unsupported effect, compilation
must retain that work for native execution or report a source diagnostic.
