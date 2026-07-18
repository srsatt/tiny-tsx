import {Hono} from "hono";

const app = new Hono();

function selectValue(value: string): string {
  const values = new Map<string, string>();
  values.set("value", "stale").set("discard", "discarded");
  values.set("value", value);
  const deleted = values.delete("discard");
  if (!deleted || values.has("discard") || values.size !== 1) {
    return "invalid map";
  }
  return values.get("value")!;
}

app.get("/map/:value", context => context.text(selectValue(context.req.param("value"))));

app.get("/map-clear", context => {
  const values = new Map<string, string>();
  values.set("value", "present");
  values.clear();
  return context.text(values.get("value") === undefined && values.size === 0 ? "empty" : "invalid map");
});

export default app;
