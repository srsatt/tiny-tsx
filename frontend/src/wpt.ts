import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface WptProgram {
  version: 2;
  target: "aarch64-apple-darwin";
  entry: string;
  tests: WptTest[];
}

export interface WptTest {
  name: string;
  slots: number;
  operations: WptOperation[];
  span: SourceSpan;
}

export type WptOperation =
  | UrlSearchParamsConstructOperation
  | UrlSearchParamsAppendOperation
  | UrlSearchParamsDeleteOperation
  | UrlSearchParamsAssertConstructedOperation
  | UrlSearchParamsAssertGetOperation
  | UrlSearchParamsAssertHasOperation;

interface WptOperationBase {
  slot: number;
  span: SourceSpan;
}

export interface UrlSearchParamsConstructOperation extends WptOperationBase {
  kind: "urlSearchParamsConstruct";
  input: string;
}

export interface UrlSearchParamsAppendOperation extends WptOperationBase {
  kind: "urlSearchParamsAppend";
  name: string;
  value: string;
}

export interface UrlSearchParamsDeleteOperation extends WptOperationBase {
  kind: "urlSearchParamsDelete";
  name: string;
  value?: string;
}

export interface UrlSearchParamsAssertConstructedOperation extends WptOperationBase {
  kind: "urlSearchParamsAssertConstructed";
  message?: string;
}

export interface UrlSearchParamsAssertGetOperation extends WptOperationBase {
  kind: "urlSearchParamsAssertGet";
  name: string;
  expected: string | null;
  message?: string;
}

export interface UrlSearchParamsAssertHasOperation extends WptOperationBase {
  kind: "urlSearchParamsAssertHas";
  name: string;
  value?: string;
  expected: boolean;
  message?: string;
}

interface MemberCall {
  slot: number;
  method: string;
  arguments: readonly ts.Expression[];
}

export function compileWptEntry(entryPath: string): WptProgram {
  const entry = path.resolve(entryPath);
  let source: string;
  try {
    source = readFileSync(entry, "utf8");
  } catch (error) {
    throw new CompileFailure([{
      code: "TINYWPT0",
      message: `could not load WPT case ${entry}: ${String(error)}`,
    }]);
  }
  const sourceFile = ts.createSourceFile(entry, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {parseDiagnostics?: readonly ts.Diagnostic[]}
  ).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    throw new CompileFailure(parseDiagnostics.map(fromTypeScript));
  }

  const tests = sourceFile.statements.map(statement => lowerTest(statement, sourceFile));
  if (tests.length === 0 || tests.every(test => test.operations.length === 0)) {
    throw tinyError("TINYWPT1", "WPT case must contain an assertion", sourceFile, undefined, sourceFile);
  }
  return {version: 2, target: "aarch64-apple-darwin", entry, tests};
}

function lowerTest(statement: ts.Statement, sourceFile: ts.SourceFile): WptTest {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    throw unsupported(statement, "top-level WPT test(...) calls", sourceFile);
  }
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "test" || call.arguments.length !== 2) {
    throw unsupported(call, "top-level WPT test(callback, name) calls", sourceFile);
  }
  const [callback, nameExpression] = call.arguments;
  const name = stringLiteral(nameExpression!, "WPT test name", sourceFile);
  if ((!ts.isFunctionExpression(callback!) && !ts.isArrowFunction(callback!)) || !ts.isBlock(callback!.body)) {
    throw unsupported(callback!, "WPT test callbacks with block bodies", sourceFile);
  }

  const variables = new Map<string, number>();
  const operations: WptOperation[] = [];
  for (const callbackStatement of callback!.body.statements) {
    if (ts.isVariableStatement(callbackStatement)) {
      lowerVariable(callbackStatement, variables, operations, sourceFile);
    } else if (isUrlSearchParamsAssignment(callbackStatement)) {
      const assignment = callbackStatement.expression;
      const slot = variableSlot(assignment.left as ts.Identifier, variables, sourceFile);
      operations.push(constructOperation(slot, assignment.right, sourceFile));
    } else if (ts.isExpressionStatement(callbackStatement) && ts.isCallExpression(callbackStatement.expression)) {
      const expression = callbackStatement.expression;
      if (isAssertionCall(expression)) {
        operations.push(lowerAssertion(expression, variables, sourceFile));
      } else {
        operations.push(lowerMutation(expression, variables, sourceFile));
      }
    } else {
      throw unsupported(callbackStatement, "URLSearchParams declarations, assignments, mutations, and assertions", sourceFile);
    }
  }
  if (!operations.some(operation => operation.kind.startsWith("urlSearchParamsAssert"))) {
    throw tinyError("TINYWPT1", "WPT test must contain an assertion", call, undefined, sourceFile);
  }
  return {name, slots: variables.size, operations, span: spanOf(call, sourceFile)};
}

