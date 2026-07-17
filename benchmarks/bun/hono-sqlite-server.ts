import {Database} from "bun:sqlite";
import {Hono} from "hono";

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

const database = new Database(":memory:");
let values: ReturnType<Database["query"]> | undefined;
const app = new Hono();
app.get("/sqlite", context => {
  database.exec("CREATE TABLE IF NOT EXISTS benchmark_values (value TEXT NOT NULL)");
  values ??= database.query("SELECT value FROM benchmark_values ORDER BY value");
  return context.json({values: values.all()});
});

Bun.serve({hostname: "127.0.0.1", port, development: false, fetch: app.fetch});
