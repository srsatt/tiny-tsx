import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface ArraySpreadApplyProgramAssertion {
  kind: "arraySpreadApplyProgram";
  values: number[];
  expectedArguments: number[];
  expectedCalls: number;
  span: SourceSpan;
}

export function isArraySpreadApplyProgram(sourceFile: ts.SourceFile): boolean {
  const statement = sourceFile.statements[1];
  if (statement === undefined || !ts.isExpressionStatement(statement)) return false;
  const call = unwrapExpression(statement.expression);
  if (!ts.isCallExpression(call) || call.arguments.length !== 2) return false;
  const target = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(target) || target.name.text !== "apply") return false;
  const argumentsArray = unwrapExpression(call.arguments[1]!);
  return ts.isArrayLiteralExpression(argumentsArray)
    && argumentsArray.elements.length === 1
    && ts.isSpreadElement(argumentsArray.elements[0]!);
}

export function lowerArraySpreadApplyProgram(
  sourceFile: ts.SourceFile,
): ArraySpreadApplyProgramAssertion {
  const [counterStatement, applyStatement, finalStatement, ...extra] = sourceFile.statements;
  if (
    counterStatement === undefined
    || applyStatement === undefined
    || finalStatement === undefined
    || extra.length > 0
  ) {
    throw unsupportedArraySpread(sourceFile, sourceFile);
  }
  const counter = numericVariable(counterStatement, sourceFile);
  if (counter.initial !== 0 || !ts.isExpressionStatement(applyStatement)) {
    throw unsupportedArraySpread(counterStatement, sourceFile);
  }
  const call = unwrapExpression(applyStatement.expression);
  if (!ts.isCallExpression(call)) throw unsupportedArraySpread(applyStatement, sourceFile);
  const target = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(target) || target.name.text !== "apply") {
    throw unsupportedArraySpread(call.expression, sourceFile);
  }
  const callback = unwrapExpression(target.expression);
  if (!ts.isFunctionExpression(callback) || callback.parameters.length !== 0) {
    throw unsupportedArraySpread(target.expression, sourceFile);
  }
  const receiver = call.arguments[0];
  const spreadArray = call.arguments[1];
  if (receiver?.kind !== ts.SyntaxKind.NullKeyword || spreadArray === undefined) {
    throw unsupportedArraySpread(call, sourceFile);
  }
  const outerArray = unwrapExpression(spreadArray);
  if (
    !ts.isArrayLiteralExpression(outerArray)
    || outerArray.elements.length !== 1
    || !ts.isSpreadElement(outerArray.elements[0]!)
  ) {
    throw unsupportedArraySpread(spreadArray, sourceFile);
  }
  const sourceArray = unwrapExpression((outerArray.elements[0] as ts.SpreadElement).expression);
  if (!ts.isArrayLiteralExpression(sourceArray)) {
    throw unsupportedArraySpread(sourceArray, sourceFile);
  }
  const values = sourceArray.elements.map(element => {
    if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
      throw unsupportedArraySpread(element, sourceFile);
    }
    return integerLiteral(element, sourceFile);
  });

  const body = [...callback.body.statements];
  const increment = body.pop();
  if (!isCounterIncrement(increment, counter.name, sourceFile)) {
    throw unsupportedArraySpread(increment ?? callback.body, sourceFile);
  }
  const assertions = body.map(statement => numericSameValue(statement, sourceFile));
  const [lengthAssertion, ...elementAssertions] = assertions;
  if (
    lengthAssertion === undefined
    || !isArgumentsLength(lengthAssertion.actual)
    || lengthAssertion.expected !== values.length
    || elementAssertions.length !== values.length
  ) {
    throw unsupportedArraySpread(callback.body, sourceFile);
  }
  const expectedArguments = elementAssertions.map((assertion, index) => {
    if (argumentsIndex(assertion.actual, sourceFile) !== index) {
      throw unsupportedArraySpread(assertion.actual, sourceFile);
    }
    return assertion.expected;
  });
  const finalAssertion = numericSameValue(finalStatement, sourceFile);
  if (!ts.isIdentifier(finalAssertion.actual) || finalAssertion.actual.text !== counter.name) {
    throw unsupportedArraySpread(finalAssertion.actual, sourceFile);
  }
  return {
    kind: "arraySpreadApplyProgram",
    values,
    expectedArguments,
    expectedCalls: finalAssertion.expected,
    span: spanOf(applyStatement, sourceFile),
  };
}

function numericVariable(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {name: string; initial: number} {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    throw unsupportedArraySpread(statement, sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupportedArraySpread(declaration, sourceFile);
  }
  return {
    name: declaration.name.text,
    initial: integerLiteral(declaration.initializer, sourceFile),
  };
}

function numericSameValue(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {actual: ts.Expression; expected: number} {
  if (!isSameValueStatement(statement)) throw unsupportedArraySpread(statement, sourceFile);
  const call = statement.expression;
  const [actual, expected] = call.arguments;
  if (actual === undefined || expected === undefined) {
    throw unsupportedArraySpread(call, sourceFile);
  }
  return {actual: unwrapExpression(actual), expected: integerLiteral(expected, sourceFile)};
}

function isSameValueStatement(statement: ts.Statement): statement is ts.ExpressionStatement & {
  expression: ts.CallExpression;
} {
  return ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && ts.isPropertyAccessExpression(statement.expression.expression)
    && ts.isIdentifier(statement.expression.expression.expression)
    && statement.expression.expression.expression.text === "assert"
    && statement.expression.expression.name.text === "sameValue";
}

function isArgumentsLength(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "arguments"
    && expression.name.text === "length";
}

function argumentsIndex(expression: ts.Expression, sourceFile: ts.SourceFile): number {
  if (
    !ts.isElementAccessExpression(expression)
    || !ts.isIdentifier(expression.expression)
    || expression.expression.text !== "arguments"
    || expression.argumentExpression === undefined
  ) {
    throw unsupportedArraySpread(expression, sourceFile);
  }
  const index = integerLiteral(expression.argumentExpression, sourceFile);
  if (index < 0) throw unsupportedArraySpread(expression.argumentExpression, sourceFile);
  return index;
}

function isCounterIncrement(
  statement: ts.Statement | undefined,
  counter: string,
  sourceFile: ts.SourceFile,
): boolean {
  if (statement === undefined || !ts.isExpressionStatement(statement)) return false;
  const expression = statement.expression;
  return ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
    && ts.isIdentifier(expression.left)
    && expression.left.text === counter
    && integerLiteral(expression.right, sourceFile) === 1;
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
    throw unsupportedArraySpread(expression, sourceFile);
  }
  return value;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function unsupportedArraySpread(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2609",
    "native Test262 spread currently supports a closed dense numeric array applied to a callback",
    node,
    undefined,
    sourceFile,
  );
}
