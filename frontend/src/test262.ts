import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface Test262Program {
  version: 1;
  target: "aarch64-apple-darwin";
  entry: string;
  assertions: SameValueStringAssertion[];
}

export interface SameValueStringAssertion {
  kind: "sameValueString";
  actual: string;
  expected: string;
  message?: string;
  span: SourceSpan;
}

export function compileTest262Entry(entryPath: string): Test262Program {
  const entry = path.resolve(entryPath);
  let source: string;
  try {
    source = readFileSync(entry, "utf8");
  } catch (error) {
    throw new CompileFailure([{
      code: "TINY2600",
      message: `could not load Test262 case ${entry}: ${String(error)}`,
    }]);
  }
  const sourceFile = ts.createSourceFile(
    entry,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {parseDiagnostics?: readonly ts.Diagnostic[]}
  ).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    throw new CompileFailure(parseDiagnostics.map(fromTypeScript));
  }
  if (!source.includes("/*---") || !source.includes("---*/")) {
    throw tinyError("TINY2601", "Test262 metadata block is required", sourceFile, undefined, sourceFile);
  }

  const assertions = sourceFile.statements.map(statement =>
    lowerSameValueAssertion(statement, sourceFile)
  );
  if (assertions.length === 0) {
    throw tinyError("TINY2602", "Test262 case must contain an assertion", sourceFile, undefined, sourceFile);
  }
  return {
    version: 1,
    target: "aarch64-apple-darwin",
    entry,
    assertions,
  };
}

function lowerSameValueAssertion(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): SameValueStringAssertion {
  if (
    !ts.isExpressionStatement(statement)
    || !ts.isCallExpression(statement.expression)
    || !ts.isPropertyAccessExpression(statement.expression.expression)
    || !ts.isIdentifier(statement.expression.expression.expression)
    || statement.expression.expression.expression.text !== "assert"
    || statement.expression.expression.name.text !== "sameValue"
  ) {
    throw tinyError(
      "TINY2603",
      "native Test262 cases currently support only top-level assert.sameValue calls",
      statement,
      undefined,
      sourceFile,
    );
  }
  const [actual, expected, message, ...extra] = statement.expression.arguments;
  if (actual === undefined || expected === undefined || extra.length > 0) {
    throw tinyError(
      "TINY2604",
      "assert.sameValue requires two values and an optional message",
      statement.expression,
      undefined,
      sourceFile,
    );
  }
  const loweredMessage = message === undefined
    ? undefined
    : stringLiteral(message, "assert.sameValue message", sourceFile);
  return {
    kind: "sameValueString",
    actual: stringValue(actual, sourceFile),
    expected: stringLiteral(expected, "assert.sameValue expected value", sourceFile),
    ...(loweredMessage === undefined ? {} : {message: loweredMessage}),
    span: spanOf(statement.expression, sourceFile),
  };
}

function stringValue(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isTypeOfExpression(expression)) {
    const operand = expression.expression;
    if (
      (ts.isIdentifier(operand) && operand.text === "undefined")
      || (ts.isVoidExpression(operand) && ts.isNumericLiteral(operand.expression))
    ) {
      return "undefined";
    }
  }
  return stringLiteral(expression, "assert.sameValue actual value", sourceFile);
}

function stringLiteral(
  expression: ts.Expression,
  role: string,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  throw tinyError(
    "TINY2605",
    `${role} is not a supported closed string`,
    expression,
    undefined,
    sourceFile,
  );
}
