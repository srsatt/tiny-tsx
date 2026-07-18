declare module "hono/cors" {
  import type {HonoMiddlewareApi} from "hono";

  export interface CorsOptions {
    origin?: string | string[];
    allowMethods?: string[];
    allowHeaders?: string[];
    maxAge?: number;
    credentials?: boolean;
    exposeHeaders?: string[];
  }

  export function cors(options?: CorsOptions): HonoMiddlewareApi;
}
