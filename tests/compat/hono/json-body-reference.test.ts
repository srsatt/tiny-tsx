import {expect, test} from "bun:test";
import app from "./json-body-smoke";

const valid = {
  name: 'TinyTSX & "Bun"',
  count: 7,
  enabled: true,
  note: null,
};

test("preserves selected request JSON primitive types", async () => {
  const response = await app.request("/json-body", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(valid),
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(valid);
});

test("keeps upstream malformed and missing-field behavior visible", async () => {
  const malformed = await app.request("/json-body", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: "{",
  });
  expect(malformed.status).toBe(500);

  const missing = await app.request("/json-body", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({name: valid.name}),
  });
  expect(missing.status).toBe(200);
  expect(await missing.text()).toBe(`{"name":"TinyTSX & \\"Bun\\""}`);
});
