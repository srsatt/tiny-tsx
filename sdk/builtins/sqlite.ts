export type SqlValue = null | number | string | Uint8Array;
export type SqlParameters = readonly SqlValue[];
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface Statement {
  all(parameters?: SqlParameters): Promise<readonly SqlRow[]>;
  get(parameters?: SqlParameters): Promise<SqlRow | undefined>;
  run(parameters?: SqlParameters): Promise<void>;
  close(): void;
  dispose(): void;
}

export declare class Database {
  constructor(path: string);
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction(sql: string): Promise<void>;
  close(): void;
  dispose(): void;
}
