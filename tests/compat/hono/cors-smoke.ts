import {Hono} from "hono";
import {cors} from "hono/cors";

const app = new Hono();

app.use("/posts/*", cors());
app.get("/posts", context => context.json({posts: []}));

export default app;
