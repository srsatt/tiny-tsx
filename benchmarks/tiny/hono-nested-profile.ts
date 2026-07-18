import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

interface ProfileInput {
  profile: {
    name: string;
    preferences: {theme: string; alerts: boolean};
  };
  score: number | null;
}

const database = new Database(":memory:");
const writeUser = database.prepare(
  "INSERT OR IGNORE INTO users (id, name, score) VALUES (?1, ?2, ?3)",
);
const writePreferences = database.prepare(
  "INSERT OR IGNORE INTO preferences (user_id, theme, alerts) VALUES (?1, ?2, ?3)",
);
const app = new Hono();

app.post("/profiles/:id", async context => {
  await database.exec(
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, score REAL); CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY, theme TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL)",
  );
  const input = await context.req.json() as ProfileInput;
  await database.transaction(async () => {
    await writeUser.run([
      context.req.param("id"),
      input.profile.name,
      input.score,
    ]);
    await writePreferences.run([
      context.req.param("id"),
      input.profile.preferences.theme,
      input.profile.preferences.alerts,
    ]);
  });
  return context.json({
    id: context.req.param("id"),
    profile: {
      name: input.profile.name,
      preferences: {
        theme: input.profile.preferences.theme,
        alerts: input.profile.preferences.alerts,
      },
    },
    score: input.score,
  }, 201);
});

export default app;
