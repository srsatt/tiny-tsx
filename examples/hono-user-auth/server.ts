import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {getCookie, setCookie} from "hono/cookie";
import {accountGuard} from "./auth.js";
import type {Bindings} from "./config.js";
import {database, events, recordEvent} from "./storage.js";

const app = new Hono<{Bindings: Bindings}>();

app.use("/account/*", accountGuard);

app.onError((error, context) => {
  console.error(`${error}`);
  return context.text("handled error", 500);
});

app.get("/config", context => context.text(context.env.TINYTSX_AUTH_APP_NAME));
app.get("/session", context => context.text(
  getCookie(context, "tinytsx_session") ?? "signed-out",
));
app.post("/schema", async context => {
  await database.exec(
    "CREATE TABLE IF NOT EXISTS auth_events (username TEXT NOT NULL)",
  );
  return context.text("ready");
});
app.post("/account/events", async context => {
  await recordEvent.run(["admin"]);
  return context.json({ok: true}, 201);
});
app.get("/account/events", async context => context.json({events: await events.all()}));
app.post("/account/session", context => {
  setCookie(context, "tinytsx_session", "active", {httpOnly: true, sameSite: "Lax"});
  return context.text("signed-in", 201);
});
app.get("/failure", () => {
  throw Error("auth tracer failure");
});

serve({fetch: app.fetch});
