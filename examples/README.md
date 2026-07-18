# TinyTSX alpha examples

These examples ship inside `lib/tinytsx/examples` in the alpha archive. Copy
the directory to a writable project, install its compile-time packages, and
build with the installed `tinytsx` binary:

```sh
cp -R "$TINYTSX_HOME/examples" ./tinytsx-examples
cd tinytsx-examples
npm ci
```

The generated servers have no npm or JavaScript runtime dependency.

| Example | Build command | Contract |
| --- | --- | --- |
| `hono-node-server/server.ts` | `tinytsx build hono-node-server/server.ts --output server --release` | Hono with the compatible `@hono/node-server` entry |
| `hono-body-limit/server.ts` | `tinytsx build hono-body-limit/server.ts --output server --release` | Pinned Hono body limit with a closed 14-byte maximum and default rejection |
| `hono-request-id/server.ts` | `tinytsx build hono-request-id/server.ts --output server --release` | Default Hono request ID validation, UUID fallback, and request-local reuse |
| `hono-secure-headers/server.ts` | `tinytsx build hono-secure-headers/server.ts --output server --release` | Default pinned Hono security response headers |
| `tiny-serve/server.ts` | `tinytsx build tiny-serve/server.ts --output server --release` | The same entry through Hono-neutral `tinytsx:serve` |
| `hono-zod-openapi/server.ts` | `tinytsx build hono-zod-openapi/server.ts --output server --release` | Pinned `OpenAPIHono`, `createRoute`, and `z` path validation/document generation |
| `hono-static/server.ts` | `tinytsx build hono-static/server.ts --allow-read "$PWD/hono-static/assets" --output server --release` | Capability-scoped UTF-8 file reads |
| `hono-sqlite/server.ts` | `tinytsx build hono-sqlite/server.ts --allow-env TINYTSX_BLOG_NAME --output server --release` | Bounded in-memory SQLite CRUD, JSON input, and typed run results |
| `hono-sqlite/persistent.ts` | `tinytsx build hono-sqlite/persistent.ts --allow-read "$PWD/state" --allow-write "$PWD/state" --output server --release` | Capability-scoped on-disk SQLite and static transactions |
| `hono-sqlite/callback-transaction.ts` | `tinytsx build hono-sqlite/callback-transaction.ts --output server --release` | Atomic prepared-write callback transaction with complete rollback |
| `hono-actors/server.ts` | `tinytsx build hono-actors/server.ts --output server --release` | Local bounded counter actor |
| `hono-actors/messages.ts` | `tinytsx build hono-actors/messages.ts --output server --release` | Copied primitive, bounded-array, and closed-record actor messages |
| `hono-actors/restart.ts` | `tinytsx build hono-actors/restart.ts --output server --release` | Fallible counter with bounded restart intensity |
| `hono-actors/persistent.ts` | `tinytsx build hono-actors/persistent.ts --allow-read "$PWD/state" --allow-write "$PWD/state" --output server --release` | SQLite-backed counter persistence and hard-reset waiter cancellation |

Create the `state` directory before building a persistent example. Each source
file demonstrates only the bounded contract described in `doc/ALPHA.md`; it is
not evidence of general TypeScript, Hono, Node.js, Zod, SQLite, or actor
compatibility.
