const body = "<html><body><h1>Hello from TinyTSX</h1></body></html>";
const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  fetch() {
    return new Response(body, {
      status: 200,
      headers: {"Content-Type": "text/html; charset=utf-8"},
    });
  },
});

