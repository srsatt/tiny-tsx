// Runtime-fetch route from https://github.com/honojs/examples/tree/main/basic.
import {Hono} from "hono";

const app = new Hono();

app.get("/fetch-url", async context => {
  const url = "https://example.com/";
  const response = await fetch(url);
  return context.text(`${url} is ${response.status}`);
});

export default app;