function lowerVariable(
  statement: ts.VariableStatement,
  variables: Map<string, number>,
  operations: WptOperation[],
  sourceFile: ts.SourceFile,
): void {
  if (statement.declarationList.declarations.length !== 1) {
    throw unsupported(statement, "one URLSearchParams declaration per statement", sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupported(declaration, "initialized URLSearchParams variables", sourceFile);
  }
  if (variables.has(declaration.name.text)) {
    throw tinyError("TINYWPT4", `duplicate WPT variable \`${declaration.name.text}\``, declaration.name, undefined, sourceFile);
  }
  const slot = variables.size;
  variables.set(declaration.name.text, slot);
  operations.push(constructOperation(slot, declaration.initializer, sourceFile));
}

function isUrlSearchParamsAssignment(
  statement: ts.Statement,
): statement is ts.ExpressionStatement & {expression: ts.BinaryExpression} {
  return ts.isExpressionStatement(statement)
    && ts.isBinaryExpression(statement.expression)
    && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(statement.expression.left);
}

function constructOperation(
  slot: number,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): UrlSearchParamsConstructOperation {
  if (
    ts.isNewExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "URLSearchParams"
    && expression.arguments?.length === 1
  ) {
    return {
      kind: "urlSearchParamsConstruct",
      slot,
      input: stringLiteral(expression.arguments[0]!, "URLSearchParams input", sourceFile),
      span: spanOf(expression, sourceFile),
    };
  }
  throw unsupported(expression, "new URLSearchParams(string)", sourceFile);
}

function isAssertionCall(call: ts.CallExpression): boolean {
  return ts.isIdentifier(call.expression)
    && ["assert_equals", "assert_true", "assert_false"].includes(call.expression.text);
}

function lowerMutation(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, number>,
  sourceFile: ts.SourceFile,
): UrlSearchParamsAppendOperation | UrlSearchParamsDeleteOperation {
  const operation = memberCall(call, variables, sourceFile);
  if (operation.method === "append" && operation.arguments.length === 2) {
    return {
      kind: "urlSearchParamsAppend",
      slot: operation.slot,
      name: webIdlString(operation.arguments[0]!, sourceFile),
      value: webIdlString(operation.arguments[1]!, sourceFile),
      span: spanOf(call, sourceFile),
    };
  }
  if (operation.method === "delete" && operation.arguments.length >= 1 && operation.arguments.length <= 2) {
    const value = optionalWebIdlString(operation.arguments[1], sourceFile);
    return {
      kind: "urlSearchParamsDelete",
      slot: operation.slot,
      name: webIdlString(operation.arguments[0]!, sourceFile),
      ...(value === undefined ? {} : {value}),
      span: spanOf(call, sourceFile),
    };
  }
  throw unsupported(call, "URLSearchParams.append(name, value) or delete(name[, value])", sourceFile);
}

function lowerAssertion(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, number>,
  sourceFile: ts.SourceFile,
): WptOperation {
  if (!ts.isIdentifier(call.expression)) {
    throw unsupported(call, "assert_equals(...), assert_true(...), or assert_false(...)", sourceFile);
  }
  if (call.expression.text === "assert_equals" && call.arguments.length >= 2 && call.arguments.length <= 3) {
    const message = optionalMessage(call.arguments[2], sourceFile);
    const operation = memberCallExpression(call.arguments[0]!, variables, sourceFile);
    if (operation.method !== "get" || operation.arguments.length !== 1) {
      throw unsupported(call.arguments[0]!, "URLSearchParams.get(name) assertions", sourceFile);
    }
    const expectedExpression = call.arguments[1]!;
    const expected = expectedExpression.kind === ts.SyntaxKind.NullKeyword
      ? null
      : stringLiteral(expectedExpression, "assert_equals expected value", sourceFile);
    return {
      kind: "urlSearchParamsAssertGet",
      slot: operation.slot,
      name: webIdlString(operation.arguments[0]!, sourceFile),
      expected,
      ...(message === undefined ? {} : {message}),
      span: spanOf(call, sourceFile),
    };
  }
  if (
    (call.expression.text === "assert_true" || call.expression.text === "assert_false")
    && call.arguments.length >= 1
    && call.arguments.length <= 2
  ) {
    const message = optionalMessage(call.arguments[1], sourceFile);
    const actual = call.arguments[0]!;
    if (
      call.expression.text === "assert_true"
      && ts.isBinaryExpression(actual)
      && actual.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      && ts.isIdentifier(actual.left)
      && actual.right.kind === ts.SyntaxKind.NullKeyword
    ) {
      return {
        kind: "urlSearchParamsAssertConstructed",
        slot: variableSlot(actual.left, variables, sourceFile),
        ...(message === undefined ? {} : {message}),
        span: spanOf(call, sourceFile),
      };
    }
    const operation = memberCallExpression(actual, variables, sourceFile);
    if (operation.method !== "has" || operation.arguments.length < 1 || operation.arguments.length > 2) {
      throw unsupported(actual, "URLSearchParams.has(name[, value]) assertions", sourceFile);
    }
    const value = optionalWebIdlString(operation.arguments[1], sourceFile);
    return {
      kind: "urlSearchParamsAssertHas",
      slot: operation.slot,
      name: webIdlString(operation.arguments[0]!, sourceFile),
      ...(value === undefined ? {} : {value}),
      expected: call.expression.text === "assert_true",
      ...(message === undefined ? {} : {message}),
      span: spanOf(call, sourceFile),
    };
  }
  throw unsupported(call, "assert_equals(...), assert_true(...), or assert_false(...)", sourceFile);
}

function memberCallExpression(
  expression: ts.Expression,
  variables: ReadonlyMap<string, number>,
  sourceFile: ts.SourceFile,
): MemberCall {
  if (ts.isCallExpression(expression)) {
    return memberCall(expression, variables, sourceFile);
  }
  throw unsupported(expression, "URLSearchParams method calls", sourceFile);
}

function memberCall(
  expression: ts.CallExpression,
  variables: ReadonlyMap<string, number>,
  sourceFile: ts.SourceFile,
): MemberCall {
  if (
    ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
  ) {
    return {
      slot: variableSlot(expression.expression.expression, variables, sourceFile),
      method: expression.expression.name.text,
      arguments: expression.arguments,
    };
  }
  throw unsupported(expression, "URLSearchParams method calls", sourceFile);
}

function variableSlot(
  identifier: ts.Identifier,
  variables: ReadonlyMap<string, number>,
  sourceFile: ts.SourceFile,
): number {
  const slot = variables.get(identifier.text);
  if (slot === undefined) {
    throw tinyError("TINYWPT3", `unknown URLSearchParams variable \`${identifier.text}\``, identifier, undefined, sourceFile);
  }
  return slot;
}

function optionalWebIdlString(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (expression === undefined || (ts.isIdentifier(expression) && expression.text === "undefined")) {
    return undefined;
  }
  return webIdlString(expression, sourceFile);
}

function webIdlString(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) {
    return String(Number(expression.text));
  }
  if (ts.isBigIntLiteral(expression)) {
    return expression.text.slice(0, -1);
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return "null";
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return "true";
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return "false";
  }
  if (ts.isIdentifier(expression) && expression.text === "undefined") {
    return "undefined";
  }
  throw unsupported(expression, "closed primitive Web IDL string conversion", sourceFile);
}

function optionalMessage(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): string | undefined {
  return expression === undefined ? undefined : stringLiteral(expression, "assertion message", sourceFile);
}

function stringLiteral(expression: ts.Expression, role: string, sourceFile: ts.SourceFile): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  throw unsupported(expression, `${role} as a closed string`, sourceFile);
}

function unsupported(node: ts.Node, expected: string, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError("TINYWPT2", `native WPT cases currently support only ${expected}`, node, undefined, sourceFile);
}
