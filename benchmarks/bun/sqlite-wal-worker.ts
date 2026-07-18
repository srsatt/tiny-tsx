import {Database} from "bun:sqlite";

type Operation = "close" | "journal" | "setup" | "state" | "transaction";
type Request = {id: number; operation: Operation; databasePath?: string};
type State = {
  database: Database;
  transaction: () => void;
};

let state: State | undefined;

function initialize(databasePath: string): State {
  const database = new Database(databasePath, {create: true});
  return {
    database,
    transaction: database.transaction(() => {
      database.exec(
        "SAVEPOINT rollback_probe; UPDATE benchmark_state SET rolled_back = rolled_back + 1 WHERE id = 'state'; ROLLBACK TO rollback_probe; RELEASE rollback_probe; UPDATE benchmark_state SET committed = committed + 1 WHERE id = 'state'",
      );
    }),
  };
}

function requireState(): State {
  if (state === undefined) throw new Error("the SQLite WAL worker is not initialized");
  return state;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const {id, operation, databasePath} = event.data;
  try {
    let output = "";
    if (operation === "setup") {
      if (state === undefined) {
        if (databasePath === undefined || databasePath.length === 0) {
          throw new Error("the SQLite WAL worker requires a database path");
        }
        state = initialize(databasePath);
      }
      state.database.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=1000; CREATE TABLE IF NOT EXISTS benchmark_state (id TEXT PRIMARY KEY, committed INTEGER NOT NULL, rolled_back INTEGER NOT NULL); INSERT OR IGNORE INTO benchmark_state (id, committed, rolled_back) VALUES ('state', 0, 0)",
      );
      output = "ready";
    } else if (operation === "transaction") {
      requireState().transaction();
      output = "committed";
    } else if (operation === "state") {
      output = JSON.stringify({state: requireState().database.query(
        "SELECT committed, rolled_back AS rolledBack FROM benchmark_state WHERE id = 'state'",
      ).get()});
    } else if (operation === "journal") {
      output = JSON.stringify({journal: requireState().database.query("PRAGMA journal_mode").get()});
    } else {
      state?.database.close();
      state = undefined;
      output = "closed";
    }
    postMessage({id, output});
  } catch (error) {
    postMessage({id, error: error instanceof Error ? error.message : String(error)});
  }
};
