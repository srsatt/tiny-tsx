import {Hono} from "hono";

const app = new Hono();

app.get("/headers", () => new Response("Headers", {
  headers: {"X-Test": "yes"},
}));

export default app;
