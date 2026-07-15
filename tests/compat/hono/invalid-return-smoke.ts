// Invalid-return route and surrounding middleware from the pinned basic example.
import {Hono} from "hono";
import {poweredBy} from "hono/powered-by";

const app = new Hono();

app.use("*", poweredBy());
app.use("*", async (context, next) => {
  const start = Date.now();
  await next();
  const milliseconds = Date.now() - start;
  context.header("X-Response-Time", `${milliseconds}ms`);
});
app.onError((error, context) => {
  console.error(`${error}`);
  return context.text("Custom Error Message", 500);
});

// @ts-ignore Deliberately mirrors the upstream compatibility probe.
app.get("/type-error", () => "return not Response instance");

export default app;
