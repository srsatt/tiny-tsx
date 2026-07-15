import {expect, test} from "bun:test";
import app from "./hono-invalid-prompt-smoke.ts";

test("routes an invalid AI SDK prompt through Hono error handling", async () => {
  const response = await app.request("http://localhost/ai-invalid");

  expect(response.status).toBe(500);
  expect(await response.text()).toContain("prompt and messages cannot be defined at the same time");
});
