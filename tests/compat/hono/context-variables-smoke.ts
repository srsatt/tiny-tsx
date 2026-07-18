import {Hono} from "hono";

const app = new Hono();

app.use("/context/*", async (context, next) => {
  context.set("prefix", "old");
  context.set("prefix", "ctx");
  await next();
});

app.get("/context/:value", context => {
  context.set("value", context.req.param("value"));
  const prefix = context.get<string>("prefix");
  const value = context.get<string>("value");
  const missing = context.get<string>("missing") ?? "absent";
  return context.text(`${prefix}:${value}:${missing}`);
});

export default app;
