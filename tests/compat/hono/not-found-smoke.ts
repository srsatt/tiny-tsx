import {Hono} from "hono";

const app = new Hono();

app.get("/", context => context.text("Home"));
app.notFound(context => context.text("Custom 404 Not Found", 404));

export default app;
