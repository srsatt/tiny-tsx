import {Hono} from "hono";
import {prettyJSON} from "hono/pretty-json";

const app = new Hono();

app.get(
  "/api/posts",
  prettyJSON(),
  context => context.json([{id: 1, title: "Good Morning"}]),
);

export default app;
