import {expect, test} from "bun:test";
import app from "./hono-stream-text-smoke.ts";

test("serves deterministic AI SDK text chunks through a Web Response", async () => {
  const response = await app.request("http://localhost/ai-stream");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toBe("Hello from streaming AI");
});
