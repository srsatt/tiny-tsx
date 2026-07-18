import {Database} from "bun:sqlite";
import {expect, test} from "bun:test";
import {Hono} from "../../../vendor/hono/src/index.ts";

interface ProfileInput {
  profile: {
    name: string;
    preferences: {theme: string; alerts: boolean};
  };
  score: number | null;
}

const database = new Database(":memory:");
database.exec(
  "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, score REAL); CREATE TABLE preferences (user_id TEXT PRIMARY KEY, theme TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL)",
);
const insertUser = database.query(
  "INSERT INTO users (id, name, score) VALUES (?1, ?2, ?3)",
);
const insertPreferences = database.query(
  "INSERT INTO preferences (user_id, theme, alerts) VALUES (?1, ?2, ?3)",
);
const findProfile = database.query(
  "SELECT users.id, users.name, users.score, preferences.theme, preferences.alerts FROM users JOIN preferences ON preferences.user_id = users.id WHERE users.id = ?1",
);
const commitProfile = database.transaction((id: string, input: ProfileInput) => {
  insertUser.run(id, input.profile.name, input.score);
  insertPreferences.run(
    id,
    input.profile.preferences.theme,
    input.profile.preferences.alerts,
  );
});
const app = new Hono();

app.onError((_error, context) => context.text("internal server error", 500));

app.post("/profiles/:id", async context => {
  let input: ProfileInput;
  try {
    input = await context.req.json<ProfileInput>();
  } catch {
    return context.text("bad request", 400);
  }
  if (!validProfile(input)) return context.text("bad request", 400);
  commitProfile(context.req.param("id"), input);
  return context.json({id: context.req.param("id"), ...input}, 201);
});

app.get("/profiles/:id", context => {
  const profile = findProfile.get(context.req.param("id"));
  if (!profile) return context.json({error: "Not Found"}, 404);
  return context.json({profile});
});

test("Bun and Hono match nested profile commit, rollback, bounds, and recovery", async () => {
  const valid = {
    profile: {
      name: "Alice",
      preferences: {theme: "dark", alerts: true},
    },
    score: 7,
  };
  expect(await post("alice", valid)).toEqual({
    status: 201,
    body: JSON.stringify({id: "alice", ...valid}),
  });
  expect(await get("alice")).toEqual({
    status: 200,
    body: JSON.stringify({
      profile: {id: "alice", name: "Alice", score: 7, theme: "dark", alerts: 1},
    }),
  });
  expect(await post("rolled-back", {
    profile: {
      name: "Rollback",
      preferences: {theme: "dark", alerts: false},
    },
    score: null,
  })).toEqual({status: 500, body: "internal server error"});
  expect(await get("rolled-back")).toEqual({
    status: 404,
    body: '{"error":"Not Found"}',
  });
  expect(await postRaw("malformed", "{")).toEqual({status: 400, body: "bad request"});
  expect(await post("missing", {
    profile: {name: "Missing", preferences: {alerts: true}},
    score: 1,
  })).toEqual({status: 400, body: "bad request"});
  expect(await post("oversized", {
    profile: {
      name: "x".repeat(4_097),
      preferences: {theme: "oversized", alerts: true},
    },
    score: 1,
  })).toEqual({status: 400, body: "bad request"});
  expect(await post("recovered", {
    profile: {
      name: "Recovered",
      preferences: {theme: "light", alerts: false},
    },
    score: null,
  })).toEqual({
    status: 201,
    body: '{"id":"recovered","profile":{"name":"Recovered","preferences":{"theme":"light","alerts":false}},"score":null}',
  });
});

function validProfile(input: unknown): input is ProfileInput {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Partial<ProfileInput>;
  const profile = candidate.profile;
  const preferences = profile?.preferences;
  return typeof profile?.name === "string"
    && new TextEncoder().encode(profile.name).length <= 4_096
    && typeof preferences?.theme === "string"
    && new TextEncoder().encode(preferences.theme).length <= 4_096
    && typeof preferences.alerts === "boolean"
    && (candidate.score === null
      || typeof candidate.score === "number" && Number.isFinite(candidate.score));
}

async function post(id: string, input: unknown) {
  return postRaw(id, JSON.stringify(input));
}

async function postRaw(id: string, body: string) {
  const response = await app.request(`/profiles/${id}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body,
  });
  return {status: response.status, body: await response.text()};
}

async function get(id: string) {
  const response = await app.request(`/profiles/${id}`);
  return {status: response.status, body: await response.text()};
}
