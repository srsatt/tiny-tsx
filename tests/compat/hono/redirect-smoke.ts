import {Hono} from "hono";

const app = new Hono();

app.get("/redirect", context => context.redirect("/"));

export default app;
