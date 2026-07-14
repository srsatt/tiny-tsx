// First route from https://github.com/honojs/examples/tree/main/basic.
import {Hono} from "hono";

const app = new Hono();

app.get("/", context => context.text("Hono!!"));

export default app;
