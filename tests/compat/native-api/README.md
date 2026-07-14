# Native API conformance

Native host APIs are tested independently from Hono so platform defects can be
distinguished from compiler and framework defects.

The current suite lives beside the Rust implementation and covers:

- borrowed Request method, path, and query views;
- empty query behavior;
- exact-fit response writes;
- bounded-writer OOM without partial overwrite;
- invalid native writer arguments.

Run it with:

```bash
npm run test:native-api
```

Request, Response, Headers, URL, encoding, RegExp, and streaming tests will be
added here as their native implementations land. Every API should have focused
unit cases, HTTP end-to-end coverage where observable, and at least one Hono
behavior case that consumes it.
