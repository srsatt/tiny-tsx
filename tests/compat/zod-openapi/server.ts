import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const ParamsSchema = z.object({
  id: z.string().min(3).openapi({
    param: {
      name: 'id',
      in: 'path',
    },
    example: '1212121',
  }),
})

const UserSchema = z.object({
  id: z.string().openapi({ example: '123' }),
  name: z.string().openapi({ example: 'John Doe' }),
  age: z.number().openapi({ example: 42 }),
}).openapi('User')

const route = createRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: ParamsSchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: UserSchema,
        },
      },
      description: 'Retrieve the user',
    },
  },
})

const app = new OpenAPIHono()

app.openapi(route, (context) => {
  const { id } = context.req.valid('param')
  return context.json({
    id,
    age: 20,
    name: 'Ultra-man',
  })
})

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'TinyTSX Zod OpenAPI example',
  },
})

export default app
