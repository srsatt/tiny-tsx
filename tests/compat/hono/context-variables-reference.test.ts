import {expect, test} from "bun:test";
import app from "./context-variables-smoke";

test("preserves isolated Hono context variables through middleware", async () => {
  const values = Array.from({length: 32}, (_, index) => `request-${index}`);
  const responses = await Promise.all(values.map(async value => {
    const response = await app.request(`/context/${value}`);
    return {status: response.status, body: await response.text()};
  }));

  expect(responses).toEqual(values.map(value => ({
    status: 200,
    body: `ctx:${value}:absent`,
  })));

  const varResponses = await Promise.all(values.map(async value => {
    const response = await app.request(`/context-var/${value}`);
    return {status: response.status, body: await response.text()};
  }));
  expect(varResponses).toEqual(values.map(value => ({
    status: 200,
    body: `ctx:${value}:absent`,
  })));
});
