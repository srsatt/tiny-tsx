import {Hono} from "hono";

const app = new Hono();

app.get("/map/:value", context => {
  const values = new Map<string, string>();
  values.set("value", "stale");
  values.set("discard", "discarded");
  values.set("value", context.req.param("value"));
  const deleted = values.delete("discard");
  if (!deleted || values.has("discard") || values.size !== 1) {
    return context.text("invalid map", 500);
  }
  return context.text(values.get("value")!);
});

app.get("/map-clear", context => {
  const values = new Map<string, string>();
  values.set("value", "present");
  values.clear();
  return context.text(values.get("value") === undefined && values.size === 0 ? "empty" : "invalid map");
});

export default app;
