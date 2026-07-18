import {expect, test} from "bun:test";
import app from "./map-smoke";

test("preserves isolated request-local Map behavior in Bun and Hono", async () => {
  const values = Array.from({length: 32}, (_, index) => `request-${index}`);
  const responses = await Promise.all(values.map(async value => {
    const response = await app.request(`/map/${value}`);
    return {status: response.status, body: await response.text()};
  }));
  expect(responses).toEqual(values.map(value => ({status: 200, body: value})));

  const cleared = await app.request("/map-clear");
  expect(cleared.status).toBe(200);
  expect(await cleared.text()).toBe("empty");
});
