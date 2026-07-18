import assert from "node:assert/strict";
import app from "./secure-headers-smoke.ts";

const defaults = await app.request("http://localhost/default");
assert.equal(defaults.headers.get("x-frame-options"), "SAMEORIGIN");
assert.equal(defaults.headers.get("x-powered-by"), "Hono");

const ordered = await app.request("http://localhost/ordered");
assert.equal(ordered.headers.get("x-powered-by"), null);

const custom = await app.request("http://localhost/custom");
assert.equal(custom.headers.get("x-frame-options"), "DENY");
assert.equal(custom.headers.get("x-xss-protection"), null);
assert.equal(
  custom.headers.get("strict-transport-security"),
  "max-age=31536000; includeSubDomains; preload;",
);

console.log("ok - pinned Hono secureHeaders portable behavior");
