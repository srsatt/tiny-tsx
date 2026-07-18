import ts from "typescript";
import type {SourceSpan} from "./hir.js";
import type {SourceModule} from "./module-graph.js";
import type {ResolvedCallable} from "./runtime-callable.js";
import {STAGED_UNDEFINED, StagedSymbol, type StagedValue} from "./staged-value.js";

export type Value =
  | {kind: "undefined"}
  | {kind: "null"}
  | {kind: "boolean"; value: boolean}
  | {kind: "number"; value: number}
  | {kind: "bigint"; value: bigint}
  | {kind: "string"; value: string}
  | {kind: "html"; value: string}
  | {kind: "regexp"; source: string; flags: string}
  | {kind: "symbol"; id: number; description?: string}
  | {
      kind: "schema";
      schemaType?: string;
      fields?: Map<string, Value>;
      item?: Value;
      metadata?: Value;
      refId?: string;
      minLength?: number;
      minimum?: number;
      optional?: boolean;
    }
  | {kind: "error"; name: string; message: string}
  | {kind: "thrown"; value: Value}
  | {kind: "array"; items: Value[]}
  | {kind: "record"; fields: Map<string, Value>}
  | {kind: "contextVariables"; fields: Map<string, Value>}
  | {kind: "headers"; entries: Map<string, {name: string; value: ResponseHeaderValue}>}
  | {kind: "request"; routePattern: string; method: string}
  | {kind: "requestJson"}
  | {kind: "requestJsonField"; name: string}
  | {kind: "fetchResponse"; url: string}
  | {kind: "fetchStatus"; url: string}
  | {kind: "clockNow"}
  | {kind: "elapsedMilliseconds"}
  | {kind: "routeParameter"; name: string}
  | {kind: "routeChoice"; name: string; cases: Map<string, Value>; fallback: Value}
  | {kind: "requestHeader"; name: string}
  | {kind: "requestId"; headerName: string}
  | {kind: "requestCookie"; name: string; fallback?: string}
  | {kind: "randomUuid"}
  | {kind: "environmentVariable"; name: string; required: boolean; fallback?: string}
  | {kind: "environmentBindings"}
  | {kind: "fileText"; path: string; maxBytes: number}
  | {kind: "actor"; state: ActorState}
  | {kind: "actorCall"; actor: ActorState; message: number | string; timeoutMs?: number}
  | {kind: "database"; state: DatabaseState}
  | {kind: "statement"; state: StatementState}
  | {kind: "sqliteQuery"; statement: StatementState; mode: "all" | "first"; parameters: SqliteParameter[]}
  | {kind: "sqliteRunChanges"; result: number}
  | {kind: "sqliteRunLastInsertRowId"; result: number}
  | {kind: "sqlitePredicate"; query: Value & {kind: "sqliteQuery"}; test: "missing" | "present"}
  | {kind: "queryParameter"; name: string; fallback?: string}
  | {kind: "queryPredicate"; name: string; test: "truthy" | "empty" | "present"}
  | {kind: "runtimeString"; parts: RuntimeStringPart[]}
  | {kind: "runtimeHtml"; parts: RuntimeStringPart[]}
  | {kind: "readableStream"; state: StreamState}
  | {kind: "writableStream"; state: StreamState}
  | {kind: "streamWriter"; state: StreamState}
  | {kind: "streamReader"; state: StreamState}
  | {kind: "worker"; state: WorkerState}
  | {kind: "workerCall"; module: string; input: WorkerMessage}
  | {kind: "openAiProvider"; baseUrl: string; authorization: string}
  | {kind: "openAiModel"; baseUrl: string; authorization: string; model: string}
  | {kind: "openAiChatText"; url: string; authorization: string; body: string}
  | {
      kind: "closure";
      span: SourceSpan;
      expression: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration;
      module: SourceModule;
      environment: Map<string, Value>;
      lexicalThis?: Value & {kind: "instance"};
    }
  | {kind: "reference"; name: string; module: string; callable?: ResolvedCallable}
  | {kind: "constructed"; name: string; module: string}
  | {kind: "responseBody"; body: ResponseBody}
  | {
      kind: "response";
      body: ResponseBody;
      status: number;
      contentType: string;
      headers: Map<string, {name: string; value: ResponseHeaderValue}>;
    }
  | {kind: "instance"; fields: Map<string, Value>}
  | {kind: "unknown"; reason: string};

