import {Hono} from "hono";

const app = new Hono();

app.use("/hello/*", async (context, next) => {
  await next();
  context.header("X-message", "This is addHeader middleware!");
});
app.get("/hello", () => new Response("This is /hello"));

export default app;
