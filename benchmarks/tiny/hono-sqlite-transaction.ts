import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const writeValue = database.prepare(
  "INSERT OR REPLACE INTO benchmark_values (id, value) VALUES (?1, ?2)",
);
const writeAudit = database.prepare(
  "INSERT OR REPLACE INTO benchmark_audit (id) VALUES (?1)",
);
const readValue = database.prepare(
  "SELECT id, value FROM benchmark_values ORDER BY id LIMIT 1",
);
const app = new Hono();

app.get("/sqlite-transaction", async context => {
  await database.exec(
    "CREATE TABLE IF NOT EXISTS benchmark_values (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS benchmark_audit (id TEXT PRIMARY KEY)",
  );
  await database.transaction(async () => {
    await writeValue.run(["stable", "ready"]);
    await writeAudit.run(["stable"]);
  });
  return context.json({value: await readValue.get()});
});

export default app;
