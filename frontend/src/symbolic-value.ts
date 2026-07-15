import ts from "typescript";
import type {SourceSpan} from "./hir.js";
import type {SourceModule} from "./module-graph.js";
import type {ResolvedCallable} from "./runtime-callable.js";
import {STAGED_UNDEFINED, type StagedValue} from "./staged-value.js";

export type Value =
  | {kind: "undefined"}
  | {kind: "null"}
  | {kind: "boolean"; value: boolean}
  | {kind: "number"; value: number}
  | {kind: "bigint"; value: bigint}
  | {kind: "string"; value: string}
  | {kind: "regexp"; source: string; flags: string}
  | {kind: "array"; items: Value[]}
  | {kind: "record"; fields: Map<string, Value>}
  | {kind: "headers"; entries: Map<string, {name: string; value: string}>}
  | {kind: "request"; routePattern: string}
  | {kind: "routeParameter"; name: string}
  | {kind: "queryParameter"; name: string}
  | {kind: "queryPredicate"; name: string; test: "truthy" | "empty" | "present"}
  | {kind: "runtimeString"; parts: RuntimeStringPart[]}
  | {
      kind: "closure";
      span: SourceSpan;
      expression: ts.ArrowFunction | ts.FunctionExpression;
      module: SourceModule;
      environment: Map<string, Value>;
    }
  | {kind: "reference"; name: string; module: string; callable?: ResolvedCallable}
  | {kind: "constructed"; name: string; module: string}
  | {
      kind: "response";
      body: ResponseBody;
      status: number;
      contentType: string;
      headers: Map<string, {name: string; value: string}>;
    }
  | {kind: "instance"; fields: Map<string, Value>}
  | {kind: "unknown"; reason: string};

export type RuntimeStringPart =
  | {kind: "literal"; value: string}
  | {kind: "routeParameter"; name: string};

export type ResponseBody =
  | string
  | RuntimeStringPart[]
  | {
      kind: "queryConditional";
      query: string;
      whenPresent: string | RuntimeStringPart[];
      whenAbsent: string | RuntimeStringPart[];
    };

export interface ExecutionResult {
  returned: boolean;
  value: Value;
}

export const UNDEFINED: Value = {kind: "undefined"};

export function readProperty(value: Value, name: string): Value {
  if (value.kind === "instance" && name === "res") {
    return value.fields.get("#res") ?? UNDEFINED;
  }
  if (value.kind === "response" && name === "headers") {
    return {kind: "headers", entries: value.headers};
  }
  if (value.kind === "record" || value.kind === "instance") {
    return value.fields.get(name) ?? UNDEFINED;
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
    case "reference": return {detail: value.name};
    case "constructed": return {detail: value.name};
    case "response": return {detail: `${value.status} ${value.contentType}`};
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
    case "array":
    case "record":
    case "regexp":
    case "headers":
    case "request":
    case "closure":
    case "reference":
    case "constructed":
    case "response":
    case "instance": return true;
    case "routeParameter": return true;
    case "queryParameter":
    case "queryPredicate": return undefined;
    case "runtimeString": return value.parts.length > 0;
    case "unknown": return undefined;
  }
}

export function typeOf(value: Value): string {
  switch (value.kind) {
    case "undefined": return "undefined";
    case "boolean": return "boolean";
    case "number": return "number";
    case "bigint": return "bigint";
    case "string": return "string";
    case "routeParameter":
    case "runtimeString": return "string";
    case "queryParameter": return "string";
    case "queryPredicate": return "boolean";
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
    default: return "[object Object]";
  }
}

export function runtimeStringParts(value: Value): RuntimeStringPart[] | undefined {
  switch (value.kind) {
    case "string": return value.value === "" ? [] : [{kind: "literal", value: value.value}];
    case "routeParameter": return [{kind: "routeParameter", name: value.name}];
    case "runtimeString": return value.parts;
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
