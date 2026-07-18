import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const first = new Database("wal-load.db");
const second = new Database("wal-load.db");
const readState = first.prepare(
  "SELECT committed, rolled_back AS rolledBack FROM benchmark_state WHERE id = 'state'",
);
const readJournal = first.prepare("PRAGMA journal_mode");
const app = new Hono();

app.get("/sqlite-wal/setup/0", async context => {
  await first.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=1000; CREATE TABLE IF NOT EXISTS benchmark_state (id TEXT PRIMARY KEY, committed INTEGER NOT NULL, rolled_back INTEGER NOT NULL); INSERT OR IGNORE INTO benchmark_state (id, committed, rolled_back) VALUES ('state', 0, 0)",
  );
  return context.text("ready");
});
app.get("/sqlite-wal/setup/1", async context => {
  await second.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=1000; CREATE TABLE IF NOT EXISTS benchmark_state (id TEXT PRIMARY KEY, committed INTEGER NOT NULL, rolled_back INTEGER NOT NULL); INSERT OR IGNORE INTO benchmark_state (id, committed, rolled_back) VALUES ('state', 0, 0)",
  );
  return context.text("ready");
});
app.get("/sqlite-wal/0", async context => {
  await first.transaction(
    "SAVEPOINT rollback_probe; UPDATE benchmark_state SET rolled_back = rolled_back + 1 WHERE id = 'state'; ROLLBACK TO rollback_probe; RELEASE rollback_probe; UPDATE benchmark_state SET committed = committed + 1 WHERE id = 'state'",
  );
  return context.text("committed");
});
app.get("/sqlite-wal/1", async context => {
  await second.transaction(
    "SAVEPOINT rollback_probe; UPDATE benchmark_state SET rolled_back = rolled_back + 1 WHERE id = 'state'; ROLLBACK TO rollback_probe; RELEASE rollback_probe; UPDATE benchmark_state SET committed = committed + 1 WHERE id = 'state'",
  );
  return context.text("committed");
});
app.get("/sqlite-wal/state", async context => context.json({state: await readState.get()}));
app.get("/sqlite-wal/journal", async context => context.json({journal: await readJournal.get()}));

export default app;
