import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {get, require as requireEnvironment} from "tinytsx:env";

const app = new Hono();

app.get("/present", context => context.text(get("TINYTSX_TEST_PRESENT") ?? "fallback"));
app.get("/fallback", context => context.text(get("TINYTSX_TEST_MISSING") ?? "fallback"));
app.get("/required", context => context.text(requireEnvironment("TINYTSX_TEST_REQUIRED")));

serve({fetch: app.fetch});
