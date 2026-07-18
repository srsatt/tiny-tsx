import {serve} from "@hono/node-server";
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

serve({fetch: app.fetch});
