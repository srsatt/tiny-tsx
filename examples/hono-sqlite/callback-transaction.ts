import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const insertItem = database.prepare("INSERT INTO items (id, value) VALUES (?1, ?2)");
const insertAudit = database.prepare("INSERT INTO audit (id) VALUES (?1)");
const findItem = database.prepare("SELECT id, value FROM items WHERE id = ?1");
const findAudit = database.prepare("SELECT id FROM audit WHERE id = ?1");
const app = new Hono();

app.post("/schema", async context => {
  await database.exec(
    "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY); INSERT OR IGNORE INTO audit (id) VALUES ('blocked')",
  );
  return context.text("ready");
});

app.post("/transaction/:id", async context => {
  const input = await context.req.json() as {value: string};
  await database.transaction(async () => {
    await insertItem.run([context.req.param("id"), input.value]);
    await insertAudit.run([context.req.param("id")]);
  });
  return context.json({ok: true}, 201);
});

app.get("/items/:id", async context => {
  const item = await findItem.get([context.req.param("id")]);
  if (!item) return context.json({error: "Not Found"}, 404);
  return context.json({item});
});

app.get("/audit/:id", async context => {
  const audit = await findAudit.get([context.req.param("id")]);
  if (!audit) return context.json({error: "Not Found"}, 404);
  return context.json({audit});
});

serve({fetch: app.fetch});
