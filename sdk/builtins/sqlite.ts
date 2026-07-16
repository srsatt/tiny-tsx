export type SqlValue = null | number | string | Uint8Array;
export type SqlParameters = readonly SqlValue[];
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface ExecuteResult {
  changes: number;
  lastInsertRowId: number | null;
}

export interface Statement {
  all(parameters?: SqlParameters): Promise<readonly SqlRow[]>;
  get(parameters?: SqlParameters): Promise<SqlRow | undefined>;
  run(parameters?: SqlParameters): Promise<ExecuteResult>;
  close(): void;
  dispose(): void;
}

export declare class Database {
  constructor(path: string);
  prepare(sql: string): Statement;
  exec(sql: string): Promise<ExecuteResult>;
  close(): void;
  dispose(): void;
}
