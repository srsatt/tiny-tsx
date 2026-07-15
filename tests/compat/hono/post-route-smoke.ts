import {Hono} from "hono";

const app = new Hono();

app.post("/book", (c) => c.text("Create Book"));

export default app;
