import {expect, test} from "bun:test";
import {Hono} from "../stytch-auth/node_modules/hono/dist/index.js";
import {todoService} from "../../../vendor/hono-examples/stytch-auth/api/TodoService";

type ReferenceEnv = {
  TODOS: {
    get<Value>(key: string, type: "json"): Promise<Value | null>;
    put(key: string, value: string): Promise<void>;
  };
};

const values = new Map<string, string>();
const environment: ReferenceEnv = {
  TODOS: {
    async get<Value>(key: string): Promise<Value | null> {
      const value = values.get(key);
      return value === undefined ? null : JSON.parse(value) as Value;
    },
    async put(key: string, value: string): Promise<void> {
      values.set(key, value);
    },
  },
};

const app = new Hono<{Bindings: ReferenceEnv; Variables: {userID: string}}>();
const authenticate = async (context: any, next: () => Promise<void>) => {
  const cookie = context.req.header("cookie") ?? "";
  const encoded = cookie.split(";")
    .map((part: string) => part.trim().split("="))
    .find(([name]: string[]) => name === "stytch_session_jwt")?.[1];
  if (!encoded) return context.text("Unauthenticated", 401);
  context.set("userID", decodeURIComponent(encoded));
  await next();
};

app.get("/api/todos", authenticate, async context => {
  const todos = await todoService(context.env, context.get("userID")).get();
  return context.json({todos});
});
app.post("/api/todos", authenticate, async context => {
  const body = await context.req.json<{todoText: string}>();
  const todos = await todoService(context.env, context.get("userID")).add(body.todoText);
  return context.json({todos});
});
app.post("/api/todos/:id/complete", authenticate, async context => {
  const todos = await todoService(context.env, context.get("userID"))
    .markCompleted(context.req.param("id"));
  return context.json({todos});
});
app.delete("/api/todos/:id", authenticate, async context => {
  const todos = await todoService(context.env, context.get("userID"))
    .delete(context.req.param("id"));
  return context.json({todos});
});

test("matches the bounded authenticated CRUD behavior in Bun and Hono", async () => {
  values.clear();
  const denied = await app.request("/api/todos", undefined, environment);
  expect(denied.status).toBe(401);
  expect(await denied.text()).toBe("Unauthenticated");

  expect(await json("/api/todos", "reader")).toEqual({todos: []});
  const created = await json("/api/todos", "reader", {
    method: "POST",
    body: JSON.stringify({todoText: "first"}),
  });
  expect(created.todos).toHaveLength(1);
  expect(created.todos[0]).toMatchObject({text: "first", completed: false});
  expect(await json("/api/todos", "other")).toEqual({todos: []});
  expect(await json(`/api/todos/${created.todos[0].id}/complete`, "reader", {
    method: "POST",
  })).toEqual({todos: [{...created.todos[0], completed: true}]});
  expect(await json(`/api/todos/${created.todos[0].id}`, "reader", {
    method: "DELETE",
  })).toEqual({todos: []});
});

async function json(pathname: string, user: string, init: RequestInit = {}) {
  const response = await app.request(pathname, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : {"content-type": "application/json"}),
      cookie: `stytch_session_jwt=${encodeURIComponent(user)}`,
    },
  }, environment);
  expect(response.status).toBe(200);
  return response.json() as Promise<{todos: Array<{id: string; text: string; completed: boolean}>}>;
}
