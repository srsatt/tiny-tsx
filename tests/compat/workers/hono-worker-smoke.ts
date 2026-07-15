import {Hono} from "hono";

const worker = new Worker(new URL("./uppercase.worker.ts", import.meta.url), {
  type: "module",
});

const app = new Hono();
app.get("/worker", async context => {
  const input = context.req.query("input") ?? "hello worker";
  return context.text(await worker.request(input));
});

export default app;
