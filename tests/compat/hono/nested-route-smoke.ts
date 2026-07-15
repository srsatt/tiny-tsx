import {Hono} from "hono";

const app = new Hono();
const book = new Hono();

book.get("/", (c) => c.text("List Books"));
book.get("/:id", (c) => {
  const id = c.req.param("id");
  return c.text("Get Book: " + id);
});
app.route("/book", book);

export default app;
