export interface HonoRequestApi {
  readonly method: string;
  readonly path: string;
  param(name: string): string | undefined;
  query(name: string): string | undefined;
}

export interface HonoContextApi {
  readonly req: HonoRequestApi;
  text(body: string, status?: number): Response;
  html(body: string, status?: number): Response;
  json(value: unknown, status?: number): Response;
}

export type HonoHandlerApi = (
  context: HonoContextApi,
) => Response | Promise<Response>;

export declare class Hono {
  get(path: string, ...handlers: HonoHandlerApi[]): this;
  on(method: string | string[], path: string | string[], ...handlers: HonoHandlerApi[]): this;
  fetch(request: Request): Response | Promise<Response>;
}
