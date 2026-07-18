import {Hono} from "hono";

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}

type Reply = {id: number; output: string};
const actors = Array.from(
  {length: 8},
  () => new Worker(new URL("./counter-worker.ts", import.meta.url).href, {type: "module"}),
);
const pending = actors.map(() => new Map<number, (output: string) => void>());
let nextMessage = 0;

for (const [index, actor] of actors.entries()) {
  actor.onmessage = (event: MessageEvent<Reply>) => {
    pending[index]!.get(event.data.id)?.(event.data.output);
    pending[index]!.delete(event.data.id);
  };
}

function tell(index: number): void {
  actors[index]!.postMessage({id: nextMessage++, delta: 1});
}

function ask(index: number): Promise<string> {
  const id = nextMessage++;
  return new Promise(resolve => {
    pending[index]!.set(id, resolve);
    actors[index]!.postMessage({id, delta: 0});
  });
}

const app = new Hono();
for (let index = 0; index < actors.length; index++) {
  app.get(`/actor/${index}/tell`, context => {
    tell(index);
    return context.text("queued");
  });
  app.get(`/actor/${index}/read`, async context => context.text(await ask(index)));
}

export const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  fetch: app.fetch,
});

export function stop(): void {
  server.stop(true);
  for (const actor of actors) actor.terminate();
}
