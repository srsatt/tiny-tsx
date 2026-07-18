import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";
import {
  isArraySpreadApplyProgram,
  lowerArraySpreadApplyProgram,
  type ArraySpreadApplyProgramAssertion,
} from "./test262-array-spread.js";
import {
  isNumericSubtractionProgram,
  lowerNumericSubtractionProgram,
  type NumericSubtractionProgramAssertion,
} from "./test262-subtraction.js";
import {
  isRecordMembershipProgram,
  lowerRecordMembershipProgram,
  type RecordMembershipProgramAssertion,
} from "./test262-membership.js";
import {
  isThrowCatchProgram,
  lowerThrowCatchProgram,
  type ThrowCatchProgramAssertion,
} from "./test262-throw.js";
import {
  isDateNowTypeProgram,
  lowerDateNowTypeProgram,
  type DateNowTypeProgramAssertion,
} from "./test262-date-now.js";
import {
  isClassConstructorProgram,
  lowerClassConstructorProgram,
  type ClassConstructorProgramAssertion,
} from "./test262-class.js";
import {
  isErrorMessageProgram,
  lowerErrorMessageProgram,
  type ErrorMessageProgramAssertion,
} from "./test262-error.js";
import {
  isRegExpTestProgram,
  lowerRegExpTestProgram,
  type RegExpTestProgramAssertion,
} from "./test262-regexp.js";
import {
  isModuleFunctionBindingProgram,
  lowerModuleFunctionBindingProgram,
  type ModuleFunctionBindingProgramAssertion,
} from "./test262-module-function.js";
import {
  isAsyncPromiseBrandProgram,
  lowerAsyncPromiseBrandProgram,
  type AsyncPromiseBrandProgramAssertion,
} from "./test262-async.js";
import {
  isPrimitiveIdentityProgram,
  lowerPrimitiveIdentityProgram,
  type PrimitiveIdentityProgramAssertion,
} from "./test262-primitives.js";
import {
  isMapProgram,
  lowerMapProgram,
  type MapProgramAssertion,
} from "./test262-map.js";

export interface Test262Program {
  version: 3;
  target: "aarch64-apple-darwin";
  entry: string;
  assertions: Test262Assertion[];
}

export type Test262Assertion =
  | SameValueStringAssertion
  | ForThrowCounterAssertion
  | ArrayUnshiftProgramAssertion
  | ArraySpreadApplyProgramAssertion
  | NumericSubtractionProgramAssertion
  | RecordMembershipProgramAssertion
  | ThrowCatchProgramAssertion
  | DateNowTypeProgramAssertion
  | ClassConstructorProgramAssertion
  | ErrorMessageProgramAssertion
  | RegExpTestProgramAssertion
  | ModuleFunctionBindingProgramAssertion
  | AsyncPromiseBrandProgramAssertion
  | PrimitiveIdentityProgramAssertion
  | MapProgramAssertion;

export interface SameValueStringAssertion {
  kind: "sameValueString";
  actual: string;
  expected: string;
  message?: string;
  span: SourceSpan;
}

export interface ForThrowCounterAssertion {
  kind: "forThrowCounter";
  initial: number;
  threshold: number;
  thrown: number;
  catchExpected: number;
  finalExpected: number;
  span: SourceSpan;
}

export interface ArrayUnshiftProgramAssertion {
  kind: "arrayUnshiftProgram";
  capacity: 16;
  operations: ArrayUnshiftOperation[];
  span: SourceSpan;
}

