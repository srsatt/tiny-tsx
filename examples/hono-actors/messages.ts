import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {spawn} from "tinytsx:actors";

const primitive = spawn((context, message: string) => {
  context.state = message;
  return JSON.stringify(context.state);
}, "idle");

const list = spawn((context, message: readonly string[]) => {
  context.state = message;
  return JSON.stringify(context.state);
}, ["idle"]);

type Status = {status: string; tags: readonly string[]};
const record = spawn((context, message: Status) => {
  context.state = message;
  return JSON.stringify(context.state);
}, {status: "idle", tags: []});

const app = new Hono();
app.get("/primitive", async context => context.text(await primitive.ask("ready")));
app.get("/array", async context => context.text(await list.ask(["ready", "warm"])));
app.get("/tell", context => {
  record.tell({status: "queued", tags: ["fire-and-forget"]});
  return context.text("queued");
});
app.get("/record", async context => context.text(await record.ask({
  status: "ready",
  tags: ["one", "two"],
})));

serve({fetch: app.fetch});
