import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface AsyncPromiseBrandProgramAssertion {
  kind: "asyncPromiseBrandProgram";
  expectedBrand: "Promise";
  span: SourceSpan;
}

export function isAsyncPromiseBrandProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(declaration => {
      if (declaration.initializer === undefined || !ts.isCallExpression(declaration.initializer)) {
        return false;
      }
      const candidate = unwrap(declaration.initializer.expression);
      return ts.isFunctionExpression(candidate) && hasAsyncModifier(candidate);
    });
  });
}

export function lowerAsyncPromiseBrandProgram(
  sourceFile: ts.SourceFile,
): AsyncPromiseBrandProgramAssertion {
  const [declarationStatement, assertionStatement, ...extra] = sourceFile.statements;
  if (
    declarationStatement === undefined
    || assertionStatement === undefined
    || extra.length > 0
    || !ts.isVariableStatement(declarationStatement)
    || declarationStatement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedAsync(sourceFile, sourceFile);
  }
  const declaration = declarationStatement.declarationList.declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name)
    || declaration.initializer === undefined
    || !ts.isCallExpression(declaration.initializer)
    || declaration.initializer.arguments.length !== 0
  ) {
    throw unsupportedAsync(declaration, sourceFile);
  }
  const functionExpression = unwrap(declaration.initializer.expression);
  if (
    !ts.isFunctionExpression(functionExpression)
    || !hasAsyncModifier(functionExpression)
    || functionExpression.parameters.length !== 0
    || functionExpression.body.statements.length !== 0
    || functionExpression.asteriskToken !== undefined
  ) {
    throw unsupportedAsync(functionExpression, sourceFile);
  }
  if (
    !ts.isExpressionStatement(assertionStatement)
    || !ts.isCallExpression(assertionStatement.expression)
    || !ts.isIdentifier(assertionStatement.expression.expression)
    || assertionStatement.expression.expression.text !== "assert"
    || assertionStatement.expression.arguments.length < 1
  ) {
    throw unsupportedAsync(assertionStatement, sourceFile);
  }
  const condition = assertionStatement.expression.arguments[0]!;
  if (
    !ts.isBinaryExpression(condition)
    || condition.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword
    || !ts.isIdentifier(condition.left)
    || condition.left.text !== declaration.name.text
    || !ts.isIdentifier(condition.right)
    || condition.right.text !== "Promise"
  ) {
    throw unsupportedAsync(condition, sourceFile);
  }

  return {
    kind: "asyncPromiseBrandProgram",
    expectedBrand: "Promise",
    span: spanOf(declarationStatement, sourceFile),
  };
}

function hasAsyncModifier(node: ts.FunctionExpression): boolean {
  return node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function unsupportedAsync(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2618",
    "native Test262 async supports an empty function expression returning a Promise brand",
    node,
    undefined,
    sourceFile,
  );
}
