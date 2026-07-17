import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {cors} from "hono/cors";
import {Database} from "tinytsx:sqlite";

type Bindings = {
  TINYTSX_BLOG_NAME: string;
};

const database = new Database(":memory:");
const posts = database.prepare("SELECT id, title, body FROM posts ORDER BY title");
const post = database.prepare("SELECT id, title, body FROM posts WHERE id = ?1");
const deletePost = database.prepare("DELETE FROM posts WHERE id = ?1");
const createPost = database.prepare("INSERT INTO posts (id, title, body) VALUES (?1, ?2, ?3)");
const updatePost = database.prepare("UPDATE posts SET title = ?1, body = ?2 WHERE id = ?3");
const latestPost = database.prepare("SELECT id, title, body FROM posts ORDER BY rowid DESC LIMIT 1");
const app = new Hono<{Bindings: Bindings}>();

app.use("/posts/*", cors({allowHeaders: ["Content-Type"]}));
app.get("/config", context => context.text(context.env.TINYTSX_BLOG_NAME));

app.post("/schema", async context => {
  await database.exec("CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT, body TEXT)");
  return context.text("ready");
});
app.post("/seed", async context => {
  await database.exec("INSERT INTO posts (id, title) VALUES ('morning', 'Morning')");
  return context.text("created", 201);
});
app.post("/bad-sql", async context => {
  await database.exec("THIS IS NOT SQL");
  return context.text("unreachable");
});
app.get("/posts", async context => context.json({posts: await posts.all(), ok: true}));
app.get("/first", async context => context.json({post: await posts.get()}));
app.get("/posts/:id", async context => {
  const selected = await post.get([context.req.param("id")]);
  if (!selected) return context.json({error: "Not Found", ok: false}, 404);
  return context.json({post: selected, ok: true});
});
app.post("/posts", async context => {
  const input = await context.req.json() as {title: string; body: string};
  const id = crypto.randomUUID();
  await createPost.run([id, input.title, input.body]);
  return context.json({post: await latestPost.get(), ok: true}, 201);
});
app.put("/posts/:id", async context => {
  const selected = await post.get([context.req.param("id")]);
  if (!selected) return new Response(null, {status: 204});
  const input = await context.req.json() as {title: string; body: string};
  await updatePost.run([input.title, input.body, context.req.param("id")]);
  return context.json({ok: true});
});
app.delete("/posts/:id", async context => {
  const selected = await post.get([context.req.param("id")]);
  if (!selected) return new Response(null, {status: 204});
  await deletePost.run([context.req.param("id")]);
  return context.json({ok: true});
});
app.post("/close", context => {
  database.close();
  return context.text("closed");
});

serve({fetch: app.fetch});
