import {Hono} from "hono";
import {todoService} from "../../vendor/hono-examples/stytch-auth/api/TodoService";


type Environment = {
  TODOS: {
    get<Value>(key: string, type: "json"): Promise<Value | null>;
    put(key: string, value: string): Promise<void>;
  };
};

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

const values = new Map<string, string>();
const environment: Environment = {
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

const app = new Hono<{Bindings: Environment; Variables: {userID: string}}>();
app.use("/api/*", async (context, next) => {
  const cookie = context.req.header("cookie") ?? "";
  const encoded = cookie.split(";")
    .map(part => part.trim().split("="))
    .find(([name]) => name === "stytch_session_jwt")?.[1];
  if (!encoded) return context.text("Unauthenticated", 401);
  context.set("userID", decodeURIComponent(encoded));
  await next();
});
app.get("/api/todos", async context => {
  const todos = await todoService(context.env, context.get("userID")).get();
  return context.json({todos});
});
app.post("/api/todos", async context => {
  const body = await context.req.json<{todoText: string}>();
  const todos = await todoService(context.env, context.get("userID")).add(body.todoText);
  return context.json({todos});
});
app.post("/api/todos/:id/complete", async context => {
  const todos = await todoService(context.env, context.get("userID"))
    .markCompleted(context.req.param("id"));
  return context.json({todos});
});
app.delete("/api/todos/:id", async context => {
  const todos = await todoService(context.env, context.get("userID"))
    .delete(context.req.param("id"));
  return context.json({todos});
});

Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  fetch(request) {
    return app.fetch(request, environment);
  },
});
