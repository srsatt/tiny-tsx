import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {spawn} from "tinytsx:actors";

const actor0 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor1 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor2 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor3 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor4 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor5 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor6 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);
const actor7 = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0);

const app = new Hono();

app.get("/actor/0/tell", context => { actor0.tell(1); return context.text("queued"); });
app.get("/actor/1/tell", context => { actor1.tell(1); return context.text("queued"); });
app.get("/actor/2/tell", context => { actor2.tell(1); return context.text("queued"); });
app.get("/actor/3/tell", context => { actor3.tell(1); return context.text("queued"); });
app.get("/actor/4/tell", context => { actor4.tell(1); return context.text("queued"); });
app.get("/actor/5/tell", context => { actor5.tell(1); return context.text("queued"); });
app.get("/actor/6/tell", context => { actor6.tell(1); return context.text("queued"); });
app.get("/actor/7/tell", context => { actor7.tell(1); return context.text("queued"); });

app.get("/actor/0/read", async context => context.text(await actor0.ask(0)));
app.get("/actor/1/read", async context => context.text(await actor1.ask(0)));
app.get("/actor/2/read", async context => context.text(await actor2.ask(0)));
app.get("/actor/3/read", async context => context.text(await actor3.ask(0)));
app.get("/actor/4/read", async context => context.text(await actor4.ask(0)));
app.get("/actor/5/read", async context => context.text(await actor5.ask(0)));
app.get("/actor/6/read", async context => context.text(await actor6.ask(0)));
app.get("/actor/7/read", async context => context.text(await actor7.ask(0)));

serve({fetch: app.fetch});
