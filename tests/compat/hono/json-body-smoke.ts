import {Hono} from "hono";

const app = new Hono();

app.post("/json-body", async context => {
  const input = await context.req.json() as {
    name: string;
    count: number;
    enabled: boolean;
    note: null;
  };
  return context.json({
    name: input.name,
    count: input.count,
    enabled: input.enabled,
    note: input.note,
  });
});

export default app;
