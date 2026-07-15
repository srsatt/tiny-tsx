import {Hono} from "hono";
import {prettyJSON} from "hono/pretty-json";

const app = new Hono();

app.use("*", async (context, next) => {
  const start = Date.now();
  await next();
  const milliseconds = Date.now() - start;
  context.header("X-Response-Time", `${milliseconds}ms`);
});

app.get("/posts", prettyJSON(), context => context.json([{id: 1}]));

export default app;
