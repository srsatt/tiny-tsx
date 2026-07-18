import {Hono} from "hono";
import {poweredBy} from "hono/powered-by";
import {readTextFile} from "tinytsx:fs";

const app = new Hono();

app.use("*", poweredBy());
app.get("/large-file", async context => context.text(
  await readTextFile("context.ts", {maxBytes: 32_768}),
));

export default app;
