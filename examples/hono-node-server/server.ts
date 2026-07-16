import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (context) => context.text('Hello from @hono/node-server on TinyTSX'))

serve(app)
