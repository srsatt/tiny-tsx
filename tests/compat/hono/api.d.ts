export interface HonoRequestApi {
  readonly method: string;
  readonly path: string;
  param(name: string): string | undefined;
  query(name: string): string | undefined;
  header(name: string): string | undefined;
}

export interface HonoContextApi {
  readonly req: HonoRequestApi;
  readonly res: Response;
  header(name: string, value: string): void;
  text(body: string, status?: number): Response;
  html(body: string, status?: number): Response;
  json(value: unknown, status?: number): Response;
  redirect(location: string | URL, status?: 301 | 302 | 303 | 307 | 308): Response;
}

export type HonoHandlerApi = (
  context: HonoContextApi,
) => Response | Promise<Response>;

export type HonoMiddlewareApi = (
  context: HonoContextApi,
  next: () => Promise<void>,
) => void | Promise<void>;

export type HonoRouteHandlerApi = (
  context: HonoContextApi,
  next: () => Promise<void>,
) => Response | void | Promise<Response | void>;

export type HonoNotFoundHandlerApi = (
  context: HonoContextApi,
) => Response | Promise<Response>;

export declare class Hono {
  get(path: string, ...handlers: HonoRouteHandlerApi[]): this;
  post(path: string, ...handlers: HonoRouteHandlerApi[]): this;
  use(path: string, ...middleware: HonoMiddlewareApi[]): this;
  on(method: string | string[], path: string | string[], ...handlers: HonoHandlerApi[]): this;
  route(path: string, application: Hono): this;
  notFound(handler: HonoNotFoundHandlerApi): this;
  fetch(request: Request): Response | Promise<Response>;
}
