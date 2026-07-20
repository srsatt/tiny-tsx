import {afterAll, beforeAll, expect, test} from "bun:test";

let port = 0;
let stop: (() => void) | undefined;

beforeAll(async () => {
  process.env.TINYTSX_BENCH_PORT = "0";
  const reference = await import("../../../benchmarks/bun/hono-actor-multi-server.ts");
  stop = reference.stop;
  port = reference.server.port;
});

afterAll(() => stop?.());

async function text(path: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  expect(response.status).toBe(200);
  return response.text();
}

test("keeps eight Worker-owned counters isolated", async () => {
  for (let index = 0; index < 8; index++) {
    expect(await text(`/actor/${index}/read`)).toBe("0");
  }

  expect(await text("/actor/3/tell")).toBe("queued");
  expect(await text("/actor/3/tell")).toBe("queued");
  expect(await text("/actor/3/read")).toBe("2");
  expect(await text("/actor/2/read")).toBe("0");

  await Promise.all(Array.from({length: 8}, (_, index) => text(`/actor/${index}/tell`)));
  for (let index = 0; index < 8; index++) {
    expect(await text(`/actor/${index}/read`)).toBe(index === 3 ? "3" : "1");
  }
});
