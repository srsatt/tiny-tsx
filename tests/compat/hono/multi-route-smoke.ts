// First two routes from the pinned complete Hono basic example.
import {Hono} from "hono";

const app = new Hono();

app.get("/", context => context.text("Hono!!"));
app.get("/hello", () => new Response("This is /hello"));

export default app;
