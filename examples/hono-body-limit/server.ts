import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {bodyLimit} from "hono/body-limit";

const app = new Hono();

app.use("*", bodyLimit({maxSize: 14}));
app.get("/", context => context.text("index"));
app.post("/body-limit", context => context.text("pass :)"));

serve({fetch: app.fetch});
