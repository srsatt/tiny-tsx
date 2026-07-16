export interface ServeOptions {
  fetch: (request: Request) => Response | Promise<Response>;
  port?: number;
}

export interface Server {
  close(): void;
}

export type FetchApplication = {
  fetch: (request: Request) => Response | Promise<Response>;
};

/**
 * Declares the native TinyTSX server entrypoint.
 *
 * The call is consumed by the AOT compiler and never executes as JavaScript.
 */
export function serve(
  _application: FetchApplication | ServeOptions,
  _onListening?: (info: {port: number}) => void,
): Server {
  throw new Error("tinytsx:serve is a compile-time host adapter");
}
