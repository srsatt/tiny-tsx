import {Hono} from "hono";

const port = Number.parseInt(Bun.env.TINYTSX_BENCH_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_BENCH_PORT must be a valid TCP port");
}
const databasePath = Bun.env.TINYTSX_BENCH_SQLITE_PATH;
if (databasePath === undefined || databasePath.length === 0) {
  throw new Error("TINYTSX_BENCH_SQLITE_PATH is required");
}

type Operation = "close" | "journal" | "setup" | "state" | "transaction";
type Reply = {id: number; output?: string; error?: string};
type Pending = {resolve: (output: string) => void; reject: (error: Error) => void};

const owners = Array.from(
  {length: 2},
  () => new Worker(new URL("./sqlite-wal-worker.ts", import.meta.url).href, {type: "module"}),
);
const pending = owners.map(() => new Map<number, Pending>());
let nextMessage = 0;

for (const [index, owner] of owners.entries()) {
  owner.onmessage = (event: MessageEvent<Reply>) => {
    const reply = pending[index]!.get(event.data.id);
    pending[index]!.delete(event.data.id);
    if (event.data.error === undefined) {
      reply?.resolve(event.data.output ?? "");
    } else {
      reply?.reject(new Error(event.data.error));
    }
  };
  owner.onerror = event => {
    for (const request of pending[index]!.values()) {
      request.reject(new Error(event.message));
    }
    pending[index]!.clear();
  };
}

function call(index: number, operation: Operation): Promise<string> {
  const id = nextMessage++;
  return new Promise((resolve, reject) => {
    pending[index]!.set(id, {resolve, reject});
    owners[index]!.postMessage({
      id,
      operation,
      ...(operation === "setup" ? {databasePath} : {}),
    });
  });
}

const app = new Hono();
app.get("/sqlite-wal/setup/0", async context => context.text(await call(0, "setup")));
app.get("/sqlite-wal/setup/1", async context => context.text(await call(1, "setup")));
app.get("/sqlite-wal/0", async context => context.text(await call(0, "transaction")));
app.get("/sqlite-wal/1", async context => context.text(await call(1, "transaction")));
app.get("/sqlite-wal/state", async context => context.body(
  await call(0, "state"),
  200,
  {"content-type": "application/json"},
));
app.get("/sqlite-wal/journal", async context => context.body(
  await call(0, "journal"),
  200,
  {"content-type": "application/json"},
));

export const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  fetch: app.fetch,
});

export async function stop(): Promise<void> {
  server.stop(true);
  await Promise.all(owners.map((_, index) => call(index, "close")));
  for (const owner of owners) owner.terminate();
}
