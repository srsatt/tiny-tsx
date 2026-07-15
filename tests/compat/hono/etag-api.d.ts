import type {HonoMiddlewareApi} from "hono";

export interface ETagOptionsApi {
  weak?: boolean;
  retainedHeaders?: string[];
}

export function etag(options?: ETagOptionsApi): HonoMiddlewareApi;
