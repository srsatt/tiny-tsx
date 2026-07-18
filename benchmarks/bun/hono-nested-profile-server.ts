import {Database} from "bun:sqlite";
import {Hono} from "hono";

interface ProfileInput {
  profile: {
    name: string;
    preferences: {theme: string; alerts: boolean};
  };
  score: number | null;
}

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

const database = new Database(":memory:");
database.exec(
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, score REAL); CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY, theme TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL)",
);
const writeUser = database.query(
  "INSERT OR IGNORE INTO users (id, name, score) VALUES (?1, ?2, ?3)",
);
const writePreferences = database.query(
  "INSERT OR IGNORE INTO preferences (user_id, theme, alerts) VALUES (?1, ?2, ?3)",
);
const writeProfile = database.transaction((id: string, input: ProfileInput) => {
  writeUser.run(id, input.profile.name, input.score);
  writePreferences.run(
    id,
    input.profile.preferences.theme,
    input.profile.preferences.alerts,
  );
});
const app = new Hono();

app.post("/profiles/:id", async context => {
  database.exec(
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, score REAL); CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY, theme TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL)",
  );
  const input = await context.req.json<ProfileInput>();
  const id = context.req.param("id");
  writeProfile(id, input);
  return context.json({id, ...input}, 201);
});

Bun.serve({hostname: "127.0.0.1", port, development: false, fetch: app.fetch});
