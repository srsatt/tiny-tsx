import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface RecordMembershipProgramAssertion {
  kind: "recordMembershipProgram";
  fields: string[];
  property: string;
  expected: boolean;
  span: SourceSpan;
}

export function isRecordMembershipProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (!ts.isIfStatement(statement)) return false;
    const condition = unwrap(statement.expression);
    if (!ts.isPrefixUnaryExpression(condition) || condition.operator !== ts.SyntaxKind.ExclamationToken) {
      return false;
    }
    const membership = unwrap(condition.operand);
    return ts.isBinaryExpression(membership)
      && membership.operatorToken.kind === ts.SyntaxKind.InKeyword;
  });
}

export function lowerRecordMembershipProgram(
  sourceFile: ts.SourceFile,
): RecordMembershipProgramAssertion {
  const [declarationStatement, check, ...extra] = sourceFile.statements;
  if (
    declarationStatement === undefined
    || check === undefined
    || extra.length > 0
    || !ts.isVariableStatement(declarationStatement)
    || declarationStatement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedMembership(sourceFile, sourceFile);
  }
  const declaration = declarationStatement.declarationList.declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name)
    || declaration.initializer === undefined
    || !ts.isObjectLiteralExpression(declaration.initializer)
  ) {
    throw unsupportedMembership(declaration, sourceFile);
  }
  const fields = declaration.initializer.properties.map(property => {
    if (
      !ts.isPropertyAssignment(property)
      || property.name === undefined
      || !ts.isStringLiteralLike(property.initializer)
    ) {
      throw unsupportedMembership(property, sourceFile);
    }
    return propertyName(property.name, sourceFile);
  });
  if (!ts.isIfStatement(check) || check.elseStatement !== undefined || !isTest262ErrorThrow(check.thenStatement)) {
    throw unsupportedMembership(check, sourceFile);
  }
  const negation = unwrap(check.expression);
  if (!ts.isPrefixUnaryExpression(negation) || negation.operator !== ts.SyntaxKind.ExclamationToken) {
    throw unsupportedMembership(check.expression, sourceFile);
  }
  const membership = unwrap(negation.operand);
  if (
    !ts.isBinaryExpression(membership)
    || membership.operatorToken.kind !== ts.SyntaxKind.InKeyword
    || !ts.isStringLiteralLike(membership.left)
    || !ts.isIdentifier(membership.right)
    || membership.right.text !== declaration.name.text
  ) {
    throw unsupportedMembership(membership, sourceFile);
  }
  return {
    kind: "recordMembershipProgram",
    fields,
    property: membership.left.text,
    expected: true,
    span: spanOf(check, sourceFile),
  };
}

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  throw unsupportedMembership(name, sourceFile);
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

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function unsupportedMembership(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2611",
    "native Test262 membership supports a closed record and literal property",
    node,
    undefined,
    sourceFile,
  );
}
