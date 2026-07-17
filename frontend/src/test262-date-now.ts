import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface DateNowTypeProgramAssertion {
  kind: "dateNowTypeProgram";
  expectedType: "number";
  span: SourceSpan;
}

export function isDateNowTypeProgram(sourceFile: ts.SourceFile): boolean {
  const statement = sourceFile.statements[0];
  if (statement === undefined || !ts.isExpressionStatement(statement)) return false;
  return containsDateNow(statement.expression);
}

export function lowerDateNowTypeProgram(sourceFile: ts.SourceFile): DateNowTypeProgramAssertion {
  const [statement, ...extra] = sourceFile.statements;
  if (
    statement === undefined
    || extra.length > 0
    || !ts.isExpressionStatement(statement)
    || !ts.isCallExpression(statement.expression)
    || !isAssertSameValue(statement.expression.expression)
  ) {
    throw unsupportedDateNow(sourceFile, sourceFile);
  }
  const [actual, expected] = statement.expression.arguments;
  if (
    actual === undefined
    || expected === undefined
    || !ts.isTypeOfExpression(actual)
    || !isDateNowCall(actual.expression)
    || !ts.isStringLiteralLike(expected)
    || expected.text !== "number"
  ) {
    throw unsupportedDateNow(statement, sourceFile);
  }
  return {
    kind: "dateNowTypeProgram",
    expectedType: "number",
    span: spanOf(statement, sourceFile),
  };
}

function containsDateNow(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && isDateNowCall(node)) return true;
  let found = false;
  ts.forEachChild(node, child => {
    if (!found && containsDateNow(child)) found = true;
  });
  return found;
}

function isDateNowCall(expression: ts.Expression): boolean {
  return ts.isCallExpression(expression)
    && expression.arguments.length === 0
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === "Date"
    && expression.expression.name.text === "now";
}

function isAssertSameValue(expression: ts.LeftHandSideExpression): boolean {
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "assert"
    && expression.name.text === "sameValue";
}

function unsupportedDateNow(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2613",
    "native Test262 Date.now supports the complete typeof-number assertion",
    node,
    undefined,
    sourceFile,
  );
}
