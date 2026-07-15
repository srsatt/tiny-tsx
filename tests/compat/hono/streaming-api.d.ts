import type {HonoContextApi} from "hono";

export interface StreamingApi {
  write(input: string | Uint8Array): Promise<StreamingApi>;
  writeln(input: string): Promise<StreamingApi>;
}

export declare function streamText(
  context: HonoContextApi,
  callback: (stream: StreamingApi) => Promise<void>,
): Response;
