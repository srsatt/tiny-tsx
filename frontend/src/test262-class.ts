import ts from "typescript";
import {CompileFailure, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface ClassConstructorProgramAssertion {
  kind: "classConstructorProgram";
  initialCount: number;
  expectedCount: number;
  configurable: boolean;
  enumerable: boolean;
  writable: boolean;
  span: SourceSpan;
}

export function isClassConstructorProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(ts.isClassDeclaration);
}

export function lowerClassConstructorProgram(
  sourceFile: ts.SourceFile,
): ClassConstructorProgramAssertion {
  const [
    countStatement,
    classStatement,
    constructorIdentityStatement,
    descriptorStatement,
    configurableStatement,
    enumerableStatement,
    writableStatement,
    instanceStatement,
    countAssertionStatement,
    instancePrototypeStatement,
    ...extra
  ] = sourceFile.statements;
  if (
    countStatement === undefined
    || classStatement === undefined
    || constructorIdentityStatement === undefined
    || descriptorStatement === undefined
    || configurableStatement === undefined
    || enumerableStatement === undefined
    || writableStatement === undefined
    || instanceStatement === undefined
    || countAssertionStatement === undefined
    || instancePrototypeStatement === undefined
    || extra.length > 0
  ) {
    throw unsupportedClass(sourceFile, sourceFile);
  }

  const count = variable(countStatement, sourceFile);
  const initialCount = integer(count.initializer, sourceFile);
  if (!ts.isClassDeclaration(classStatement) || classStatement.name === undefined) {
    throw unsupportedClass(classStatement, sourceFile);
  }
  const className = classStatement.name.text;
  if (classStatement.heritageClauses !== undefined || classStatement.members.length !== 1) {
    throw unsupportedClass(classStatement, sourceFile);
  }
  validateConstructor(classStatement.members[0]!, className, count.name, sourceFile);

  const constructorIdentity = sameValue(constructorIdentityStatement, sourceFile);
  if (
    !isIdentifier(constructorIdentity.actual, className)
    || !isPropertyChain(constructorIdentity.expected, [className, "prototype", "constructor"])
  ) {
    throw unsupportedClass(constructorIdentityStatement, sourceFile);
  }

  const descriptor = variable(descriptorStatement, sourceFile);
  if (!isObjectCall(
    descriptor.initializer,
    "getOwnPropertyDescriptor",
    expression => isPropertyChain(expression, [className, "prototype"]),
    expression => ts.isStringLiteralLike(expression) && expression.text === "constructor",
  )) {
    throw unsupportedClass(descriptorStatement, sourceFile);
  }
  const configurable = descriptorFlag(
    configurableStatement,
    descriptor.name,
    "configurable",
    sourceFile,
  );
  const enumerable = descriptorFlag(
    enumerableStatement,
    descriptor.name,
    "enumerable",
    sourceFile,
  );
  const writable = descriptorFlag(
    writableStatement,
    descriptor.name,
    "writable",
    sourceFile,
  );

  const instance = variable(instanceStatement, sourceFile);
  if (
    !ts.isNewExpression(instance.initializer)
    || !isIdentifier(instance.initializer.expression, className)
    || (instance.initializer.arguments?.length ?? 0) !== 0
  ) {
    throw unsupportedClass(instanceStatement, sourceFile);
  }
  const countAssertion = sameValue(countAssertionStatement, sourceFile);
  if (!isIdentifier(countAssertion.actual, count.name)) {
    throw unsupportedClass(countAssertionStatement, sourceFile);
  }
  const expectedCount = integer(countAssertion.expected, sourceFile);

  const instancePrototype = sameValue(instancePrototypeStatement, sourceFile);
  if (
    !isObjectCall(
      instancePrototype.actual,
      "getPrototypeOf",
      expression => isIdentifier(expression, instance.name),
    )
    || !isPropertyChain(instancePrototype.expected, [className, "prototype"])
  ) {
    throw unsupportedClass(instancePrototypeStatement, sourceFile);
  }

  return {
    kind: "classConstructorProgram",
    initialCount,
    expectedCount,
    configurable,
    enumerable,
    writable,
    span: spanOf(classStatement, sourceFile),
  };
}

function validateConstructor(
  member: ts.ClassElement,
  className: string,
  countName: string,
  sourceFile: ts.SourceFile,
): void {
  if (
    !ts.isConstructorDeclaration(member)
    || member.parameters.length !== 0
    || member.body === undefined
    || member.body.statements.length !== 2
  ) {
    throw unsupportedClass(member, sourceFile);
  }
  const prototypeAssertion = sameValue(member.body.statements[0]!, sourceFile);
  if (
    !isObjectCall(
      prototypeAssertion.actual,
      "getPrototypeOf",
      expression => expression.kind === ts.SyntaxKind.ThisKeyword,
    )
    || !isPropertyChain(prototypeAssertion.expected, [className, "prototype"])
  ) {
    throw unsupportedClass(member.body.statements[0]!, sourceFile);
  }
  const increment = member.body.statements[1]!;
  if (
    !ts.isExpressionStatement(increment)
    || !ts.isPostfixUnaryExpression(increment.expression)
    || increment.expression.operator !== ts.SyntaxKind.PlusPlusToken
    || !isIdentifier(increment.expression.operand, countName)
  ) {
    throw unsupportedClass(increment, sourceFile);
  }
}

function descriptorFlag(
  statement: ts.Statement,
  descriptorName: string,
  field: string,
  sourceFile: ts.SourceFile,
): boolean {
  const assertion = sameValue(statement, sourceFile);
  if (!isPropertyChain(assertion.actual, [descriptorName, field])) {
    throw unsupportedClass(statement, sourceFile);
  }
  if (assertion.expected.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (assertion.expected.kind === ts.SyntaxKind.FalseKeyword) return false;
  throw unsupportedClass(assertion.expected, sourceFile);
}

function variable(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): {name: string; initializer: ts.Expression} {
  if (
    !ts.isVariableStatement(statement)
    || statement.declarationList.declarations.length !== 1
  ) {
    throw unsupportedClass(statement, sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
    throw unsupportedClass(declaration, sourceFile);
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
    throw unsupportedClass(statement, sourceFile);
  }
  return {
    actual: statement.expression.arguments[0]!,
    expected: statement.expression.arguments[1]!,
  };
}

function isObjectCall(
  expression: ts.Expression,
  method: string,
  ...argumentsMatch: Array<(argument: ts.Expression) => boolean>
): boolean {
  return ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && isIdentifier(expression.expression.expression, "Object")
    && expression.expression.name.text === method
    && expression.arguments.length === argumentsMatch.length
    && argumentsMatch.every((matches, index) => matches(expression.arguments[index]!));
}

function isPropertyChain(expression: ts.Expression, names: string[]): boolean {
  if (names.length === 1) return isIdentifier(expression, names[0]!);
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === names[names.length - 1]
    && isPropertyChain(expression.expression, names.slice(0, -1));
}

function isIdentifier(expression: ts.Expression, name: string): boolean {
  return ts.isIdentifier(expression) && expression.text === name;
}

function integer(expression: ts.Expression, sourceFile: ts.SourceFile): number {
  if (!ts.isNumericLiteral(expression)) throw unsupportedClass(expression, sourceFile);
  const value = Number(expression.text);
  if (!Number.isSafeInteger(value)) throw unsupportedClass(expression, sourceFile);
  return value;
}

function unsupportedClass(node: ts.Node, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError(
    "TINY2614",
    "native Test262 classes support the complete closed constructor/prototype assertion",
    node,
    undefined,
    sourceFile,
  );
}
