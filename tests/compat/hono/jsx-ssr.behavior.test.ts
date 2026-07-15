import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import app from "../../../vendor/hono-examples/jsx-ssr/src/index.tsx";

const rootFixture = readFileSync(
  new URL("./fixtures/jsx-ssr-root.html", import.meta.url),
  "utf8",
).replace(/\n$/, "");
const postFixture = readFileSync(
  new URL("./fixtures/jsx-ssr-post-1.html", import.meta.url),
  "utf8",
).replace(/\n$/, "");

const tests: Array<[string, () => Promise<void>]> = [
  ["renders the complete post list", async () => {
    const response = await app.request("http://localhost/");
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=UTF-8");
    assert.equal(body, rootFixture);
    assert.ok(body.startsWith("<!DOCTYPE html>"), JSON.stringify(body.slice(0, 120)));
    assert.match(body, /<title>Top<\/title>/);
    assert.match(body, /<h2>Posts<\/h2>/);
    assert.match(body, /<a href="\/post\/1">Good Morning<\/a>/);
    assert.match(body, /<a href="\/post\/5">こんにちは<\/a>/);
  }],

  ["renders a request-selected post", async () => {
    const response = await app.request("http://localhost/post/1");
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body, postFixture);
    assert.match(body, /<title>Good Morning<\/title>/);
    assert.match(body, /<h2>Good Morning<\/h2>/);
    assert.match(body, /<p>Let us eat breakfast<\/p>/);
  }],

  ["uses the application not-found response for a missing numeric post", async () => {
    const response = await app.request("http://localhost/post/99");

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "404 Not Found");
  }],

  ["rejects a path outside the constrained numeric route", async () => {
    const response = await app.request("http://localhost/post/nope");

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "404 Not Found");
  }],
];

for (const [name, test] of tests) {
  await test();
  console.log(`ok - ${name}`);
}
