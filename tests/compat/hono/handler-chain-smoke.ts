import {Hono} from "hono";

const app = new Hono();

app.get(
  "/chain",
  async (c, next) => {
    await next();
    c.res.headers.set("X-Chain", "yes");
  },
  (c) => c.text("chained"),
);

export default app;