export type RuntimeStringPart =
  | {kind: "literal"; value: string}
  | {kind: "routeParameter"; name: string}
  | {kind: "requestJsonField"; name: string}
  | {kind: "requestHeader"; name: string}
  | {kind: "requestId"; headerName: string}
  | {kind: "requestCookie"; name: string; fallback: string | undefined}
  | {kind: "environmentVariable"; name: string; required: boolean; fallback: string | undefined}
  | {kind: "fileText"; path: string; maxBytes: number}
  | {kind: "actorCall"; actor: ActorState; message: number | string; timeoutMs?: number}
  | {kind: "sqliteQuery"; statement: StatementState; mode: "all" | "first"; parameters: SqliteParameter[]}
  | {kind: "sqliteRunChanges"; result: number}
  | {kind: "sqliteRunLastInsertRowId"; result: number; json: boolean}
  | {kind: "queryParameter"; name: string; fallback: string | undefined; escapeHtml: boolean}
  | {kind: "fetchStatus"; url: string}
  | {kind: "elapsedMilliseconds"}
  | {kind: "workerCall"; module: string; input: WorkerMessage}
  | {kind: "openAiChatText"; url: string; authorization: string; body: string};

export type WorkerMessage =
  | {kind: "literal"; value: string}
  | {kind: "queryParameter"; name: string; fallback: string | undefined};

export interface WorkerState {
  module: string;
  terminated: boolean;
}

export interface ActorState {
  id: number;
  key: string;
  operation: "counter" | "fallibleCounter" | "jsonMailbox";
  initialState: number;
  initialJson?: string;
  mailboxCapacity: number;
  failureMessage?: number;
  restart?: {maxRestarts: number; withinMs: number};
  persistence?: {database: DatabaseState; key: string};
}

export interface DatabaseState {
  id: number;
  key: string;
  path: string;
}

export interface StatementState {
  database: DatabaseState;
  sql: string;
}

export type SqliteParameter =
  | {kind: "routeParameter"; name: string}
  | {kind: "requestJsonField"; name: string}
  | {kind: "randomUuid"}
  | {kind: "staticString"; value: string}
  | {kind: "staticInteger"; value: number}
  | {kind: "staticReal"; value: number}
  | {kind: "staticBoolean"; value: boolean}
  | {kind: "null"};

export type ResponseHeaderValue = string | RuntimeStringPart[];

export interface StreamState {
  chunks: Array<string | RuntimeStringPart[]>;
  values?: Value[];
  closed: boolean;
}

export interface StreamResponseBody {
  kind: "stream";
  chunks: Array<string | RuntimeStringPart[]>;
}

export type ResponseBody =
  | string
  | RuntimeStringPart[]
  | StreamResponseBody
  | {
      kind: "queryConditional";
      query: string;
      whenPresent: string | RuntimeStringPart[];
      whenAbsent: string | RuntimeStringPart[];
    };

export interface ExecutionResult {
  returned: boolean;
  value: Value;
  control?: "break" | "continue";
}

export const UNDEFINED: Value = {kind: "undefined"};

export function readProperty(value: Value, name: string): Value {
  if (value.kind === "unknown") return value;
  if (value.kind === "routeChoice") {
    return {
      kind: "routeChoice",
      name: value.name,
      cases: new Map([...value.cases].map(([key, candidate]) => [key, readProperty(candidate, name)])),
      fallback: readProperty(value.fallback, name),
    };
  }
  if (value.kind === "error" && name === "name") {
    return {kind: "string", value: value.name};
  }
  if (value.kind === "error" && name === "message") {
    return {kind: "string", value: value.message};
  }
  if (value.kind === "request" && name === "method") {
    return {kind: "string", value: value.method};
  }
  if (value.kind === "requestJson") {
    return {kind: "requestJsonField", name};
  }
  if (value.kind === "environmentBindings") {
    return {kind: "environmentVariable", name, required: true};
  }
  if (value.kind === "request" && name === "path") {
    return value.routePattern.includes(":") || value.routePattern.includes("*")
      ? unknown("request path is not closed for a patterned route")
      : {kind: "string", value: value.routePattern};
  }
  if (value.kind === "fetchResponse" && name === "status") {
    return {kind: "fetchStatus", url: value.url};
  }
  if (value.kind === "instance" && name === "res") {
    return value.fields.get("#res") ?? UNDEFINED;
  }
  if (value.kind === "response" && name === "headers") {
    return {kind: "headers", entries: value.headers};
  }
  if (value.kind === "response" && name === "body") {
    if (typeof value.body === "string") return {kind: "string", value: value.body};
    if (Array.isArray(value.body)) return {kind: "runtimeString", parts: value.body};
    return {kind: "responseBody", body: value.body};
  }
  if (value.kind === "response" && name === "status") {
    return {kind: "number", value: value.status};
  }
  if (value.kind === "response" && name === "ok") {
    return {kind: "boolean", value: value.status >= 200 && value.status <= 299};
  }
  if (value.kind === "record" || value.kind === "instance" || value.kind === "contextVariables") {
    return value.fields.get(name) ?? UNDEFINED;
  }
  if (value.kind === "schema" && name === "~standard") {
    return {
      kind: "record",
      fields: new Map([["vendor", {kind: "string", value: "zod"}]]),
    };
  }
  if (name === "length" && value.kind === "array") {
    return {kind: "number", value: value.items.length};
  }
  if (name === "length" && value.kind === "string") {
    return {kind: "number", value: value.value.length};
  }
  return UNDEFINED;
}

