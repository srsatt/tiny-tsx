import assert from "node:assert/strict";
import app from "./body-limit-smoke.ts";

const index = await app.request("http://localhost/");
assert.equal(index.status, 200);
assert.equal(await index.text(), "index");

const accepted = await app.request("http://localhost/body-limit", {
  method: "POST",
  body: "hono is so hot",
});
assert.equal(accepted.status, 200);
assert.equal(await accepted.text(), "pass :)");

const rejected = await app.request("http://localhost/body-limit", {
  method: "POST",
  body: "hono is so hot and cute",
});
assert.equal(rejected.status, 413);
// Bun 1.3.13 does not infer the Fetch string BodyInit content type here. The
// native contract follows the pinned WPT/Fetch behavior and documents this
// runtime difference alongside the existing Hono response-clone decision.
assert.equal(rejected.headers.get("content-type"), null);
assert.equal(await rejected.text(), "Payload Too Large");

console.log("ok - pinned Hono bodyLimit portable behavior");
