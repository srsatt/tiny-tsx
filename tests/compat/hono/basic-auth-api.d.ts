import type {HonoMiddlewareApi} from "hono";

export interface BasicAuthOptionsApi {
  username: string;
  password: string;
  realm?: string;
  invalidUserMessage?: string | object;
}

export function basicAuth(options: BasicAuthOptionsApi): HonoMiddlewareApi;
