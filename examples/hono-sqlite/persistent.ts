import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database("state.db");
const values = database.prepare("SELECT value FROM values_table ORDER BY rowid");
const insertValue = database.prepare("INSERT INTO values_table (value) VALUES (?1)");
const app = new Hono();

app.post("/schema", async context => {
  await database.exec("CREATE TABLE IF NOT EXISTS values_table (value TEXT NOT NULL)");
  return context.text("ready");
});
app.post("/values", async context => {
  const input = await context.req.json() as {value: string};
  await insertValue.run([input.value]);
  return context.json({ok: true}, 201);
});
app.get("/values", async context => context.json({values: await values.all()}));
app.post("/transaction-success", async context => {
  await database.transaction(
    "INSERT INTO values_table (value) VALUES ('first'); INSERT INTO values_table (value) VALUES ('second')",
  );
  return context.json({ok: true});
});
app.post("/transaction-failure", async context => {
  await database.transaction(
    "INSERT INTO values_table (value) VALUES ('rolled-back'); INSERT INTO values_table (value) VALUES (NULL)",
  );
  return context.json({ok: true});
});

serve({fetch: app.fetch});
