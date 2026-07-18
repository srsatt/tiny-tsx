import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {secureHeaders} from "hono/secure-headers";

const app = new Hono();

app.use("*", secureHeaders());
app.get("/", context => context.text("secure"));

serve({fetch: app.fetch});
