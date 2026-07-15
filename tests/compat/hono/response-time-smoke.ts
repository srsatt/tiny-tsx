// Exact response-time middleware from the pinned complete Hono basic example.
import {Hono} from "hono";

const app = new Hono();

app.use("*", async (context, next) => {
  const start = Date.now();
  await next();
  const milliseconds = Date.now() - start;
  context.header("X-Response-Time", `${milliseconds}ms`);
});

app.get("/timed", context => context.text("timed"));

export default app;
