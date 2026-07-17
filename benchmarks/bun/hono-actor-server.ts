import {Hono} from "hono";

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

const worker = new Worker(new URL("./counter-worker.ts", import.meta.url).href, {type: "module"});
const pending = new Map<number, (output: string) => void>();
let nextMessage = 0;
worker.onmessage = (event: MessageEvent<{id: number; output: string}>) => {
  pending.get(event.data.id)?.(event.data.output);
  pending.delete(event.data.id);
};

function ask(delta: number): Promise<string> {
  const id = nextMessage++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    worker.postMessage({id, delta});
  });
}

const app = new Hono();
app.get("/", async context => context.text(await ask(0)));

Bun.serve({hostname: "127.0.0.1", port, development: false, fetch: app.fetch});
