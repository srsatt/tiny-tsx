import {Database} from "bun:sqlite";
import {Hono} from "hono";

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
const path = Bun.env.TINYTSX_BENCH_SQLITE_PATH;
if (!Number.isInteger(port) || port < 1 || port > 65_535 || path === undefined) {
  throw new Error("valid TINYTSX_BENCH_PORT and TINYTSX_BENCH_SQLITE_PATH are required");
}

const database = new Database(path, {create: true, strict: true});
database.exec(
  "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=1000; CREATE TABLE IF NOT EXISTS rollback_payments (key TEXT PRIMARY KEY, account TEXT NOT NULL, amount INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rollback_audit (key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS rollback_state (id TEXT PRIMARY KEY, committed INTEGER NOT NULL); INSERT OR IGNORE INTO rollback_audit (key) VALUES ('blocked'); INSERT OR IGNORE INTO rollback_state (id, committed) VALUES ('state', 0)",
);
const insertPayment = database.query(
  "INSERT INTO rollback_payments (key, account, amount) VALUES (?1, ?2, ?3)",
);
const upsertPayment = database.query(
  "INSERT OR REPLACE INTO rollback_payments (key, account, amount) VALUES (?1, ?2, ?3)",
);
const insertAudit = database.query("INSERT INTO rollback_audit (key) VALUES (?1)");
const upsertAudit = database.query("INSERT OR REPLACE INTO rollback_audit (key) VALUES (?1)");
const recordRecovery = database.query(
  "UPDATE rollback_state SET committed = committed + 1 WHERE id = 'state'",
);
const readState = database.query(
  "SELECT (SELECT COUNT(*) FROM rollback_payments WHERE key = 'benchmark-key') AS partialRows, committed FROM rollback_state WHERE id = 'state'",
);
const readJournal = database.query("PRAGMA journal_mode");
const failTransaction = database.transaction((key: string, account: string, amount: number) => {
  insertPayment.run(key, account, amount);
  insertAudit.run("blocked");
});
const recoverTransaction = database.transaction((key: string, amount: number) => {
  upsertPayment.run(key, "recovery", amount);
  upsertAudit.run(key);
  recordRecovery.run();
});
const app = new Hono();

app.onError((_error, context) => context.text("internal server error", 500));
app.get("/sqlite-rollback/setup", context => {
  database.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=1000; CREATE TABLE IF NOT EXISTS rollback_payments (key TEXT PRIMARY KEY, account TEXT NOT NULL, amount INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rollback_audit (key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS rollback_state (id TEXT PRIMARY KEY, committed INTEGER NOT NULL); INSERT OR IGNORE INTO rollback_audit (key) VALUES ('blocked'); INSERT OR IGNORE INTO rollback_state (id, committed) VALUES ('state', 0)",
  );
  return context.text("ready");
});
app.post("/sqlite-rollback/fail/:account", async context => {
  const input = await context.req.json<{amount: number}>();
  failTransaction(context.req.header("Idempotency-Key")!, context.req.param("account"), input.amount);
  return context.text("unreachable");
});
app.post("/sqlite-rollback/recover", async context => {
  const input = await context.req.json<{amount: number}>();
  recoverTransaction(context.req.header("Idempotency-Key")!, input.amount);
  return context.text("recovered");
});
app.get("/sqlite-rollback/state", context => context.json({state: readState.get()}));
app.get("/sqlite-rollback/journal", context => context.json({journal: readJournal.get()}));

const server = Bun.serve({hostname: "127.0.0.1", port, development: false, fetch: app.fetch});

export async function stop(): Promise<void> {
  await server.stop(true);
  database.close();
}
