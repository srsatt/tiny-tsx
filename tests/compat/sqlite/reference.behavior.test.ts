import {Database} from "bun:sqlite";
import {describe, expect, test} from "bun:test";
import {Hono} from "../../../vendor/hono/src/index.ts";

const database = new Database(":memory:");
database.exec("CREATE TABLE posts (title TEXT PRIMARY KEY, body TEXT)");

const posts = database.query("SELECT title, body FROM posts ORDER BY title");
const post = database.query("SELECT title, body FROM posts WHERE title = ?1");
const createPost = database.query("INSERT INTO posts (title, body) VALUES (?1, ?2)");
const updatePost = database.query("UPDATE posts SET body = ?1 WHERE title = ?2");
const deletePost = database.query("DELETE FROM posts WHERE title = ?1");
const latestPost = database.query("SELECT title, body FROM posts ORDER BY rowid DESC LIMIT 1");
const app = new Hono();

app.get("/posts", context => context.json({posts: posts.all()}));
app.get("/posts/:title", context => context.json({
  post: post.get(context.req.param("title")),
}));
app.post("/posts", async context => {
  const input = await context.req.json<{title: string; body: string}>();
  createPost.run(input.title, input.body);
  return context.json({post: latestPost.get()}, 201);
});
app.put("/posts/:title", async context => {
  const input = await context.req.json<{body: string}>();
  updatePost.run(input.body, context.req.param("title"));
  return context.json({post: post.get(context.req.param("title"))});
});
app.delete("/posts/:title", context => {
  deletePost.run(context.req.param("title"));
  return context.text("deleted");
});

describe("bounded SQLite Hono adapter reference", () => {
  test("matches the native create, list, get, update, delete, and missing contract", async () => {
    expect(await json("GET", "/posts")).toEqual({status: 200, body: {posts: []}});
    expect(await json("POST", "/posts", {title: "Night", body: "Good Night"})).toEqual({
      status: 201,
      body: {post: {title: "Night", body: "Good Night"}},
    });
    expect(await json("GET", "/posts")).toEqual({
      status: 200,
      body: {posts: [{title: "Night", body: "Good Night"}]},
    });
    expect(await json("GET", "/posts/Night")).toEqual({
      status: 200,
      body: {post: {title: "Night", body: "Good Night"}},
    });
    expect(await json("PUT", "/posts/Night", {body: "Still Night"})).toEqual({
      status: 200,
      body: {post: {title: "Night", body: "Still Night"}},
    });

    const removed = await app.request("/posts/Night", {method: "DELETE"});
    expect({status: removed.status, body: await removed.text()}).toEqual({
      status: 200,
      body: "deleted",
    });
    expect(await json("GET", "/posts/Night")).toEqual({status: 200, body: {post: null}});
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
