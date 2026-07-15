import {Hono} from "hono";

const app = new Hono();

app.get("/user-agent", context => {
  const userAgent = context.req.header("User-Agent");
  return context.text(`Your UserAgent is ${userAgent}`);
});

export default app;
