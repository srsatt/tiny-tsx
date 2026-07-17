import assert from "node:assert/strict";
import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {test} from "node:test";

test("serves the portable Hono entry behavior through @hono/node-server", async context => {
  const app = new Hono();
  app.get("/", context => context.text("Hello from @hono/node-server on TinyTSX"));
  const server = serve({fetch: app.fetch, port: 39_480});
  context.after(() => server.close());

  const root = await waitForServer();
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("content-type"), "text/plain; charset=UTF-8");
  assert.equal(await root.text(), "Hello from @hono/node-server on TinyTSX");

  const missing = await fetch("http://127.0.0.1:39480/missing");
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "404 Not Found");
});

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await fetch("http://127.0.0.1:39480/");
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("@hono/node-server reference did not start");
}
