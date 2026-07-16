import { Hono } from 'hono'
import { serve } from 'tinytsx:serve'

const app = new Hono()

app.get('/', (context) => context.text('Hello from tinytsx:serve'))

serve({
  fetch: app.fetch,
  port: 8787,
})
