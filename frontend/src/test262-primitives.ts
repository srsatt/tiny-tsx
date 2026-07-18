import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface PrimitiveIdentityProgramAssertion {
  kind: "primitiveIdentityProgram";
  checks: PrimitiveIdentityCheck[];
  span: SourceSpan;
}

export interface PrimitiveIdentityCheck {
  comparison: "sameValue" | "notSameValue";
  actual: PrimitiveExpression;
  expected: PrimitiveExpression;
  span: SourceSpan;
}

export type PrimitiveExpression =
  | {
      kind: "number";
      value: "positiveZero" | "negativeZero" | "nan" | "positiveInfinity";
    }
  | {kind: "symbol"; id: number; description?: string}
  | {kind: "string"; value: string}
  | {kind: "boolean"; value: boolean}
  | {kind: "typeOf"; value: PrimitiveExpression}
  | {kind: "isFinite"; value: PrimitiveExpression}
  | {kind: "isNaN"; value: PrimitiveExpression};

export function isPrimitiveIdentityProgram(sourceFile: ts.SourceFile): boolean {
  return tryLowerProgram(sourceFile) !== undefined;
}

export function lowerPrimitiveIdentityProgram(
  sourceFile: ts.SourceFile,
): PrimitiveIdentityProgramAssertion {
  return tryLowerProgram(sourceFile)
    ?? (() => {
      throw tinyError(
        "TINY2614",
        "Test262 primitive identity program is outside the bounded special-value subset",
        sourceFile,
        undefined,
        sourceFile,
      );
    })();
}

function tryLowerProgram(sourceFile: ts.SourceFile): PrimitiveIdentityProgramAssertion | undefined {
  const state = {nextSymbolId: 0};
  const checks: PrimitiveIdentityCheck[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      return undefined;
    }
    const call = statement.expression;
    if (
      !ts.isPropertyAccessExpression(call.expression)
      || !ts.isIdentifier(call.expression.expression)
      || call.expression.expression.text !== "assert"
      || !["sameValue", "notSameValue"].includes(call.expression.name.text)
      || call.arguments.length < 2
      || call.arguments.length > 3
    ) {
      return undefined;
    }
    const actual = lowerExpression(call.arguments[0]!, state);
    const expected = lowerExpression(call.arguments[1]!, state);
    if (actual === undefined || expected === undefined) return undefined;
    checks.push({
      comparison: call.expression.name.text as "sameValue" | "notSameValue",
      actual,
      expected,
      span: spanOf(statement, sourceFile),
    });
  }
  return checks.length === 0 || checks.length > 16
    ? undefined
    : {kind: "primitiveIdentityProgram", checks, span: spanOf(sourceFile, sourceFile)};
}

function lowerExpression(
  expression: ts.Expression,
  state: {nextSymbolId: number},
): PrimitiveExpression | undefined {
  const value = unwrap(expression);
  if (ts.isStringLiteral(value)) return {kind: "string", value: value.text};
  if (value.kind === ts.SyntaxKind.TrueKeyword) return {kind: "boolean", value: true};
  if (value.kind === ts.SyntaxKind.FalseKeyword) return {kind: "boolean", value: false};
  if (ts.isNumericLiteral(value) && Number(value.text) === 0) {
    return {kind: "number", value: "positiveZero"};
  }
  if (
    ts.isPrefixUnaryExpression(value)
    && value.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(value.operand)
    && Number(value.operand.text) === 0
  ) {
    return {kind: "number", value: "negativeZero"};
  }
  if (ts.isIdentifier(value) && value.text === "NaN") {
    return {kind: "number", value: "nan"};
  }
  if (ts.isIdentifier(value) && value.text === "Infinity") {
    return {kind: "number", value: "positiveInfinity"};
  }
  if (
    ts.isPropertyAccessExpression(value)
    && ts.isIdentifier(value.expression)
    && value.expression.text === "Number"
    && value.name.text === "POSITIVE_INFINITY"
  ) {
    return {kind: "number", value: "positiveInfinity"};
  }
  if (ts.isTypeOfExpression(value)) {
    const operand = lowerExpression(value.expression, state);
    return operand === undefined ? undefined : {kind: "typeOf", value: operand};
  }
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    if (["isFinite", "isNaN"].includes(value.expression.text) && value.arguments.length === 1) {
      const operand = lowerExpression(value.arguments[0]!, state);
      if (operand === undefined) return undefined;
      return value.expression.text === "isFinite"
        ? {kind: "isFinite", value: operand}
        : {kind: "isNaN", value: operand};
    }
    if (value.expression.text === "Symbol" && value.arguments.length <= 1) {
      const argument = value.arguments[0] === undefined ? undefined : unwrap(value.arguments[0]);
      const description = argument === undefined || ts.isIdentifier(argument) && argument.text === "undefined"
        ? undefined
        : ts.isStringLiteral(argument)
          ? argument.text
          : argument.kind === ts.SyntaxKind.NullKeyword
            ? "null"
            : undefined;
      if (argument !== undefined && description === undefined && !(
        ts.isIdentifier(argument) && argument.text === "undefined"
      )) return undefined;
      return {
        kind: "symbol",
        id: state.nextSymbolId++,
        ...(description === undefined ? {} : {description}),
      };
    }
  }
  return undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}
