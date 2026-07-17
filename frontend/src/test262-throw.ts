import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface ThrowCatchProgramAssertion {
  kind: "throwCatchProgram";
  initialCaught: boolean;
  thrown: string;
  expected: string;
  finalExpected: boolean;
  span: SourceSpan;
}

export function isThrowCatchProgram(sourceFile: ts.SourceFile): boolean {
  const declaration = sourceFile.statements[0];
  const candidate = sourceFile.statements[1];
  if (
    declaration === undefined
    || !ts.isVariableStatement(declaration)
    || declaration.declarationList.declarations[0]?.initializer?.kind !== ts.SyntaxKind.FalseKeyword
    || candidate === undefined
    || !ts.isTryStatement(candidate)
  ) {
    return false;
  }
  const thrown = candidate.tryBlock.statements[0];
  return thrown !== undefined
    && ts.isThrowStatement(thrown)
    && thrown.expression !== undefined
    && ts.isStringLiteralLike(thrown.expression);
}

export function lowerThrowCatchProgram(sourceFile: ts.SourceFile): ThrowCatchProgramAssertion {
  const [declarationStatement, tryStatement, finalStatement, ...extra] = sourceFile.statements;
  if (
    declarationStatement === undefined
    || tryStatement === undefined
    || finalStatement === undefined
    || extra.length > 0
    || !ts.isVariableStatement(declarationStatement)
    || declarationStatement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedThrow(sourceFile, sourceFile);
  }
  const declaration = declarationStatement.declarationList.declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name)
    || declaration.initializer?.kind !== ts.SyntaxKind.FalseKeyword
    || !ts.isTryStatement(tryStatement)
    || tryStatement.finallyBlock !== undefined
    || tryStatement.tryBlock.statements.length !== 1
    || tryStatement.catchClause?.variableDeclaration === undefined
    || !ts.isIdentifier(tryStatement.catchClause.variableDeclaration.name)
  ) {
    throw unsupportedThrow(declarationStatement, sourceFile);
  }
  const thrownStatement = tryStatement.tryBlock.statements[0]!;
  if (
    !ts.isThrowStatement(thrownStatement)
    || thrownStatement.expression === undefined
    || !ts.isStringLiteralLike(thrownStatement.expression)
  ) {
    throw unsupportedThrow(thrownStatement, sourceFile);
  }
  const catchStatements = tryStatement.catchClause.block.statements;
  if (catchStatements.length !== 2) {
    throw unsupportedThrow(tryStatement.catchClause.block, sourceFile);
  }
  const catchAssertion = sameValue(catchStatements[0]!, sourceFile);
  if (
    !ts.isIdentifier(catchAssertion.actual)
    || catchAssertion.actual.text !== tryStatement.catchClause.variableDeclaration.name.text
    || !ts.isStringLiteralLike(catchAssertion.expected)
  ) {
    throw unsupportedThrow(catchStatements[0]!, sourceFile);
  }
  const assignmentStatement = catchStatements[1]!;
  if (
    !ts.isExpressionStatement(assignmentStatement)
    || !ts.isBinaryExpression(assignmentStatement.expression)
    || assignmentStatement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    || !ts.isIdentifier(assignmentStatement.expression.left)
    || assignmentStatement.expression.left.text !== declaration.name.text
    || assignmentStatement.expression.right.kind !== ts.SyntaxKind.TrueKeyword
  ) {
    throw unsupportedThrow(assignmentStatement, sourceFile);
  }
  const finalAssertion = sameValue(finalStatement, sourceFile);
  if (
    !ts.isIdentifier(finalAssertion.actual)
    || finalAssertion.actual.text !== declaration.name.text
    || finalAssertion.expected.kind !== ts.SyntaxKind.TrueKeyword
  ) {
    throw unsupportedThrow(finalStatement, sourceFile);
  }
  return {
    kind: "throwCatchProgram",
    initialCaught: false,
    thrown: thrownStatement.expression.text,
    expected: catchAssertion.expected.text,
    finalExpected: true,
    span: spanOf(tryStatement, sourceFile),
  };
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
    throw unsupportedThrow(statement, sourceFile);
  }
  return {
    actual: statement.expression.arguments[0]!,
    expected: statement.expression.arguments[1]!,
  };
}

function unsupportedThrow(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2612",
    "native Test262 throw supports a bounded string throw/catch assertion",
    node,
    undefined,
    sourceFile,
  );
}
