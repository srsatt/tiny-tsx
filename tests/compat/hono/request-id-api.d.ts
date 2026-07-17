export {};

declare module "hono" {
  interface HonoContextApi {
    get(name: "requestId"): string | undefined;
  }
}

declare module "hono/request-id" {
  import type {HonoContextApi, HonoMiddlewareApi} from "hono";

  export interface RequestIdOptions {
    limitLength?: number;
    headerName?: string;
    generator?: (context: HonoContextApi) => string;
  }

  export function requestId(options?: RequestIdOptions): HonoMiddlewareApi;
}