export type ArrayUnshiftOperation =
  | {kind: "unshift"; values: number[]; span: SourceSpan}
  | {kind: "assertResult"; expected: number; span: SourceSpan}
  | {kind: "assertElement"; index: number; expected: number | null; span: SourceSpan}
  | {kind: "assertLength"; expected: number; span: SourceSpan};

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

  const assertions = isAsyncPromiseBrandProgram(sourceFile)
    ? [lowerAsyncPromiseBrandProgram(sourceFile)]
    : isModuleFunctionBindingProgram(sourceFile)
      ? [lowerModuleFunctionBindingProgram(sourceFile)]
    : isRegExpTestProgram(sourceFile)
      ? [lowerRegExpTestProgram(sourceFile)]
    : isErrorMessageProgram(sourceFile)
      ? [lowerErrorMessageProgram(sourceFile)]
    : isClassConstructorProgram(sourceFile)
      ? [lowerClassConstructorProgram(sourceFile)]
    : isDateNowTypeProgram(sourceFile)
      ? [lowerDateNowTypeProgram(sourceFile)]
    : isPrimitiveIdentityProgram(sourceFile)
      ? [lowerPrimitiveIdentityProgram(sourceFile)]
    : isMapProgram(sourceFile)
      ? [lowerMapProgram(sourceFile)]
    : sourceFile.statements.every(isSameValueStatement)
    ? sourceFile.statements.map(statement => lowerSameValueAssertion(statement, sourceFile))
    : isArraySpreadApplyProgram(sourceFile)
      ? [lowerArraySpreadApplyProgram(sourceFile)]
    : isNumericSubtractionProgram(sourceFile)
      ? [lowerNumericSubtractionProgram(sourceFile)]
    : isRecordMembershipProgram(sourceFile)
      ? [lowerRecordMembershipProgram(sourceFile)]
    : isThrowCatchProgram(sourceFile)
      ? [lowerThrowCatchProgram(sourceFile)]
    : isEmptyArrayDeclaration(sourceFile.statements[0])
      ? [lowerArrayUnshiftProgram(sourceFile)]
      : [lowerForThrowCounter(sourceFile)];
  if (assertions.length === 0) {
    throw tinyError("TINY2602", "Test262 case must contain an assertion", sourceFile, undefined, sourceFile);
  }
  return {
    version: 3,
    target: "aarch64-apple-darwin",
    entry,
    assertions,
  };
}

function isEmptyArrayDeclaration(statement: ts.Statement | undefined): boolean {
  if (
    statement === undefined
    || !ts.isVariableStatement(statement)
    || statement.declarationList.declarations.length !== 1
  ) {
    return false;
  }
  const declaration = statement.declarationList.declarations[0]!;
  return ts.isIdentifier(declaration.name)
    && declaration.initializer !== undefined
    && ts.isNewExpression(declaration.initializer)
    && ts.isIdentifier(declaration.initializer.expression)
    && declaration.initializer.expression.text === "Array"
    && (declaration.initializer.arguments?.length ?? 0) === 0;
}

function lowerArrayUnshiftProgram(sourceFile: ts.SourceFile): ArrayUnshiftProgramAssertion {
  const [declaration, ...statements] = sourceFile.statements;
  if (declaration === undefined || !isEmptyArrayDeclaration(declaration)) {
    throw unsupportedArrayProgram(declaration ?? sourceFile, sourceFile);
  }
  const arrayDeclaration = (declaration as ts.VariableStatement).declarationList.declarations[0]!;
  const arrayName = (arrayDeclaration.name as ts.Identifier).text;
  let resultName: string | undefined;
  const operations: ArrayUnshiftOperation[] = [];

  for (const statement of statements) {
    const unshift = arrayUnshiftDeclaration(statement, arrayName, sourceFile);
    if (unshift !== undefined) {
      resultName = unshift.resultName;
      operations.push({
        kind: "unshift",
        values: unshift.values,
        span: spanOf(statement, sourceFile),
      });
      continue;
    }
    if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) {
      throw unsupportedArrayProgram(statement, sourceFile);
    }
    if (!isTest262ErrorThrow(statement.thenStatement)) {
      throw unsupportedArrayProgram(statement.thenStatement, sourceFile);
    }
    const comparison = strictNotEqual(statement.expression, sourceFile);
    const expected = integerOrUndefined(comparison.right, sourceFile);
    if (ts.isIdentifier(comparison.left) && comparison.left.text === resultName) {
      if (expected === null) throw unsupportedArrayProgram(comparison.right, sourceFile);
      operations.push({
        kind: "assertResult",
        expected,
        span: spanOf(statement, sourceFile),
      });
      continue;
    }
    if (
      ts.isElementAccessExpression(comparison.left)
      && ts.isIdentifier(comparison.left.expression)
      && comparison.left.expression.text === arrayName
      && comparison.left.argumentExpression !== undefined
    ) {
      operations.push({
        kind: "assertElement",
        index: nonNegativeIntegerLiteral(comparison.left.argumentExpression, sourceFile),
        expected,
        span: spanOf(statement, sourceFile),
      });
      continue;
    }
    if (
      ts.isPropertyAccessExpression(comparison.left)
      && ts.isIdentifier(comparison.left.expression)
      && comparison.left.expression.text === arrayName
      && comparison.left.name.text === "length"
      && expected !== null
    ) {
      operations.push({
        kind: "assertLength",
        expected,
        span: spanOf(statement, sourceFile),
      });
      continue;
    }
    throw unsupportedArrayProgram(comparison.left, sourceFile);
  }

  if (!operations.some(operation => operation.kind === "unshift")) {
    throw unsupportedArrayProgram(sourceFile, sourceFile);
  }
  return {
    kind: "arrayUnshiftProgram",
    capacity: 16,
    operations,
    span: spanOf(sourceFile, sourceFile),
  };
}

