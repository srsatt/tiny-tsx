// Exact source shape from Hono's pinned empty catch-all parameter behavior test.
import {Hono} from "hono";

const app = new Hono();

app.get("/:remaining{.*}", context => {
  const remaining = context.req.param("remaining");
  return context.json({type: typeof remaining, value: remaining});
});

export default app;
