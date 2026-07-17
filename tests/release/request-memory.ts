import {serve} from "tinytsx:serve";
import {Hono} from "hono";

const app = new Hono();
app.get("/", context => context.text("ok"));
app.get("/large", context => context.text("larger than eight bytes"));
serve(app);