function arrayUnshiftDeclaration(
  statement: ts.Statement,
  arrayName: string,
  sourceFile: ts.SourceFile,
): {resultName: string; values: number[]} | undefined {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    return undefined;
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name)
    || declaration.initializer === undefined
    || !ts.isCallExpression(declaration.initializer)
    || !ts.isPropertyAccessExpression(declaration.initializer.expression)
    || !ts.isIdentifier(declaration.initializer.expression.expression)
    || declaration.initializer.expression.expression.text !== arrayName
    || declaration.initializer.expression.name.text !== "unshift"
  ) {
    return undefined;
  }
  return {
    resultName: declaration.name.text,
    values: declaration.initializer.arguments.map(argument => integerLiteral(argument, sourceFile)),
  };
}

function strictNotEqual(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): {left: ts.Expression; right: ts.Expression} {
  if (
    !ts.isBinaryExpression(expression)
    || expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    throw unsupportedArrayProgram(expression, sourceFile);
  }
  return {left: expression.left, right: expression.right};
}

function integerOrUndefined(expression: ts.Expression, sourceFile: ts.SourceFile): number | null {
  if (ts.isIdentifier(expression) && expression.text === "undefined") return null;
  return integerLiteral(expression, sourceFile);
}

function nonNegativeIntegerLiteral(expression: ts.Expression, sourceFile: ts.SourceFile): number {
  const value = integerLiteral(expression, sourceFile);
  if (value < 0) throw unsupportedArrayProgram(expression, sourceFile);
  return value;
}

function unsupportedArrayProgram(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2608",
    "native Test262 arrays currently support a closed dense numeric Array/unshift program",
    node,
    undefined,
    sourceFile,
  );
}

function isSameValueStatement(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && ts.isPropertyAccessExpression(statement.expression.expression)
    && ts.isIdentifier(statement.expression.expression.expression)
    && statement.expression.expression.expression.text === "assert"
    && statement.expression.expression.name.text === "sameValue";
}

function lowerForThrowCounter(sourceFile: ts.SourceFile): ForThrowCounterAssertion {
  const [declaration, tryStatement, finalCheck, ...extra] = sourceFile.statements;
  if (
    declaration === undefined
    || tryStatement === undefined
    || finalCheck === undefined
    || extra.length > 0
  ) {
    throw unsupportedControlFlow(sourceFile, sourceFile);
  }
  const binding = numericVariable(declaration, sourceFile);
  if (!ts.isTryStatement(tryStatement) || tryStatement.finallyBlock !== undefined) {
    throw unsupportedControlFlow(tryStatement, sourceFile);
  }
  const [loop, ...tryExtra] = tryStatement.tryBlock.statements;
  if (
    loop === undefined
    || tryExtra.length > 0
    || !ts.isForStatement(loop)
    || loop.initializer !== undefined
    || loop.condition !== undefined
    || loop.incrementor !== undefined
  ) {
    throw unsupportedControlFlow(tryStatement.tryBlock, sourceFile);
  }
  const loopCheck = onlyStatement(loop.statement, sourceFile);
  if (!ts.isIfStatement(loopCheck) || loopCheck.elseStatement !== undefined) {
    throw unsupportedControlFlow(loopCheck, sourceFile);
  }
  const {name: incremented, right: thresholdExpression} = binaryWithIdentifier(
    loopCheck.expression,
    ts.SyntaxKind.GreaterThanToken,
    sourceFile,
    true,
  );
  if (incremented !== binding.name) {
    throw unsupportedControlFlow(loopCheck.expression, sourceFile);
  }
  const thrown = numericThrow(loopCheck.thenStatement, sourceFile);

  const catchClause = tryStatement.catchClause;
  if (
    catchClause === undefined
    || catchClause.variableDeclaration === undefined
    || !ts.isIdentifier(catchClause.variableDeclaration.name)
  ) {
    throw unsupportedControlFlow(tryStatement, sourceFile);
  }
  const catchCheck = onlyStatement(catchClause.block, sourceFile);
  if (!ts.isIfStatement(catchCheck) || catchCheck.elseStatement !== undefined) {
    throw unsupportedControlFlow(catchCheck, sourceFile);
  }
  const {name: caught, right: catchExpectedExpression} = binaryWithIdentifier(
    catchCheck.expression,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    sourceFile,
  );
  if (caught !== catchClause.variableDeclaration.name.text || !isTest262ErrorThrow(catchCheck.thenStatement)) {
    throw unsupportedControlFlow(catchCheck, sourceFile);
  }

  if (!ts.isIfStatement(finalCheck) || finalCheck.elseStatement !== undefined) {
    throw unsupportedControlFlow(finalCheck, sourceFile);
  }
  const {name: finalName, right: finalExpectedExpression} = binaryWithIdentifier(
    finalCheck.expression,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    sourceFile,
  );
  if (finalName !== binding.name || !isTest262ErrorThrow(finalCheck.thenStatement)) {
    throw unsupportedControlFlow(finalCheck, sourceFile);
  }

  return {
    kind: "forThrowCounter",
    initial: binding.initial,
    threshold: integerLiteral(thresholdExpression, sourceFile),
    thrown,
    catchExpected: integerLiteral(catchExpectedExpression, sourceFile),
    finalExpected: integerLiteral(finalExpectedExpression, sourceFile),
    span: spanOf(tryStatement, sourceFile),
  };
}

