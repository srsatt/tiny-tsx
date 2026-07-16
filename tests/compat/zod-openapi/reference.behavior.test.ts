import {expect, test} from "bun:test"
import app from "./server.ts"

test("pinned Bun/Hono Zod OpenAPI behavior", async () => {
  const success = await app.request("/users/1212121")
  expect(success.status).toBe(200)
  expect(await success.text()).toBe('{"id":"1212121","age":20,"name":"Ultra-man"}')

  const rejected = await app.request("/users/x")
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toEqual({
    success: false,
    error: {
      name: "ZodError",
      message: '[\n  {\n    "origin": "string",\n    "code": "too_small",\n    "minimum": 3,\n    "inclusive": true,\n    "path": [\n      "id"\n    ],\n    "message": "Too small: expected string to have >=3 characters"\n  }\n]',
    },
  })

  const document = await app.request("/doc")
  expect(document.status).toBe(200)
  expect(await document.json()).toEqual({
    openapi: "3.0.0",
    info: {version: "1.0.0", title: "TinyTSX Zod OpenAPI example"},
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: {type: "string", example: "123"},
            name: {type: "string", example: "John Doe"},
            age: {type: "number", example: 42},
          },
          required: ["id", "name", "age"],
        },
      },
      parameters: {},
    },
    paths: {
      "/users/{id}": {
        get: {
          parameters: [{
            schema: {type: "string", minLength: 3, example: "1212121"},
            required: true,
            name: "id",
            in: "path",
          }],
          responses: {
            200: {
              description: "Retrieve the user",
              content: {"application/json": {schema: {$ref: "#/components/schemas/User"}}},
            },
          },
        },
      },
    },
  })
})
