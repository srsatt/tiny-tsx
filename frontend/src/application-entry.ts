import ts from "typescript";
import {spanOf} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface ApplicationArgument {
  kind: "string" | "function" | "other";
  value?: string;
  span: SourceSpan;
}

export interface ApplicationCall {
  method: string;
  arguments: ApplicationArgument[];
  span: SourceSpan;
}

export interface ApplicationEntry {
  binding: string;
  constructorName: string;
  constructorArguments: ApplicationArgument[];
  calls: ApplicationCall[];
  initializationCalls?: readonly ts.CallExpression[];
  server?: {
    port?: number;
  };
  span: SourceSpan;
}

export function analyzeApplicationEntry(sourceFile: ts.SourceFile): ApplicationEntry | undefined {
  const exported = sourceFile.statements.find((statement): statement is ts.ExportAssignment =>
    ts.isExportAssignment(statement)
    && !statement.isExportEquals
  );
  const served = analyzeServeCall(sourceFile);
  const exportedBinding = exported !== undefined && ts.isIdentifier(exported.expression)
    ? exported.expression.text
    : undefined;
  const fluent = exported === undefined || exportedBinding !== undefined
    ? undefined
    : analyzeFluentConstruction(exported.expression);
  if (fluent !== undefined) {
    return {
      binding: "<default>",
      constructorName: fluent.creation.expression.text,
      constructorArguments: (fluent.creation.arguments ?? []).map(argument =>
        applicationArgument(argument, sourceFile)
      ),
      calls: fluent.calls.map(call => ({
        method: (call.expression as ts.PropertyAccessExpression).name.text,
        arguments: call.arguments.map(argument => applicationArgument(argument, sourceFile)),
        span: spanOf(call, sourceFile),
      })),
      initializationCalls: fluent.calls,
      span: spanOf(exported!, sourceFile),
    };
  }
  const binding = exportedBinding ?? served?.binding;
  if (binding === undefined) return undefined;
  const declaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(candidate => ts.isIdentifier(candidate.name) && candidate.name.text === binding);
  if (declaration === undefined || declaration.initializer === undefined) {
    return undefined;
  }
  const creation = declaration.initializer;
  if (!ts.isNewExpression(creation)) {
    return undefined;
  }
  const constructorExpression = creation.expression;
  if (!ts.isIdentifier(constructorExpression)) {
    return undefined;
  }
  const constructorName = constructorExpression.text;
  const calls: ApplicationCall[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      continue;
    }
    const call = statement.expression;
    if (
      !ts.isPropertyAccessExpression(call.expression)
      || !ts.isIdentifier(call.expression.expression)
      || call.expression.expression.text !== binding
    ) {
      continue;
    }
    calls.push({
      method: call.expression.name.text,
      arguments: call.arguments.map(argument => applicationArgument(argument, sourceFile)),
      span: spanOf(call, sourceFile),
    });
  }
  return {
    binding,
    constructorName,
    constructorArguments: (creation.arguments ?? []).map(argument =>
      applicationArgument(argument, sourceFile)
    ),
    calls,
    ...(served?.server === undefined ? {} : {server: served.server}),
    span: spanOf(exported ?? served!.call, sourceFile),
  };
}

function analyzeFluentConstruction(expression: ts.Expression): {
  creation: ts.NewExpression & {expression: ts.Identifier};
  calls: ts.CallExpression[];
} | undefined {
  const calls: ts.CallExpression[] = [];
  let current = unwrap(expression);
  while (
    ts.isCallExpression(current)
    && ts.isPropertyAccessExpression(current.expression)
  ) {
    calls.unshift(current);
    current = unwrap(current.expression.expression);
  }
  return ts.isNewExpression(current) && ts.isIdentifier(current.expression)
    ? {creation: current as ts.NewExpression & {expression: ts.Identifier}, calls}
    : undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function analyzeServeCall(sourceFile: ts.SourceFile): {
  binding: string;
  server: {port?: number};
  call: ts.CallExpression;
} | undefined {
  const serveBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !["tinytsx:serve", "@hono/node-server"].includes(statement.moduleSpecifier.text)
      || statement.importClause?.namedBindings === undefined
      || !ts.isNamedImports(statement.importClause.namedBindings)
    ) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "serve") {
        serveBindings.add(element.name.text);
      }
    }
  }
  if (serveBindings.size === 0) return undefined;

  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      continue;
    }
    const call = statement.expression;
    if (!ts.isIdentifier(call.expression) || !serveBindings.has(call.expression.text)) continue;
    const target = serveTarget(call.arguments[0]);
    if (target !== undefined) return {...target, call};
  }
  return undefined;
}

function serveTarget(expression: ts.Expression | undefined): {
  binding: string;
  server: {port?: number};
} | undefined {
  if (expression === undefined) return undefined;
  if (ts.isIdentifier(expression)) return {binding: expression.text, server: {}};
  if (!ts.isObjectLiteralExpression(expression)) return undefined;

  const fetch = property(expression, "fetch");
  if (
    fetch === undefined
    || !ts.isPropertyAccessExpression(fetch.initializer)
    || !ts.isIdentifier(fetch.initializer.expression)
    || fetch.initializer.name.text !== "fetch"
  ) return undefined;
  const portProperty = property(expression, "port");
  if (portProperty === undefined) {
    return {binding: fetch.initializer.expression.text, server: {}};
  }
  if (!ts.isNumericLiteral(portProperty.initializer)) return undefined;
  const port = Number(portProperty.initializer.text);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return {binding: fetch.initializer.expression.text, server: {port}};
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find((candidate): candidate is ts.PropertyAssignment =>
    ts.isPropertyAssignment(candidate)
    && ((ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name))
      && candidate.name.text === name)
  );
}

function applicationArgument(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): ApplicationArgument {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return {kind: "string", value: expression.text, span: spanOf(expression, sourceFile)};
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return {kind: "function", span: spanOf(expression, sourceFile)};
  }
  return {kind: "other", span: spanOf(expression, sourceFile)};
}
