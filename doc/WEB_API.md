# Web API boundary

TinyTSX uses TypeScript's pinned `lib.dom.d.ts` and `lib.dom.iterable.d.ts` as
the build-time type contract for Web-standard APIs. The project does not keep a
second handwritten global `Request` or `Response` declaration. This lets the
pinned Hono runtime graph type-check against the same constructor, property, and
method shapes used by ordinary TypeScript Web applications.

Type availability is not a runtime implementation claim. Each reachable API
still needs a native lowering or runtime helper plus focused behavior coverage.
The current boundary is:

| API | Type contract | Native behavior |
| --- | --- | --- |
| `Request` | standard DOM declaration | borrowed method, path, and query ABI views |
| `Response` | standard DOM declaration | bounded body writer, status, HTML/text/JSON content-type IDs |
| `Headers` | standard DOM declaration | pending |
| `URL` / `URLSearchParams` | standard DOM declaration | pending |
| body and stream types | standard DOM declaration | pending |
| encoding types | standard DOM declaration | pending |

`Response.html(element)` and `Response.text(string)` are temporary compiler
intrinsics used by the pre-Hono GET entrypoint. They are not Web-standard static
methods and are not declared in the SDK. The frontend suppresses only the exact
TypeScript missing-property diagnostic for these two recognized calls before
lowering them. Unknown properties such as `Response.missing` remain normal
TypeScript errors.

Hono's application-facing types remain in `tests/compat/hono/api.d.ts`. That
overlay narrows the imported package surface for application type checking but
does not replace upstream runtime source or Web-standard declarations.

Native API behavior belongs in the dedicated runtime tests. Selected Web
Platform Tests should be added as each implementation becomes executable; a
green TypeScript check alone never counts as Web API conformance.
