import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {spawn} from "tinytsx:actors";

const counter = spawn((context, delta: number) => {
  if (delta === 99) throw Error("counter failure");
  context.state += delta;
  return String(context.state);
}, 0, {restart: {maxRestarts: 2, withinMs: 60_000}});
const app = new Hono();

app.get("/", async context => context.text(await counter.ask(0)));
app.get("/increment", async context => context.text(await counter.ask(1)));
app.get("/failure", async context => context.text(await counter.ask(99)));

serve({fetch: app.fetch});
