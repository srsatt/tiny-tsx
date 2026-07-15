// Exact Basic Auth configuration and route from the pinned complete example.
import {Hono} from "hono";
import {basicAuth} from "hono/basic-auth";

const app = new Hono();

app.use("/auth/*", basicAuth({
  username: "hono",
  password: "acoolproject",
}));

app.get("/auth/*", context => context.text("You are authorized"));

export default app;
