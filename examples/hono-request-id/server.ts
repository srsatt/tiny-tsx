import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {requestId} from "hono/request-id";

const app = new Hono();

app.use("*", requestId());
app.get("/request-id", context => context.text(
  context.get("requestId") ?? "No Request ID",
));

serve({fetch: app.fetch});
