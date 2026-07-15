import {Hono} from "hono";
import {streamText} from "hono/streaming";

const app = new Hono();
app.get("/stream", context => streamText(context, async stream => {
  await stream.write("first\n");
  await stream.write("second\n");
  await stream.write("third\n");
}));

export default app;
