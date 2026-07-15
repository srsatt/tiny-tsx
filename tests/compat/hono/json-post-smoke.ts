import {Hono} from "hono";

const app = new Hono();

app.post("/api/posts", (c) => c.json({message: "Created!"}, 201));

export default app;
