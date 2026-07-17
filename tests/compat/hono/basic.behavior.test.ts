import assert from "node:assert/strict";
import app from "../../../vendor/hono-examples/basic/src/index.ts";

const root = await app.request("http://localhost/");
assert.equal(root.status, 200);
assert.equal(root.headers.get("x-powered-by"), "Hono");
assert.match(root.headers.get("x-response-time") ?? "", /^\d+ms$/);
assert.equal(await root.text(), "Hono!!");

const missing = await app.request("http://localhost/missing");
assert.equal(missing.status, 404);
assert.equal(await missing.text(), "Custom 404 Not Found");

const unauthorized = await app.request("http://localhost/auth/test");
assert.equal(unauthorized.status, 500);
assert.equal(await unauthorized.text(), "Custom Error Message");

console.log("ok - complete pinned Hono basic portable behavior");
