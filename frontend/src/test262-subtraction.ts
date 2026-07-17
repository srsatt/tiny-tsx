import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export type NumericOperand =
  | {kind: "literal"; value: number}
  | {kind: "slot"; slot: number};

export type NumericSubtractionOperation =
  | {kind: "set"; slot: number; value: number; span: SourceSpan}
  | {
      kind: "assertSubtract";
      left: NumericOperand;
      right: NumericOperand;
      expected: number;
      span: SourceSpan;
    };

export interface NumericSubtractionProgramAssertion {
  kind: "numericSubtractionProgram";
  slots: number;
  operations: NumericSubtractionOperation[];
  span: SourceSpan;
}

export function isNumericSubtractionProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (!ts.isIfStatement(statement)) return false;
    const condition = statement.expression;
    return ts.isBinaryExpression(condition) && ts.isBinaryExpression(condition.left)
      && condition.left.operatorToken.kind === ts.SyntaxKind.MinusToken;
  });
}

export function lowerNumericSubtractionProgram(
  sourceFile: ts.SourceFile,
): NumericSubtractionProgramAssertion {
  const slots = new Map<string, number>();
  const records = new Set<string>();
  const operations: NumericSubtractionOperation[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
          throw unsupportedSubtraction(declaration, sourceFile);
        }
        if (isEmptyObjectCreation(declaration.initializer)) {
          records.add(declaration.name.text);
          continue;
        }
        const slot = slotFor(slots, declaration.name.text, declaration);
        operations.push({
          kind: "set",
          slot,
          value: integerLiteral(declaration.initializer, sourceFile),
          span: spanOf(declaration, sourceFile),
        });
      }
      continue;
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const assignment = statement.expression;
      if (
        assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
        || !ts.isPropertyAccessExpression(assignment.left)
        || !ts.isIdentifier(assignment.left.expression)
        || !records.has(assignment.left.expression.text)
      ) {
        throw unsupportedSubtraction(statement, sourceFile);
      }
      const slot = slotFor(
        slots,
        `${assignment.left.expression.text}.${assignment.left.name.text}`,
        assignment.left,
      );
      operations.push({
        kind: "set",
        slot,
        value: integerLiteral(assignment.right, sourceFile),
        span: spanOf(statement, sourceFile),
      });
      continue;
    }
    if (ts.isIfStatement(statement)) {
      operations.push(lowerSubtractionAssertion(statement, slots, records, sourceFile));
      continue;
    }
    throw unsupportedSubtraction(statement, sourceFile);
  }
  if (!operations.some(operation => operation.kind === "assertSubtract")) {
    throw unsupportedSubtraction(sourceFile, sourceFile);
  }
  return {
    kind: "numericSubtractionProgram",
    slots: slots.size,
    operations,
    span: spanOf(sourceFile, sourceFile),
  };
}

function lowerSubtractionAssertion(
  statement: ts.IfStatement,
  slots: ReadonlyMap<string, number>,
  records: ReadonlySet<string>,
  sourceFile: ts.SourceFile,
): NumericSubtractionOperation {
  if (statement.elseStatement !== undefined || !isTest262ErrorThrow(statement.thenStatement)) {
    throw unsupportedSubtraction(statement, sourceFile);
  }
  const condition = statement.expression;
  if (
    !ts.isBinaryExpression(condition)
    || condition.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
    || !ts.isBinaryExpression(condition.left)
    || condition.left.operatorToken.kind !== ts.SyntaxKind.MinusToken
  ) {
    throw unsupportedSubtraction(condition, sourceFile);
  }
  return {
    kind: "assertSubtract",
    left: lowerOperand(condition.left.left, slots, records, sourceFile),
    right: lowerOperand(condition.left.right, slots, records, sourceFile),
    expected: integerLiteral(condition.right, sourceFile),
    span: spanOf(statement, sourceFile),
  };
}

function lowerOperand(
  expression: ts.Expression,
  slots: ReadonlyMap<string, number>,
  records: ReadonlySet<string>,
  sourceFile: ts.SourceFile,
): NumericOperand {
  if (ts.isNumericLiteral(expression) || ts.isPrefixUnaryExpression(expression)) {
    return {kind: "literal", value: integerLiteral(expression, sourceFile)};
  }
  if (ts.isIdentifier(expression)) {
    const slot = slots.get(expression.text);
    if (slot === undefined) throw unsupportedSubtraction(expression, sourceFile);
    return {kind: "slot", slot};
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && records.has(expression.expression.text)
  ) {
    const slot = slots.get(`${expression.expression.text}.${expression.name.text}`);
    if (slot === undefined) throw unsupportedSubtraction(expression, sourceFile);
    return {kind: "slot", slot};
  }
  throw unsupportedSubtraction(expression, sourceFile);
}

function slotFor(slots: Map<string, number>, name: string, node: ts.Node): number {
  const existing = slots.get(name);
  if (existing !== undefined) return existing;
  if (slots.size >= 16) throw unsupportedSubtraction(node, node.getSourceFile());
  const slot = slots.size;
  slots.set(name, slot);
  return slot;
}

function isEmptyObjectCreation(expression: ts.Expression): boolean {
  return ts.isNewExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "Object"
    && (expression.arguments?.length ?? 0) === 0;
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
    throw unsupportedSubtraction(expression, sourceFile);
  }
  return value;
}

function unsupportedSubtraction(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2610",
    "native Test262 subtraction supports bounded integer locals and closed record properties",
    node,
    undefined,
    sourceFile,
  );
}
