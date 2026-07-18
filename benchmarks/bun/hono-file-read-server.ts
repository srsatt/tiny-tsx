import {Hono} from "hono";
import {poweredBy} from "hono/powered-by";

const asset = new URL(
  "../../vendor/hono-examples/serve-static/assets/my-file.txt",
  import.meta.url,
);
const app = new Hono();

app.use("*", poweredBy());
app.get("/my-file.txt", async context => context.text(await Bun.file(asset).text()));

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  fetch: app.fetch,
});
