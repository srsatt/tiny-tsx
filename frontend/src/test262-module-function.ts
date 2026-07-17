import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface ModuleFunctionBindingProgramAssertion {
  kind: "moduleFunctionBindingProgram";
  expectedType: "function";
  returnValue: string;
  expectedReturn: string;
  span: SourceSpan;
}

export function isModuleFunctionBindingProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(ts.isFunctionDeclaration)
    && sourceFile.statements.some(statement => {
      if (!ts.isVariableStatement(statement)) return false;
      return statement.declarationList.declarations.some(declaration =>
        declaration.initializer !== undefined
        && ts.isCallExpression(declaration.initializer)
        && ts.isIdentifier(declaration.initializer.expression)
        && declaration.initializer.expression.text === "fnGlobalObject"
      );
    });
}

export function lowerModuleFunctionBindingProgram(
  sourceFile: ts.SourceFile,
): ModuleFunctionBindingProgramAssertion {
  const [
    globalStatement,
    typeStatement,
    callStatement,
    firstGlobalStatement,
    assignmentStatement,
    firstNullStatement,
    secondGlobalStatement,
    functionStatement,
    secondNullStatement,
    thirdGlobalStatement,
    ...extra
  ] = sourceFile.statements;
  if (
    globalStatement === undefined
    || typeStatement === undefined
    || callStatement === undefined
    || firstGlobalStatement === undefined
    || assignmentStatement === undefined
    || firstNullStatement === undefined
    || secondGlobalStatement === undefined
    || functionStatement === undefined
    || secondNullStatement === undefined
    || thirdGlobalStatement === undefined
    || extra.length > 0
    || !ts.isFunctionDeclaration(functionStatement)
    || functionStatement.name === undefined
    || functionStatement.parameters.length !== 0
    || functionStatement.body?.statements.length !== 1
  ) {
    throw unsupportedModuleFunction(sourceFile, sourceFile);
  }
  const functionName = functionStatement.name.text;
  const returnStatement = functionStatement.body.statements[0]!;
  if (
    !ts.isReturnStatement(returnStatement)
    || returnStatement.expression === undefined
    || !ts.isStringLiteralLike(returnStatement.expression)
  ) {
    throw unsupportedModuleFunction(returnStatement, sourceFile);
  }

  const global = variable(globalStatement, sourceFile);
  if (
    !ts.isCallExpression(global.initializer)
    || !ts.isIdentifier(global.initializer.expression)
    || global.initializer.expression.text !== "fnGlobalObject"
    || global.initializer.arguments.length !== 0
  ) {
    throw unsupportedModuleFunction(global.initializer, sourceFile);
  }

  const typeAssertion = sameValue(typeStatement, sourceFile);
  if (
    !ts.isTypeOfExpression(typeAssertion.actual)
    || !isIdentifier(typeAssertion.actual.expression, functionName)
    || !ts.isStringLiteralLike(typeAssertion.expected)
    || typeAssertion.expected.text !== "function"
  ) {
    throw unsupportedModuleFunction(typeStatement, sourceFile);
  }
  const callAssertion = sameValue(callStatement, sourceFile);
  if (
    !ts.isCallExpression(callAssertion.actual)
    || !isIdentifier(callAssertion.actual.expression, functionName)
    || callAssertion.actual.arguments.length !== 0
    || !ts.isStringLiteralLike(callAssertion.expected)
  ) {
    throw unsupportedModuleFunction(callStatement, sourceFile);
  }

  assertMissingGlobal(firstGlobalStatement, global.name, functionName, sourceFile);
  if (
    !ts.isExpressionStatement(assignmentStatement)
    || !ts.isBinaryExpression(assignmentStatement.expression)
    || assignmentStatement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    || !isIdentifier(assignmentStatement.expression.left, functionName)
    || assignmentStatement.expression.right.kind !== ts.SyntaxKind.NullKeyword
  ) {
    throw unsupportedModuleFunction(assignmentStatement, sourceFile);
  }
  assertNullBinding(firstNullStatement, functionName, sourceFile);
  assertMissingGlobal(secondGlobalStatement, global.name, functionName, sourceFile);
  assertNullBinding(secondNullStatement, functionName, sourceFile);
  assertMissingGlobal(thirdGlobalStatement, global.name, functionName, sourceFile);

  return {
    kind: "moduleFunctionBindingProgram",
    expectedType: "function",
    returnValue: returnStatement.expression.text,
    expectedReturn: callAssertion.expected.text,
    span: spanOf(functionStatement, sourceFile),
  };
}

function assertNullBinding(
  statement: ts.Statement,
  functionName: string,
  sourceFile: ts.SourceFile,
): void {
  const assertion = sameValue(statement, sourceFile);
  if (!isIdentifier(assertion.actual, functionName) || assertion.expected.kind !== ts.SyntaxKind.NullKeyword) {
    throw unsupportedModuleFunction(statement, sourceFile);
  }
}

function assertMissingGlobal(
  statement: ts.Statement,
  globalName: string,
  functionName: string,
  sourceFile: ts.SourceFile,
): void {
  const assertion = sameValue(statement, sourceFile);
  if (
    !ts.isCallExpression(assertion.actual)
    || !ts.isPropertyAccessExpression(assertion.actual.expression)
    || !isIdentifier(assertion.actual.expression.expression, "Object")
    || assertion.actual.expression.name.text !== "getOwnPropertyDescriptor"
    || assertion.actual.arguments.length !== 2
    || !isIdentifier(assertion.actual.arguments[0]!, globalName)
    || !ts.isStringLiteralLike(assertion.actual.arguments[1]!)
    || assertion.actual.arguments[1]!.text !== functionName
    || !isIdentifier(assertion.expected, "undefined")
  ) {
    throw unsupportedModuleFunction(statement, sourceFile);
  }
}

function variable(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {name: string; initializer: ts.Expression} {
  if (
    !ts.isVariableStatement(statement)
    || statement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedModuleFunction(statement, sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupportedModuleFunction(declaration, sourceFile);
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
    || !isIdentifier(statement.expression.expression.expression, "assert")
    || statement.expression.expression.name.text !== "sameValue"
    || statement.expression.arguments.length < 2
  ) {
    throw unsupportedModuleFunction(statement, sourceFile);
  }
  return {
    actual: statement.expression.arguments[0]!,
    expected: statement.expression.arguments[1]!,
  };
}

function isIdentifier(expression: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expression) && expression.text === name;
}

function unsupportedModuleFunction(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2617",
    "native Test262 modules support one hoisted mutable local function binding",
    node,
    undefined,
    sourceFile,
  );
}
