import {Database} from "bun:sqlite";
import {expect, test} from "bun:test";
import {Hono} from "../../../vendor/hono/src/index.ts";

const database = new Database(":memory:");
database.exec(
  "CREATE TABLE payments (key TEXT PRIMARY KEY, account TEXT NOT NULL, amount INTEGER NOT NULL); CREATE TABLE payment_audit (key TEXT PRIMARY KEY); INSERT INTO payment_audit (key) VALUES ('blocked')",
);
const insertPayment = database.query(
  "INSERT INTO payments (key, account, amount) VALUES (?1, ?2, ?3)",
);
const insertAudit = database.query("INSERT INTO payment_audit (key) VALUES (?1)");
const findPayment = database.query("SELECT key, account, amount FROM payments WHERE key = ?1");
const findAudit = database.query("SELECT key FROM payment_audit WHERE key = ?1");
const commitPayment = database.transaction(
  (key: string, account: string, amount: number, auditKey: string) => {
    insertPayment.run(key, account, amount);
    insertAudit.run(auditKey);
  },
);
const app = new Hono();

app.onError((_error, context) => context.text("internal server error", 500));

function requiredKey(context: Parameters<Parameters<typeof app.post>[1]>[0]): string | undefined {
  const key = context.req.header("Idempotency-Key");
  if (key === undefined || key.length === 0 || new TextEncoder().encode(key).length > 256) {
    return undefined;
  }
  return key;
}

app.post("/idempotency/succeed/:account", async context => {
  const input = await context.req.json<{amount: number}>();
  const key = requiredKey(context);
  if (key === undefined) return context.text("bad request", 400);
  commitPayment(key, context.req.param("account"), input.amount, key);
  return context.json({ok: true}, 201);
});

app.post("/idempotency/fail/:account", async context => {
  const input = await context.req.json<{amount: number}>();
  const key = requiredKey(context);
  if (key === undefined) return context.text("bad request", 400);
  commitPayment(key, context.req.param("account"), input.amount, "blocked");
  return context.json({ok: true}, 201);
});

app.get("/idempotency/payment/:key", context => {
  const payment = findPayment.get(context.req.param("key"));
  if (!payment) return context.json({error: "Not Found"}, 404);
  return context.json({payment});
});

app.get("/idempotency/audit/:key", context => {
  const audit = findAudit.get(context.req.param("key"));
  if (!audit) return context.json({error: "Not Found"}, 404);
  return context.json({audit});
});

test("Bun and Hono match required-header commit, rollback, bounds, and recovery", async () => {
  expect(await post("/idempotency/succeed/acme%20eu", "bun-paid", 42)).toEqual({
    status: 201,
    body: '{"ok":true}',
  });
  expect(await get("/idempotency/payment/bun-paid")).toEqual({
    status: 200,
    body: '{"payment":{"key":"bun-paid","account":"acme eu","amount":42}}',
  });
  expect(await get("/idempotency/audit/bun-paid")).toEqual({
    status: 200,
    body: '{"audit":{"key":"bun-paid"}}',
  });

  expect(await post("/idempotency/fail/acme", "bun-rolled-back", 7)).toEqual({
    status: 500,
    body: "internal server error",
  });
  expect(await get("/idempotency/payment/bun-rolled-back")).toEqual({
    status: 404,
    body: '{"error":"Not Found"}',
  });
  expect(await post("/idempotency/succeed/recovery", undefined, 1)).toEqual({
    status: 400,
    body: "bad request",
  });
  expect(await post("/idempotency/succeed/recovery", "", 1)).toEqual({
    status: 400,
    body: "bad request",
  });
  expect(await post("/idempotency/succeed/recovery", "x".repeat(257), 1)).toEqual({
    status: 400,
    body: "bad request",
  });
  expect(await post("/idempotency/succeed/recovery", "bun-after-failure", 9)).toEqual({
    status: 201,
    body: '{"ok":true}',
  });
});

async function post(path: string, key: string | undefined, amount: number) {
  const headers = new Headers({"content-type": "application/json"});
  if (key !== undefined) headers.set("idempotency-key", key);
  const response = await app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify({amount}),
  });
  return {status: response.status, body: await response.text()};
}

async function get(path: string) {
  const response = await app.request(path);
  return {status: response.status, body: await response.text()};
}
