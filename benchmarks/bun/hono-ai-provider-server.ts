import app from "../../tests/compat/ai/hono-local-provider-smoke.ts";

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
