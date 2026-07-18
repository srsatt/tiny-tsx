import {Database} from "bun:sqlite";
import {Hono} from "hono";

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

const database = new Database(":memory:");
database.exec(
  "CREATE TABLE IF NOT EXISTS benchmark_values (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS benchmark_audit (id TEXT PRIMARY KEY)",
);
const writeValue = database.query(
  "INSERT OR REPLACE INTO benchmark_values (id, value) VALUES (?1, ?2)",
);
const writeAudit = database.query(
  "INSERT OR REPLACE INTO benchmark_audit (id) VALUES (?1)",
);
const readValue = database.query(
  "SELECT id, value FROM benchmark_values ORDER BY id LIMIT 1",
);
const writeTransaction = database.transaction(() => {
  writeValue.run("stable", "ready");
  writeAudit.run("stable");
});
const app = new Hono();

app.get("/sqlite-transaction", context => {
  database.exec(
    "CREATE TABLE IF NOT EXISTS benchmark_values (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS benchmark_audit (id TEXT PRIMARY KEY)",
  );
  writeTransaction();
  return context.json({value: readValue.get()});
});

Bun.serve({hostname: "127.0.0.1", port, development: false, fetch: app.fetch});
