import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface ErrorMessageProgramAssertion {
  kind: "errorMessageProgram";
  message: string;
  writable: boolean;
  enumerable: boolean;
  configurable: boolean;
  span: SourceSpan;
}

export function isErrorMessageProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some(declaration =>
      declaration.initializer !== undefined
      && ts.isNewExpression(declaration.initializer)
      && ts.isIdentifier(declaration.initializer.expression)
      && declaration.initializer.expression.text === "Error"
    );
  });
}

export function lowerErrorMessageProgram(
  sourceFile: ts.SourceFile,
): ErrorMessageProgramAssertion {
  const [messageStatement, errorStatement, equalStatement, propertyStatement, ...extra]
    = sourceFile.statements;
  if (
    messageStatement === undefined
    || errorStatement === undefined
    || equalStatement === undefined
    || propertyStatement === undefined
    || extra.length > 0
  ) {
    throw unsupportedError(sourceFile, sourceFile);
  }

  const message = variable(messageStatement, sourceFile);
  if (!ts.isStringLiteralLike(message.initializer)) {
    throw unsupportedError(message.initializer, sourceFile);
  }
  const error = variable(errorStatement, sourceFile);
  if (
    !ts.isNewExpression(error.initializer)
    || !ts.isIdentifier(error.initializer.expression)
    || error.initializer.expression.text !== "Error"
    || error.initializer.arguments?.length !== 1
    || !isIdentifier(error.initializer.arguments[0]!, message.name)
  ) {
    throw unsupportedError(error.initializer, sourceFile);
  }

  const equal = namedCall(equalStatement, "verifyEqualTo", sourceFile);
  if (
    equal.length !== 3
    || !isIdentifier(equal[0]!, error.name)
    || !isMessageName(equal[1]!)
    || !isIdentifier(equal[2]!, message.name)
  ) {
    throw unsupportedError(equalStatement, sourceFile);
  }

  const property = namedCall(propertyStatement, "verifyProperty", sourceFile);
  if (
    property.length !== 3
    || !isIdentifier(property[0]!, error.name)
    || !isMessageName(property[1]!)
    || !ts.isObjectLiteralExpression(property[2]!)
  ) {
    throw unsupportedError(propertyStatement, sourceFile);
  }
  const descriptor = booleanRecord(property[2], sourceFile);
  if (
    descriptor.size !== 3
    || !descriptor.has("writable")
    || !descriptor.has("enumerable")
    || !descriptor.has("configurable")
  ) {
    throw unsupportedError(property[2], sourceFile);
  }

  return {
    kind: "errorMessageProgram",
    message: message.initializer.text,
    writable: descriptor.get("writable")!,
    enumerable: descriptor.get("enumerable")!,
    configurable: descriptor.get("configurable")!,
    span: spanOf(errorStatement, sourceFile),
  };
}

function booleanRecord(
  expression: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw unsupportedError(property, sourceFile);
    }
    const value = property.initializer.kind === ts.SyntaxKind.TrueKeyword
      ? true
      : property.initializer.kind === ts.SyntaxKind.FalseKeyword
        ? false
        : undefined;
    if (value === undefined || result.has(property.name.text)) {
      throw unsupportedError(property, sourceFile);
    }
    result.set(property.name.text, value);
  }
  return result;
}

function variable(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {name: string; initializer: ts.Expression} {
  if (
    !ts.isVariableStatement(statement)
    || statement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedError(statement, sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupportedError(declaration, sourceFile);
  }
  return {name: declaration.name.text, initializer: declaration.initializer};
}

function namedCall(
  statement: ts.Statement,
  name: string,
  sourceFile: ts.SourceFile,
): readonly ts.Expression[] {
  if (
    !ts.isExpressionStatement(statement)
    || !ts.isCallExpression(statement.expression)
    || !ts.isIdentifier(statement.expression.expression)
    || statement.expression.expression.text !== name
  ) {
    throw unsupportedError(statement, sourceFile);
  }
  return statement.expression.arguments;
}

function isMessageName(expression: ts.Expression): boolean {
  return ts.isStringLiteralLike(expression) && expression.text === "message";
}

function isIdentifier(expression: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expression) && expression.text === name;
}

function unsupportedError(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2615",
    "native Test262 Error supports a bounded own message and standard descriptor",
    node,
    undefined,
    sourceFile,
  );
}
