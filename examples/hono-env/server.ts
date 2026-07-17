import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {get, require as requireEnvironment} from "tinytsx:env";

type Bindings = {
  TINYTSX_TEST_PRESENT: string;
  TINYTSX_TEST_REQUIRED: string;
};

const app = new Hono<{Bindings: Bindings}>();

app.get("/present", context => context.text(context.env.TINYTSX_TEST_PRESENT));
app.get("/fallback", context => context.text(get("TINYTSX_TEST_MISSING") ?? "fallback"));
app.get("/required", context => context.text(context.env.TINYTSX_TEST_REQUIRED));
app.get("/required-explicit", context => context.text(
  requireEnvironment("TINYTSX_TEST_REQUIRED"),
));

serve({fetch: app.fetch});