export function fromStaged(value: StagedValue): Value {
  if (value === STAGED_UNDEFINED) return UNDEFINED;
  if (value === null) return {kind: "null"};
  if (typeof value === "string") return {kind: "string", value};
  if (typeof value === "number") return {kind: "number", value};
  if (typeof value === "bigint") return {kind: "bigint", value};
  if (typeof value === "boolean") return {kind: "boolean", value};
  if (Array.isArray(value)) return {kind: "array", items: value.map(fromStaged)};
  if (value instanceof StagedSymbol) {
    return {
      kind: "symbol",
      id: value.id,
      ...(value.description === undefined ? {} : {description: value.description}),
    };
  }
  return {kind: "record", fields: new Map(Object.entries(value).map(([name, field]) => [
    name,
    fromStaged(field),
  ]))};
}

export function unknown(reason: string): Value {
  return {kind: "unknown", reason};
}

export function detail(value: Value): {detail?: string} {
  switch (value.kind) {
    case "string": return {detail: value.value};
    case "html": return {detail: value.value};
    case "reference": return {detail: value.name};
    case "constructed": return {detail: value.name};
    case "response": return {detail: `${value.status} ${value.contentType}`};
    case "error": return {detail: `${value.name}: ${value.message}`};
    case "unknown": return {detail: value.reason};
    default: return {};
  }
}

export function continued(): ExecutionResult {
  return {returned: false, value: UNDEFINED};
}

export function valuesEqual(left: Value, right: Value): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "undefined":
    case "null": return true;
    case "boolean": return right.kind === "boolean" && left.value === right.value;
    case "number": return right.kind === "number" && left.value === right.value;
    case "bigint": return right.kind === "bigint" && left.value === right.value;
    case "string": return right.kind === "string" && left.value === right.value;
    case "symbol": return right.kind === "symbol" && left.id === right.id;
    case "reference": return right.kind === "reference"
      && left.name === right.name
      && left.module === right.module;
    default: return left === right;
  }
}

export function truthiness(value: Value): boolean | undefined {
  switch (value.kind) {
    case "undefined":
    case "null": return false;
    case "boolean": return value.value;
    case "number": return value.value !== 0 && !Number.isNaN(value.value);
    case "bigint": return value.value !== 0n;
    case "string": return value.value.length > 0;
    case "html": return value.value.length > 0;
    case "array":
    case "record":
    case "contextVariables":
    case "regexp":
    case "symbol":
    case "schema":
    case "error":
    case "thrown":
    case "headers":
    case "request":
    case "requestJson":
    case "environmentBindings":
    case "clockNow":
    case "closure":
    case "reference":
    case "constructed":
    case "responseBody":
    case "response":
    case "instance":
    case "readableStream":
    case "writableStream":
    case "streamWriter":
    case "streamReader": return true;
    case "worker": return true;
    case "actor": return true;
    case "database": return true;
    case "statement": return true;
    case "workerCall": return undefined;
    case "actorCall": return undefined;
    case "sqliteQuery": return undefined;
    case "sqliteRunChanges": return undefined;
    case "sqliteRunLastInsertRowId": return undefined;
    case "sqlitePredicate": return undefined;
    case "randomUuid": return true;
    case "requestJsonField": return undefined;
    case "openAiProvider":
    case "openAiModel": return true;
    case "openAiChatText": return undefined;
    case "routeParameter": return true;
    case "routeChoice": return undefined;
    case "requestHeader": return undefined;
    case "requestId": return undefined;
    case "requestCookie": return undefined;
    case "environmentVariable": return undefined;
    case "fileText": return undefined;
    case "elapsedMilliseconds": return undefined;
    case "queryParameter":
    case "queryPredicate": return undefined;
    case "runtimeString":
    case "runtimeHtml": return value.parts.length > 0;
    case "unknown": return undefined;
  }
}

