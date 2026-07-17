import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface RegExpTestProgramAssertion {
  kind: "regexpTestProgram";
  input: string;
  alternatives: string[];
  span: SourceSpan;
}

export function isRegExpTestProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(declaration =>
      declaration.initializer !== undefined
      && ts.isRegularExpressionLiteral(declaration.initializer)
    );
  });
}

export function lowerRegExpTestProgram(
  sourceFile: ts.SourceFile,
): RegExpTestProgramAssertion {
  const [inputStatement, regexpStatement, assertionStatement, ...extra] = sourceFile.statements;
  if (
    inputStatement === undefined
    || regexpStatement === undefined
    || assertionStatement === undefined
    || extra.length > 0
  ) {
    throw unsupportedRegExp(sourceFile, sourceFile);
  }
  const input = variable(inputStatement, sourceFile);
  if (!ts.isStringLiteralLike(input.initializer)) {
    throw unsupportedRegExp(input.initializer, sourceFile);
  }
  const regexp = variable(regexpStatement, sourceFile);
  if (!ts.isRegularExpressionLiteral(regexp.initializer)) {
    throw unsupportedRegExp(regexp.initializer, sourceFile);
  }
  const alternatives = literalAlternatives(regexp.initializer.text, regexp.initializer, sourceFile);

  const assertion = sameValue(assertionStatement, sourceFile);
  if (!isRegExpCall(assertion.actual, regexp.name, "test", input.name)) {
    throw unsupportedRegExp(assertion.actual, sourceFile);
  }
  if (
    !ts.isBinaryExpression(assertion.expected)
    || assertion.expected.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
    || !isRegExpCall(assertion.expected.left, regexp.name, "exec", input.name)
    || assertion.expected.right.kind !== ts.SyntaxKind.NullKeyword
  ) {
    throw unsupportedRegExp(assertion.expected, sourceFile);
  }

  return {
    kind: "regexpTestProgram",
    input: input.initializer.text,
    alternatives,
    span: spanOf(assertionStatement, sourceFile),
  };
}

function literalAlternatives(
  text: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string[] {
  if (!text.startsWith("/") || !text.endsWith("/")) {
    throw unsupportedRegExp(node, sourceFile);
  }
  const pattern = text.slice(1, -1);
  const alternatives = pattern.split("|");
  if (
    alternatives.length === 0
    || alternatives.some(alternative =>
      alternative.length === 0
      || !/^[A-Za-z0-9 _-]+$/.test(alternative)
    )
  ) {
    throw unsupportedRegExp(node, sourceFile);
  }
  return alternatives;
}

function variable(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {name: string; initializer: ts.Expression} {
  if (
    !ts.isVariableStatement(statement)
    || statement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedRegExp(statement, sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupportedRegExp(declaration, sourceFile);
  }
  return {name: declaration.name.text, initializer: declaration.initializer};
}

function sameValue(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {actual: ts.Expression; expected: ts.Expression} {
  if (
    !ts.isExpressionStatement(statement)
    || !ts.isCallExpression(statement.expression)
    || !ts.isPropertyAccessExpression(statement.expression.expression)
    || !ts.isIdentifier(statement.expression.expression.expression)
    || statement.expression.expression.expression.text !== "assert"
    || statement.expression.expression.name.text !== "sameValue"
    || statement.expression.arguments.length < 2
  ) {
    throw unsupportedRegExp(statement, sourceFile);
  }
  return {
    actual: statement.expression.arguments[0]!,
    expected: statement.expression.arguments[1]!,
  };
}

function isRegExpCall(
  expression: ts.Expression,
  regexpName: string,
  method: string,
  inputName: string,
): boolean {
  return ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === regexpName
    && expression.expression.name.text === method
    && expression.arguments.length === 1
    && ts.isIdentifier(expression.arguments[0]!)
    && expression.arguments[0]!.text === inputName;
}

function unsupportedRegExp(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2616",
    "native Test262 RegExp supports bounded ASCII literal alternatives for test/exec",
    node,
    undefined,
    sourceFile,
  );
}
