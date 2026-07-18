import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database("rollback-load.db");
const insertPayment = database.prepare(
  "INSERT INTO rollback_payments (key, account, amount) VALUES (?1, ?2, ?3)",
);
const upsertPayment = database.prepare(
  "INSERT OR REPLACE INTO rollback_payments (key, account, amount) VALUES (?1, ?2, ?3)",
);
const insertAudit = database.prepare("INSERT INTO rollback_audit (key) VALUES (?1)");
const upsertAudit = database.prepare("INSERT OR REPLACE INTO rollback_audit (key) VALUES (?1)");
const recordRecovery = database.prepare(
  "UPDATE rollback_state SET committed = committed + 1 WHERE id = 'state'",
);
const readState = database.prepare(
  "SELECT (SELECT COUNT(*) FROM rollback_payments WHERE key = 'benchmark-key') AS partialRows, committed FROM rollback_state WHERE id = 'state'",
);
const readJournal = database.prepare("PRAGMA journal_mode");
const app = new Hono();

app.onError((_error, context) => context.text("internal server error", 500));

app.get("/sqlite-rollback/setup", async context => {
  await database.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=1000; CREATE TABLE IF NOT EXISTS rollback_payments (key TEXT PRIMARY KEY, account TEXT NOT NULL, amount INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rollback_audit (key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS rollback_state (id TEXT PRIMARY KEY, committed INTEGER NOT NULL); INSERT OR IGNORE INTO rollback_audit (key) VALUES ('blocked'); INSERT OR IGNORE INTO rollback_state (id, committed) VALUES ('state', 0)",
  );
  return context.text("ready");
});

app.post("/sqlite-rollback/fail/:account", async context => {
  const input = await context.req.json() as {amount: number};
  const key = context.req.header("Idempotency-Key")!;
  await database.transaction(async () => {
    await insertPayment.run([key, context.req.param("account"), input.amount]);
    await insertAudit.run(["blocked"]);
  });
  return context.text("unreachable");
});

app.post("/sqlite-rollback/recover", async context => {
  const input = await context.req.json() as {amount: number};
  const key = context.req.header("Idempotency-Key")!;
  await database.transaction(async () => {
    await upsertPayment.run([key, "recovery", input.amount]);
    await upsertAudit.run([key]);
    await recordRecovery.run();
  });
  return context.text("recovered");
});

app.get("/sqlite-rollback/state", async context => context.json({state: await readState.get()}));
app.get("/sqlite-rollback/journal", async context => context.json({journal: await readJournal.get()}));

export default app;
