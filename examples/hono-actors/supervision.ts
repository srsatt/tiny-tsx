import {Hono} from "hono";
import {serve} from "tinytsx:serve";
import {spawn, supervise, type CounterActorContext} from "tinytsx:actors";

const fallibleCounter = (context: CounterActorContext, delta: number) => {
  if (delta === -999) throw Error("supervised counter failure");
  context.state += delta;
  return String(context.state);
};

const counter = (context: CounterActorContext, delta: number) => {
  context.state += delta;
  return String(context.state);
};

const root = supervise({
  strategy: "oneForOne",
  maxRestarts: 2,
  withinMs: 60_000,
});
const left = spawn(fallibleCounter, 10, {supervisor: root});
const right = spawn(fallibleCounter, 100, {supervisor: root});
const outside = spawn(counter, 1);

const app = new Hono();
app.onError(() => new Response("internal server error", {status: 500}));
app.get("/supervision/left/add", async context => context.text(await left.ask(5)));
app.get("/supervision/left/read", async context => context.text(await left.ask(0)));
app.get("/supervision/left/fail", async context => context.text(await left.ask(-999)));
app.get("/supervision/right/add", async context => context.text(await right.ask(7)));
app.get("/supervision/right/read", async context => context.text(await right.ask(0)));
app.get("/supervision/right/fail", async context => context.text(await right.ask(-999)));
app.get("/supervision/outside/add", async context => context.text(await outside.ask(1)));
app.get("/supervision/outside/read", async context => context.text(await outside.ask(0)));

serve({fetch: app.fetch});
