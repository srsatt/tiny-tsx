// Root behavior from the pinned complete Hono basic example.
import {Hono} from "hono";
import {poweredBy} from "hono/powered-by";

const app = new Hono();

app.use("*", poweredBy());
app.get("/", context => context.text("Hono!!"));

export default app;
