// Runtime-fetch route from https://github.com/honojs/examples/tree/main/basic.
import {Hono} from "hono";

const app = new Hono();

app.get("/fetch-url", async context => {
  const response = await fetch("https://example.com/");
  return context.text(`https://example.com/ is ${response.status}`);
});

export default app;
