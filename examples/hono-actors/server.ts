import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {spawn} from "tinytsx:actors";

const counter = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);

const app = new Hono();

app.get("/", async context => context.text(await counter.ask(0)));
app.get("/increment", async context => context.text(await counter.ask(1)));
app.get("/decrement", async context => context.text(await counter.ask(-1)));
app.get("/tell", context => {
  counter.tell(2);
  return context.text("queued");
});
app.get("/stop", context => {
  counter.stop();
  return context.text("stopped");
});

serve({fetch: app.fetch});
