import {Hono} from "hono";

const app = new Hono();

app.use("*", async (context, next) => {
  await next();
  context.header("X-Dynamic", `${Date.now()}ms`);
});
app.get("/user-agent", context => {
  const userAgent = context.req.header("User-Agent");
  return context.text(`Your UserAgent is ${userAgent}`);
});

export default app;
