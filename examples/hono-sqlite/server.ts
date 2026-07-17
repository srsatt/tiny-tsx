import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {Database} from "tinytsx:sqlite";

const database = new Database(":memory:");
const posts = database.prepare("SELECT title, body FROM posts ORDER BY title");
const post = database.prepare("SELECT title, body FROM posts WHERE title = ?1");
const deletePost = database.prepare("DELETE FROM posts WHERE title = ?1");
const createPost = database.prepare("INSERT INTO posts (title, body) VALUES (?1, ?2)");
const updatePost = database.prepare("UPDATE posts SET body = ?1 WHERE title = ?2");
const latestPost = database.prepare("SELECT title, body FROM posts ORDER BY rowid DESC LIMIT 1");
const app = new Hono();

app.post("/schema", async context => {
  await database.exec("CREATE TABLE IF NOT EXISTS posts (title TEXT PRIMARY KEY, body TEXT)");
  return context.text("ready");
});
app.post("/seed", async context => {
  await database.exec("INSERT INTO posts (title) VALUES ('Morning')");
  return context.text("created", 201);
});
app.post("/bad-sql", async context => {
  await database.exec("THIS IS NOT SQL");
  return context.text("unreachable");
});
app.get("/posts", async context => context.json({posts: await posts.all()}));
app.get("/first", async context => context.json({post: await posts.get()}));
app.get("/posts/:title", async context => context.json({
  post: await post.get([context.req.param("title")]),
}));
app.post("/posts", async context => {
  const input = await context.req.json() as {title: string; body: string};
  await createPost.run([input.title, input.body]);
  return context.json({post: await latestPost.get()}, 201);
});
app.put("/posts/:title", async context => {
  const input = await context.req.json() as {body: string};
  await updatePost.run([input.body, context.req.param("title")]);
  return context.json({post: await post.get([context.req.param("title")])});
});
app.delete("/posts/:title", async context => {
  await deletePost.run([context.req.param("title")]);
  return context.text("deleted");
});
app.post("/close", context => {
  database.close();
  return context.text("closed");
});

serve({fetch: app.fetch});
