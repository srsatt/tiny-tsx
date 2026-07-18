import {expect, test} from "bun:test";
import {Hono} from "hono";

class RootSupervisor {
  readonly #attempts: number[] = [];
  readonly #children = new Set<Counter>();

  constructor(
    readonly maxRestarts: number,
    readonly withinMs: number,
  ) {}

  add(child: Counter): void {
    this.#children.add(child);
  }

  failed(child: Counter): void {
    const now = Date.now();
    while (this.#attempts[0] !== undefined && now - this.#attempts[0] >= this.withinMs) {
      this.#attempts.shift();
    }
    if (this.#attempts.length >= this.maxRestarts) {
      for (const candidate of this.#children) candidate.terminate();
      return;
    }
    this.#attempts.push(now);
    child.restart();
  }
}

class Counter {
  #alive = true;
  #state: number;

  constructor(
    readonly initialState: number,
    readonly failureMessage?: number,
    readonly supervisor?: RootSupervisor,
  ) {
    this.#state = initialState;
    supervisor?.add(this);
  }

  async ask(message: number): Promise<string> {
    if (!this.#alive) throw new Error("terminated");
    if (message === this.failureMessage) {
      this.#state = -1;
      this.supervisor?.failed(this);
      throw new Error("supervised counter failure");
    }
    this.#state += message;
    return String(this.#state);
  }

  restart(): void {
    this.#state = this.initialState;
  }

  terminate(): void {
    this.#alive = false;
  }
}

function application(): Hono {
  const root = new RootSupervisor(2, 60_000);
  const left = new Counter(10, -999, root);
  const right = new Counter(100, -999, root);
  const outside = new Counter(1);
  const app = new Hono();
  app.onError(() => new Response("internal server error", {status: 500}));
  app.get("/supervision/left/add", async context => context.text(await left.ask(5)));
  app.get("/supervision/left/read", async context => context.text(await left.ask(0)));
  app.get("/supervision/left/fail", async context => context.text(await left.ask(-999)));
  app.get("/supervision/right/add", async context => context.text(await right.ask(7)));
  app.get("/supervision/right/read", async context => context.text(await right.ask(0)));
  app.get("/supervision/right/fail", async context => context.text(await right.ask(-999)));
  app.get("/supervision/outside/add", async context => context.text(await outside.ask(1)));
  app.get("/supervision/outside/read", async context => context.text(await outside.ask(0)));
  return app;
}

async function response(app: Hono, path: string, status: number, body: string): Promise<void> {
  const result = await app.request(path);
  expect(result.status).toBe(status);
  expect(await result.text()).toBe(body);
}

test("matches one-for-one reset, shared exhaustion, and outside isolation", async () => {
  const app = application();
  await response(app, "/supervision/left/add", 200, "15");
  await response(app, "/supervision/right/add", 200, "107");
  await response(app, "/supervision/outside/add", 200, "2");

  await response(app, "/supervision/left/fail", 500, "internal server error");
  await response(app, "/supervision/left/read", 200, "10");
  await response(app, "/supervision/right/read", 200, "107");

  await response(app, "/supervision/right/fail", 500, "internal server error");
  await response(app, "/supervision/left/read", 200, "10");
  await response(app, "/supervision/right/read", 200, "100");

  await response(app, "/supervision/left/fail", 500, "internal server error");
  await response(app, "/supervision/left/read", 500, "internal server error");
  await response(app, "/supervision/right/read", 500, "internal server error");
  await response(app, "/supervision/outside/read", 200, "2");
  await response(app, "/supervision/outside/add", 200, "3");
});
