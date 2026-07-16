export interface ReadTextOptions {
  /** Per-call bound, capped by the compiler-wide file limit. */
  maxBytes?: number;
}

/** Reads one UTF-8 file through a permitted canonical root. */
export declare function readTextFile(path: string, options?: ReadTextOptions): Promise<string>;
