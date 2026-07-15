import {expect, test} from "bun:test";
import app from "./hono-generate-text-smoke.ts";

test("serves deterministic AI SDK Core text through Hono", async () => {
  const first = await app.request("http://localhost/ai");
  const second = await app.request("http://localhost/ai");

  expect(first.status).toBe(200);
  expect(await first.text()).toBe("Hello from deterministic AI");
  expect(await second.text()).toBe("Hello from deterministic AI");
});
