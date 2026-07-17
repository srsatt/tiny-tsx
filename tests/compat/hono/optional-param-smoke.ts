// Runtime cases from the pinned Hono "Optional parameters" behavior tests.
import {Hono} from "hono";

const app = new Hono();

app.get("/api/:version/animal/:type?", context => context.json({
  type: context.req.param("type"),
}));

export default app;
