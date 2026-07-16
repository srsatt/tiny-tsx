import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const posts = database.prepare("SELECT title FROM posts ORDER BY title");
const app = new Hono();

app.post("/schema", async context => {
  await database.exec("CREATE TABLE IF NOT EXISTS posts (title TEXT PRIMARY KEY)");
  return context.text("ready");
});
app.post("/seed", async context => {
  await database.exec("INSERT INTO posts (title) VALUES ('Morning')");
  return context.text("created", 201);
});
app.get("/posts", async context => context.json({posts: await posts.all()}));
app.get("/first", async context => context.json({post: await posts.get()}));
app.post("/close", context => {
  database.close();
  return context.text("closed");
});

serve({fetch: app.fetch});
