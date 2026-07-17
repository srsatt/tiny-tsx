declare module "hono/body-limit" {
  import type {HonoMiddlewareApi} from "hono";

  export interface BodyLimitOptions {
    maxSize: number;
  }

  export function bodyLimit(options: BodyLimitOptions): HonoMiddlewareApi;
}