export function typeOf(value: Value): string {
  switch (value.kind) {
    case "undefined": return "undefined";
    case "boolean": return "boolean";
    case "number": return "number";
    case "clockNow":
    case "elapsedMilliseconds": return "number";
    case "bigint": return "bigint";
    case "symbol": return "symbol";
    case "string": return "string";
    case "html": return "string";
    case "routeParameter":
    case "runtimeString":
    case "runtimeHtml": return "string";
    case "routeChoice": return "object";
    case "requestHeader": return "string";
    case "requestId": return "string";
    case "requestCookie": return "string";
    case "randomUuid": return "string";
    case "requestJsonField": return "string";
    case "environmentVariable": return "string";
    case "environmentBindings": return "object";
    case "fileText": return "string";
    case "fetchStatus": return "number";
    case "queryParameter": return "string";
    case "queryPredicate": return "boolean";
    case "readableStream":
    case "writableStream":
    case "streamWriter":
    case "streamReader": return "object";
    case "worker": return "object";
    case "actor": return "object";
    case "database": return "object";
    case "statement": return "object";
    case "workerCall": return "string";
    case "actorCall": return "string";
    case "sqliteQuery": return "object";
    case "sqliteRunChanges": return "number";
    case "sqliteRunLastInsertRowId": return "string";
    case "sqlitePredicate": return "boolean";
    case "openAiProvider": return "function";
    case "openAiModel": return "object";
    case "openAiChatText": return "string";
    case "schema": return "object";
    case "closure":
    case "reference": return "function";
    default: return "object";
  }
}

export function stringValue(value: Value): string {
  switch (value.kind) {
    case "undefined": return "undefined";
    case "null": return "null";
    case "boolean": return String(value.value);
    case "number": return String(value.value);
    case "bigint": return String(value.value);
    case "string": return value.value;
    case "html": return value.value;
    case "error": return value.message.length === 0
      ? value.name
      : `${value.name}: ${value.message}`;
    default: return "[object Object]";
  }
}

export function runtimeStringParts(value: Value): RuntimeStringPart[] | undefined {
  switch (value.kind) {
    case "string": return value.value === "" ? [] : [{kind: "literal", value: value.value}];
    case "html": return value.value === "" ? [] : [{kind: "literal", value: value.value}];
    case "routeParameter": return [{kind: "routeParameter", name: value.name}];
    case "requestHeader": return [{kind: "requestHeader", name: value.name}];
    case "requestId": return [{kind: "requestId", headerName: value.headerName}];
    case "requestCookie": return [{kind: "requestCookie", name: value.name, fallback: value.fallback}];
    case "environmentVariable": return [{
      kind: "environmentVariable",
      name: value.name,
      required: value.required,
      fallback: value.fallback,
    }];
    case "fileText": return [{kind: "fileText", path: value.path, maxBytes: value.maxBytes}];
    case "actorCall": return [{
      kind: "actorCall",
      actor: value.actor,
      message: value.message,
      ...(value.timeoutMs === undefined ? {} : {timeoutMs: value.timeoutMs}),
    }];
    case "sqliteQuery": return [{
      kind: "sqliteQuery",
      statement: value.statement,
      mode: value.mode,
      parameters: value.parameters,
    }];
    case "sqliteRunChanges": return [{kind: "sqliteRunChanges", result: value.result}];
    case "sqliteRunLastInsertRowId": return [{
      kind: "sqliteRunLastInsertRowId",
      result: value.result,
      json: false,
    }];
    case "queryParameter": return [{
      kind: "queryParameter",
      name: value.name,
      fallback: value.fallback,
      escapeHtml: false,
    }];
    case "fetchStatus": return [{kind: "fetchStatus", url: value.url}];
    case "elapsedMilliseconds": return [{kind: "elapsedMilliseconds"}];
    case "runtimeString": return value.parts;
    case "runtimeHtml": return value.parts;
    case "workerCall": return [{kind: "workerCall", module: value.module, input: value.input}];
    case "openAiChatText": return [{...value}];
    default: return undefined;
  }
}

export function joinRuntimeStrings(values: Value[]): Value | undefined {
  const parts: RuntimeStringPart[] = [];
  for (const value of values) {
    const next = runtimeStringParts(value);
    if (next === undefined) return undefined;
    for (const part of next) {
      const previous = parts.at(-1);
      if (part.kind === "literal" && previous?.kind === "literal") {
        previous.value += part.value;
      } else if (part.kind !== "literal" || part.value !== "") {
        parts.push({...part});
      }
    }
  }
  if (parts.every(part => part.kind === "literal")) {
    return {kind: "string", value: parts.map(part => part.value).join("")};
  }
  return {kind: "runtimeString", parts};
}
