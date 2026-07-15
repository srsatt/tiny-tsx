// Basic example middleware order around its protected route and custom error handler.
import {Hono} from "hono";
import {basicAuth} from "hono/basic-auth";
import {poweredBy} from "hono/powered-by";

const app = new Hono();

app.use("*", poweredBy());
app.use("/auth/*", basicAuth({username: "hono", password: "acoolproject"}));
app.use("*", async (context, next) => {
  const start = Date.now();
  await next();
  context.header("X-Response-Time", `${Date.now() - start}ms`);
});
app.onError((error, context) => {
  console.error(`${error}`);
  return context.text("Custom Error Message", 500);
});
app.get("/auth/*", context => context.text("You are authorized"));

export default app;
