declare module "hono/powered-by" {
  import type {HonoMiddlewareApi} from "hono";

  export interface PoweredByOptions {
    serverName?: string;
  }

  export function poweredBy(options?: PoweredByOptions): HonoMiddlewareApi;
}
