// Exact ETag middleware and route from the pinned complete basic example.
import {Hono} from "hono";
import {etag} from "hono/etag";

const app = new Hono();

app.use("/etag/*", etag());
app.get("/etag/cached", context => context.text("Is this cached?"));

export default app;
