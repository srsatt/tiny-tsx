declare module "hono/pretty-json" {
  import type {HonoMiddlewareApi} from "hono";

  export interface PrettyJsonOptions {
    space?: number;
    query?: string;
    force?: boolean;
  }

  export function prettyJSON(options?: PrettyJsonOptions): HonoMiddlewareApi;
}
