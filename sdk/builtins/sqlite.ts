export type SqlValue = null | boolean | number | string | Uint8Array;
export type SqlParameters = readonly SqlValue[];
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowId: string | null;
}

export interface Statement {
  all(parameters?: SqlParameters): Promise<readonly SqlRow[]>;
  get(parameters?: SqlParameters): Promise<SqlRow | undefined>;
  run(parameters?: SqlParameters): Promise<RunResult>;
  close(): void;
  dispose(): void;
}

export interface ReadonlyStatement {
  all(parameters?: SqlParameters): Promise<readonly SqlRow[]>;
  get(parameters?: SqlParameters): Promise<SqlRow | undefined>;
  close(): void;
  dispose(): void;
}

export interface ReadonlyDatabase {
  prepare(sql: string): ReadonlyStatement;
  close(): void;
  dispose(): void;
}

export declare function openReadonlyDatabase(binding: string): ReadonlyDatabase;

export declare class Database {
  constructor(path: string);
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction(sql: string): Promise<void>;
  transaction(callback: () => Promise<void>): Promise<void>;
  close(): void;
  dispose(): void;
}
