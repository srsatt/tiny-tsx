import {Hono} from "hono";

const app = new Hono();

app.onError((error, context) => {
  console.error(`${error}`);
  return context.text("Custom Error Message", 500);
});
app.get("/error", () => {
  throw Error("Error has occurred");
});

export default app;
