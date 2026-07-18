import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const insertPayment = database.prepare(
  "INSERT INTO payments (key, account, amount) VALUES (?1, ?2, ?3)",
);
const insertAudit = database.prepare("INSERT INTO payment_audit (key) VALUES (?1)");
const findPayment = database.prepare(
  "SELECT key, account, amount FROM payments WHERE key = ?1",
);
const findAudit = database.prepare("SELECT key FROM payment_audit WHERE key = ?1");
const app = new Hono();

app.post("/idempotency/schema", async context => {
  await database.exec(
    "CREATE TABLE IF NOT EXISTS payments (key TEXT PRIMARY KEY, account TEXT NOT NULL, amount INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS payment_audit (key TEXT PRIMARY KEY); INSERT OR IGNORE INTO payment_audit (key) VALUES ('blocked')",
  );
  return context.text("ready");
});

app.post("/idempotency/succeed/:account", async context => {
  const input = await context.req.json() as {amount: number};
  const key = context.req.header("Idempotency-Key")!;
  await database.transaction(async () => {
    await insertPayment.run([key, context.req.param("account"), input.amount]);
    await insertAudit.run([key]);
  });
  return context.json({ok: true}, 201);
});

app.post("/idempotency/fail/:account", async context => {
  const input = await context.req.json() as {amount: number};
  const key = context.req.header("Idempotency-Key")!;
  await database.transaction(async () => {
    await insertPayment.run([key, context.req.param("account"), input.amount]);
    await insertAudit.run(["blocked"]);
  });
  return context.json({ok: true}, 201);
});

app.get("/idempotency/payment/:key", async context => {
  const payment = await findPayment.get([context.req.param("key")]);
  if (!payment) return context.json({error: "Not Found"}, 404);
  return context.json({payment});
});

app.get("/idempotency/audit/:key", async context => {
  const audit = await findAudit.get([context.req.param("key")]);
  if (!audit) return context.json({error: "Not Found"}, 404);
  return context.json({audit});
});

export default app;
