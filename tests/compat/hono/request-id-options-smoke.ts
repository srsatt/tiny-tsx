import {Hono} from "hono";
import {requestId} from "hono/request-id";

const app = new Hono();

app.use("/custom-request-id", requestId({
  headerName: "Hono-Request-Id",
  limitLength: 16,
}));
app.get("/custom-request-id", context => context.text(
  context.get("requestId") ?? "No Request ID",
));

export default app;
