import assert from "node:assert/strict";
import app from "./request-id-smoke.ts";
import optionsApp from "./request-id-options-smoke.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const generated = await app.request("http://localhost/request-id");
const generatedBody = await generated.text();
assert.equal(generated.status, 200);
assert.match(generatedBody, uuid);
assert.equal(generated.headers.get("x-request-id"), generatedBody);

const accepted = await app.request("http://localhost/request-id", {
  headers: {"x-request-id": "hono-is-hot"},
});
assert.equal(await accepted.text(), "hono-is-hot");
assert.equal(accepted.headers.get("x-request-id"), "hono-is-hot");

const replaced = await app.request("http://localhost/request-id", {
  headers: {"x-request-id": "invalid!"},
});
const replacedBody = await replaced.text();
assert.match(replacedBody, uuid);
assert.equal(replaced.headers.get("x-request-id"), replacedBody);

const custom = await optionsApp.request("http://localhost/custom-request-id", {
  headers: {"hono-request-id": "sixteen-byte-id1"},
});
assert.equal(await custom.text(), "sixteen-byte-id1");
assert.equal(custom.headers.get("hono-request-id"), "sixteen-byte-id1");
assert.equal(custom.headers.get("x-request-id"), null);

const oversized = await optionsApp.request("http://localhost/custom-request-id", {
  headers: {"hono-request-id": "seventeen-byte-id"},
});
const oversizedBody = await oversized.text();
assert.match(oversizedBody, uuid);
assert.equal(oversized.headers.get("hono-request-id"), oversizedBody);

console.log("ok - pinned Hono requestId portable behavior");
