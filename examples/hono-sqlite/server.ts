import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const app = new Hono();

app.post("/schema", async context => {
  await database.exec("CREATE TABLE IF NOT EXISTS posts (title TEXT PRIMARY KEY)");
  return context.text("ready");
});
app.post("/seed", async context => {
  await database.exec("INSERT INTO posts (title) VALUES ('Morning')");
  return context.text("created", 201);
});
app.post("/close", context => {
  database.close();
  return context.text("closed");
});

serve({fetch: app.fetch});
