import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

interface ProfileInput {
  profile: {
    name: string;
    preferences: {
      theme: string;
      alerts: boolean;
    };
  };
  score: number | null;
}

const database = new Database(":memory:");
const insertUser = database.prepare(
  "INSERT INTO users (id, name, score) VALUES (?1, ?2, ?3)",
);
const insertPreferences = database.prepare(
  "INSERT INTO preferences (user_id, theme, alerts) VALUES (?1, ?2, ?3)",
);
const findProfile = database.prepare(
  "SELECT users.id, users.name, users.score, preferences.theme, preferences.alerts FROM users JOIN preferences ON preferences.user_id = users.id WHERE users.id = ?1",
);
const app = new Hono();

app.onError((_error, context) => context.text("internal server error", 500));

app.post("/profiles/schema", async context => {
  await database.exec(
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, score REAL); CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY, theme TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL)",
  );
  return context.text("ready");
});

app.post("/profiles/:id", async context => {
  const input = await context.req.json() as ProfileInput;
  await database.transaction(async () => {
    await insertUser.run([
      context.req.param("id"),
      input.profile.name,
      input.score,
    ]);
    await insertPreferences.run([
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

app.get("/profiles/:id", async context => {
  const profile = await findProfile.get([context.req.param("id")]);
  if (!profile) return context.json({error: "Not Found"}, 404);
  return context.json({profile});
});

serve({fetch: app.fetch});
