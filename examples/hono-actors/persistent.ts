import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {spawn} from "tinytsx:actors";
import {Database} from "tinytsx:sqlite";

const database = new Database("actors.db");
const counter = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0, {persistence: {database, key: "primary-counter"}});
const app = new Hono();

app.get("/health", context => context.text("ok"));
app.get("/", async context => context.text(await counter.ask(0)));
app.get("/increment", async context => context.text(await counter.ask(1)));

serve({fetch: app.fetch});
