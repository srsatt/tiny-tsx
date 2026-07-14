import {Hono} from "hono/tiny";

const app = new Hono();

app.get("/", context => context.text("Hello from Hono"));

export default app;
