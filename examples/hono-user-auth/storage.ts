import {Database} from "tinytsx:sqlite";

export const database = new Database("auth-state.db");
export const events = database.prepare(
  "SELECT username FROM auth_events ORDER BY rowid",
);
export const recordEvent = database.prepare(
  "INSERT INTO auth_events (username) VALUES (?1)",
);

