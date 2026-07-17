import {Database} from "bun:sqlite";
import {describe, expect, test} from "bun:test";
import {Hono} from "../../../vendor/hono/src/index.ts";
import {cors} from "../../../vendor/hono/src/middleware/cors/index.ts";

type Bindings = {
  TINYTSX_BLOG_NAME: string;
};

const database = new Database(":memory:");
database.exec("CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT, body TEXT)");

const posts = database.query("SELECT id, title, body FROM posts ORDER BY title");
const post = database.query("SELECT id, title, body FROM posts WHERE id = ?1");
const createPost = database.query("INSERT INTO posts (id, title, body) VALUES (?1, ?2, ?3)");
const updatePost = database.query("UPDATE posts SET title = ?1, body = ?2 WHERE id = ?3");
const deletePost = database.query("DELETE FROM posts WHERE id = ?1");
const latestPost = database.query("SELECT id, title, body FROM posts ORDER BY rowid DESC LIMIT 1");
const app = new Hono<{Bindings: Bindings}>();

app.use("/posts/*", cors({allowHeaders: ["Content-Type"]}));
app.get("/config", context => context.text(context.env.TINYTSX_BLOG_NAME));

app.get("/posts", context => context.json({posts: posts.all(), ok: true}));
app.get("/posts/:id", context => {
  const selected = post.get(context.req.param("id"));
  if (!selected) return context.json({error: "Not Found", ok: false}, 404);
  return context.json({post: selected, ok: true});
});
app.post("/posts", async context => {
  const input = await context.req.json<{title: string; body: string}>();
  createPost.run(crypto.randomUUID(), input.title, input.body);
  return context.json({post: latestPost.get(), ok: true}, 201);
});
app.put("/posts/:id", async context => {
  const selected = post.get(context.req.param("id"));
  if (!selected) return new Response(null, {status: 204});
  const input = await context.req.json<{title: string; body: string}>();
  updatePost.run(input.title, input.body, context.req.param("id"));
  return context.json({ok: true});
});
app.delete("/posts/:id", context => {
  const selected = post.get(context.req.param("id"));
  if (!selected) return new Response(null, {status: 204});
  deletePost.run(context.req.param("id"));
  return context.json({ok: true});
});

describe("bounded SQLite Hono adapter reference", () => {
  test("reads the typed Hono environment binding", async () => {
    const response = await app.request("/config", {}, {TINYTSX_BLOG_NAME: "Tiny Blog"});
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Tiny Blog");
  });

  test("matches the native create, list, get, update, delete, and missing contract", async () => {
    expect(await json("GET", "/posts")).toEqual({status: 200, body: {posts: [], ok: true}});
    const created = await json("POST", "/posts", {title: "Night", body: "Good Night"});
    expect(created.status).toBe(201);
    const createdPost = (created.body as {post: {id: string; title: string; body: string}}).post;
    expect(createdPost.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(createdPost).toEqual({
      id: createdPost.id,
      title: "Night",
      body: "Good Night",
    });
    expect(await json("GET", "/posts")).toEqual({
      status: 200,
      body: {posts: [{id: createdPost.id, title: "Night", body: "Good Night"}], ok: true},
    });
    expect(await json("GET", `/posts/${createdPost.id}`)).toEqual({
      status: 200,
      body: {post: {id: createdPost.id, title: "Night", body: "Good Night"}, ok: true},
    });
    expect(await json("PUT", `/posts/${createdPost.id}`, {
      title: "Late Night",
      body: "Still Night",
    })).toEqual({
      status: 200,
      body: {ok: true},
    });

    const removed = await app.request(`/posts/${createdPost.id}`, {method: "DELETE"});
    expect({status: removed.status, body: await removed.text()}).toEqual({
      status: 200,
      body: '{"ok":true}',
    });
    expect(await json("GET", `/posts/${createdPost.id}`)).toEqual({
      status: 404,
      body: {error: "Not Found", ok: false},
    });
    expect(await app.request(`/posts/${createdPost.id}`, {method: "DELETE"}).then(async response => ({
      status: response.status,
      body: await response.text(),
    }))).toEqual({status: 204, body: ""});
    expect(await app.request(`/posts/${createdPost.id}`, {
      method: "PUT",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({title: "Missing", body: "Missing"}),
    }).then(async response => ({status: response.status, body: await response.text()})))
      .toEqual({status: 204, body: ""});
  });

  test("matches the native default-origin CORS and preflight contract", async () => {
    const response = await app.request("/posts");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const preflight = await app.request("/posts", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-headers": "Content-Type",
        "access-control-request-method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe(
      "GET,HEAD,PUT,POST,DELETE,PATCH",
    );
    expect(preflight.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(preflight.headers.get("vary")).toBe("Access-Control-Request-Headers");
  });
});

async function json(method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : {headers: {"content-type": "application/json"}, body: JSON.stringify(body)}),
  });
  return {status: response.status, body: await response.json()};
}
