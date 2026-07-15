import {Hono} from "hono";

const app = new Hono();

app.get("/entry/:id", (c) => {
  const id = c.req.param("id");
  return c.text(`Your ID is ${id}`);
});

export default app;