function numericVariable(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {name: string; initial: number} {
  if (
    !ts.isVariableStatement(statement)
    || statement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedControlFlow(statement, sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupportedControlFlow(declaration, sourceFile);
  }
  return {
    name: declaration.name.text,
    initial: integerLiteral(declaration.initializer, sourceFile),
  };
}

function onlyStatement(statement: ts.Statement, sourceFile: ts.SourceFile): ts.Statement {
  if (!ts.isBlock(statement) || statement.statements.length !== 1) {
    throw unsupportedControlFlow(statement, sourceFile);
  }
  return statement.statements[0]!;
}

function binaryWithIdentifier(
  expression: ts.Expression,
  operator: ts.SyntaxKind,
  sourceFile: ts.SourceFile,
  preIncrement = false,
): {name: string; right: ts.Expression} {
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== operator) {
    throw unsupportedControlFlow(expression, sourceFile);
  }
  const left = preIncrement && ts.isPrefixUnaryExpression(expression.left)
    && expression.left.operator === ts.SyntaxKind.PlusPlusToken
    ? expression.left.operand
    : expression.left;
  if (!ts.isIdentifier(left)) {
    throw unsupportedControlFlow(expression.left, sourceFile);
  }
  return {name: left.text, right: expression.right};
}

function numericThrow(statement: ts.Statement, sourceFile: ts.SourceFile): number {
  if (!ts.isThrowStatement(statement) || statement.expression === undefined) {
    throw unsupportedControlFlow(statement, sourceFile);
  }
  return integerLiteral(statement.expression, sourceFile);
}

function isTest262ErrorThrow(statement: ts.Statement): boolean {
  const candidate = ts.isBlock(statement) && statement.statements.length === 1
    ? statement.statements[0]
    : statement;
  return candidate !== undefined
    && ts.isThrowStatement(candidate)
    && candidate.expression !== undefined
    && ts.isNewExpression(candidate.expression)
    && ts.isIdentifier(candidate.expression.expression)
    && candidate.expression.expression.text === "Test262Error";
}

function integerLiteral(expression: ts.Expression, sourceFile: ts.SourceFile): number {
  let value: number | undefined;
  if (ts.isNumericLiteral(expression)) {
    value = Number(expression.text);
  } else if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) {
    value = -Number(expression.operand.text);
  }
  if (value === undefined || !Number.isSafeInteger(value)) {
    throw tinyError(
      "TINY2607",
      "native Test262 control flow requires a safe integer literal",
      expression,
      undefined,
      sourceFile,
    );
  }
  return value;
}

function unsupportedControlFlow(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2606",
    "native Test262 control flow currently supports a closed for/throw/catch counter program",
    node,
    undefined,
    sourceFile,
  );
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
    const kind = closedValueKind(expression.expression);
    if (kind !== undefined) return kind;
  }
  return stringLiteral(expression, "assert.sameValue actual value", sourceFile);
}

function closedValueKind(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && expression.text === "undefined") {
    return "undefined";
  }
  if (ts.isVoidExpression(expression) && ts.isNumericLiteral(expression.expression)) {
    return "undefined";
  }
  if (ts.isBigIntLiteral(expression)) {
    return "bigint";
  }
  if (ts.isNumericLiteral(expression)) {
    return "number";
  }
  if (
    ts.isCallExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.arguments.length === 1
  ) {
    const argument = expression.arguments[0]!;
    if (expression.expression.text === "BigInt") {
      const kind = closedValueKind(argument);
      return kind === "bigint" || kind === "number" ? "bigint" : undefined;
    }
    if (expression.expression.text === "Object") {
      return closedValueKind(argument) === undefined ? undefined : "object";
    }
  }
  return undefined;
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
