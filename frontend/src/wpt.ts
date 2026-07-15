import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface WptProgram {
  version: 1;
  target: "aarch64-apple-darwin";
  entry: string;
  assertions: WptAssertion[];
}

export type WptAssertion =
  | UrlSearchParamsConstructedAssertion
  | UrlSearchParamsGetAssertion
  | UrlSearchParamsHasAssertion;

interface WptAssertionBase {
  query: string;
  message?: string;
  testName: string;
  span: SourceSpan;
}

export interface UrlSearchParamsConstructedAssertion extends WptAssertionBase {
  kind: "urlSearchParamsConstructed";
}

export interface UrlSearchParamsGetAssertion extends WptAssertionBase {
  kind: "urlSearchParamsGet";
  name: string;
  expected: string | null;
}

export interface UrlSearchParamsHasAssertion extends WptAssertionBase {
  kind: "urlSearchParamsHas";
  name: string;
  expected: boolean;
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

  const assertions = sourceFile.statements.flatMap(statement => lowerTest(statement, sourceFile));
  if (assertions.length === 0) {
    throw tinyError("TINYWPT1", "WPT case must contain an assertion", sourceFile, undefined, sourceFile);
  }
  return {version: 1, target: "aarch64-apple-darwin", entry, assertions};
}

function lowerTest(statement: ts.Statement, sourceFile: ts.SourceFile): WptAssertion[] {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    throw unsupported(statement, "top-level WPT test(...) calls", sourceFile);
  }
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "test" || call.arguments.length !== 2) {
    throw unsupported(call, "top-level WPT test(callback, name) calls", sourceFile);
  }
  const [callback, nameExpression] = call.arguments;
  const testName = stringLiteral(nameExpression!, "WPT test name", sourceFile);
  if ((!ts.isFunctionExpression(callback!) && !ts.isArrowFunction(callback!)) || !ts.isBlock(callback!.body)) {
    throw unsupported(callback!, "WPT test callbacks with block bodies", sourceFile);
  }

  const variables = new Map<string, string>();
  const assertions: WptAssertion[] = [];
  for (const callbackStatement of callback!.body.statements) {
    if (ts.isVariableStatement(callbackStatement)) {
      lowerVariable(callbackStatement, variables, sourceFile);
    } else if (isUrlSearchParamsAssignment(callbackStatement)) {
      const assignment = callbackStatement.expression as ts.BinaryExpression;
      variables.set(
        (assignment.left as ts.Identifier).text,
        urlSearchParamsInput(assignment.right, sourceFile),
      );
    } else if (ts.isExpressionStatement(callbackStatement) && ts.isCallExpression(callbackStatement.expression)) {
      assertions.push(lowerAssertion(callbackStatement.expression, variables, testName, sourceFile));
    } else {
      throw unsupported(callbackStatement, "URLSearchParams declarations, assignments, and assertions", sourceFile);
    }
  }
  return assertions;
}

function lowerVariable(
  statement: ts.VariableStatement,
  variables: Map<string, string>,
  sourceFile: ts.SourceFile,
): void {
  if (statement.declarationList.declarations.length !== 1) {
    throw unsupported(statement, "one URLSearchParams declaration per statement", sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupported(declaration, "initialized URLSearchParams variables", sourceFile);
  }
  variables.set(declaration.name.text, urlSearchParamsInput(declaration.initializer, sourceFile));
}

function isUrlSearchParamsAssignment(statement: ts.Statement): statement is ts.ExpressionStatement {
  return ts.isExpressionStatement(statement)
    && ts.isBinaryExpression(statement.expression)
    && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(statement.expression.left);
}

function urlSearchParamsInput(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (
    ts.isNewExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "URLSearchParams"
    && expression.arguments?.length === 1
  ) {
    return stringLiteral(expression.arguments[0]!, "URLSearchParams input", sourceFile);
  }
  throw unsupported(expression, "new URLSearchParams(string)", sourceFile);
}

function lowerAssertion(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, string>,
  testName: string,
  sourceFile: ts.SourceFile,
): WptAssertion {
  if (!ts.isIdentifier(call.expression)) {
    throw unsupported(call, "assert_equals(...) or assert_true(...)", sourceFile);
  }
  if (call.expression.text === "assert_equals" && call.arguments.length >= 2 && call.arguments.length <= 3) {
    const message = optionalMessage(call.arguments[2], sourceFile);
    const operation = memberCall(call.arguments[0]!, variables, sourceFile);
    if (operation.method !== "get") {
      throw unsupported(call.arguments[0]!, "URLSearchParams.get(...) assertions", sourceFile);
    }
    const expectedExpression = call.arguments[1]!;
    const expected = expectedExpression.kind === ts.SyntaxKind.NullKeyword
      ? null
      : stringLiteral(expectedExpression, "assert_equals expected value", sourceFile);
    return {
      kind: "urlSearchParamsGet",
      query: operation.query,
      name: operation.name,
      expected,
      ...(message === undefined ? {} : {message}),
      testName,
      span: spanOf(call, sourceFile),
    };
  }
  if (call.expression.text === "assert_true" && call.arguments.length >= 1 && call.arguments.length <= 2) {
    const message = optionalMessage(call.arguments[1], sourceFile);
    const actual = call.arguments[0]!;
    if (
      ts.isBinaryExpression(actual)
      && actual.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      && ts.isIdentifier(actual.left)
      && actual.right.kind === ts.SyntaxKind.NullKeyword
    ) {
      return {
        kind: "urlSearchParamsConstructed",
        query: variableQuery(actual.left, variables, sourceFile),
        ...(message === undefined ? {} : {message}),
        testName,
        span: spanOf(call, sourceFile),
      };
    }
    const operation = memberCall(actual, variables, sourceFile);
    if (operation.method !== "has") {
      throw unsupported(actual, "URLSearchParams.has(...) assertions", sourceFile);
    }
    return {
      kind: "urlSearchParamsHas",
      query: operation.query,
      name: operation.name,
      expected: true,
      ...(message === undefined ? {} : {message}),
      testName,
      span: spanOf(call, sourceFile),
    };
  }
  throw unsupported(call, "assert_equals(...) or assert_true(...)", sourceFile);
}

function memberCall(
  expression: ts.Expression,
  variables: ReadonlyMap<string, string>,
  sourceFile: ts.SourceFile,
): {query: string; method: string; name: string} {
  if (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.arguments.length === 1
  ) {
    return {
      query: variableQuery(expression.expression.expression, variables, sourceFile),
      method: expression.expression.name.text,
      name: stringLiteral(expression.arguments[0]!, "URLSearchParams method name", sourceFile),
    };
  }
  throw unsupported(expression, "URLSearchParams method calls", sourceFile);
}

function variableQuery(
  identifier: ts.Identifier,
  variables: ReadonlyMap<string, string>,
  sourceFile: ts.SourceFile,
): string {
  const query = variables.get(identifier.text);
  if (query === undefined) {
    throw tinyError("TINYWPT3", `unknown URLSearchParams variable \`${identifier.text}\``, identifier, undefined, sourceFile);
  }
  return query;
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
