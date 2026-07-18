export interface HonoRequestApi {
  readonly method: string;
  readonly path: string;
  param(name: string): string;
  query(name: string): string | undefined;
  header(name: string): string | undefined;
  json<T = unknown>(): Promise<T>;
}

export interface HonoContextApi<Bindings = Record<string, never>> {
  readonly req: HonoRequestApi;
  readonly res: Response;
  readonly env: Bindings;
  header(name: string, value: string): void;
  set(name: string, value: unknown): void;
  get<Value = unknown>(name: string): Value | undefined;
  text(body: string, status?: number): Response;
  html(body: string | JSX.Element, status?: number): Response;
  json(value: unknown, status?: number): Response;
  redirect(location: string | URL, status?: 301 | 302 | 303 | 307 | 308): Response;
  notFound(): Response;
}

export type HonoHandlerApi<Bindings = any> = (
  context: HonoContextApi<Bindings>,
) => Response | Promise<Response>;

export type HonoMiddlewareApi<Bindings = any> = (
  context: HonoContextApi<Bindings>,
  next: () => Promise<void>,
) => void | Promise<void>;

export type HonoRouteHandlerApi<Bindings = any> = (
  context: HonoContextApi<Bindings>,
  next: () => Promise<void>,
) => Response | void | Promise<Response | void>;

export type HonoNotFoundHandlerApi<Bindings = any> = (
  context: HonoContextApi<Bindings>,
) => Response | Promise<Response>;

export type HonoErrorHandlerApi<Bindings = any> = (
  error: Error,
  context: HonoContextApi<Bindings>,
) => Response | Promise<Response>;

export type BindingsOf<Environment> = Environment extends {Bindings: infer Bindings}
  ? Bindings
  : Record<string, never>;

export declare class Hono<Environment = Record<string, never>> {
  get(path: string, ...handlers: HonoRouteHandlerApi<BindingsOf<Environment>>[]): this;
  post(path: string, ...handlers: HonoRouteHandlerApi<BindingsOf<Environment>>[]): this;
  put(path: string, ...handlers: HonoRouteHandlerApi<BindingsOf<Environment>>[]): this;
  delete(path: string, ...handlers: HonoRouteHandlerApi<BindingsOf<Environment>>[]): this;
  options(path: string, ...handlers: HonoRouteHandlerApi<BindingsOf<Environment>>[]): this;
  use(path: string, ...middleware: HonoMiddlewareApi<BindingsOf<Environment>>[]): this;
  on(method: string | string[], path: string | string[], ...handlers: HonoHandlerApi<BindingsOf<Environment>>[]): this;
  route(path: string, application: Hono<Environment>): this;
  notFound(handler: HonoNotFoundHandlerApi<BindingsOf<Environment>>): this;
  onError(handler: HonoErrorHandlerApi<BindingsOf<Environment>>): this;
  fetch(request: Request): Response | Promise<Response>;
}
