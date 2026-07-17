import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const values = database.prepare("SELECT value FROM benchmark_values ORDER BY value");
const app = new Hono();

app.get("/sqlite", async context => {
  await database.exec("CREATE TABLE IF NOT EXISTS benchmark_values (value TEXT NOT NULL)");
  return context.json({values: await values.all()});
});

export default app;
