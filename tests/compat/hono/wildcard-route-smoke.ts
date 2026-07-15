import {Hono} from "hono";

const app = new Hono();

app.get("/api/*", (c) => c.text("API endpoint is not found", 404));

export default app;
