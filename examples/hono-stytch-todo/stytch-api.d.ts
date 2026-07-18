import type {HonoContextApi, HonoMiddlewareApi} from "hono";

declare global {
  interface KVNamespace {
    get<Value>(key: string, type: "json"): Promise<Value | null>;
    put(key: string, value: string): Promise<void>;
  }

  interface Fetcher {
    fetch(request: Request): Response | Promise<Response>;
  }

  interface Env {
    readonly TODOS: KVNamespace;
    readonly STYTCH_PROJECT_ID: string;
    readonly STYTCH_PROJECT_SECRET: string;
    readonly ASSETS: Fetcher;
  }
}

export declare const Consumer: {
  authenticateSessionLocal(): HonoMiddlewareApi<Env>;
  authenticateSessionRemote(): HonoMiddlewareApi<Env>;
  getStytchSession(context: HonoContextApi<Env>): Readonly<{user_id: string}>;
};
