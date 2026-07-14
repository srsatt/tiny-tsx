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
  span: SourceSpan;
}

export function analyzeApplicationEntry(sourceFile: ts.SourceFile): ApplicationEntry | undefined {
  const exported = sourceFile.statements.find((statement): statement is ts.ExportAssignment =>
    ts.isExportAssignment(statement)
    && !statement.isExportEquals
    && ts.isIdentifier(statement.expression)
  );
  if (exported === undefined || !ts.isIdentifier(exported.expression)) {
    return undefined;
  }
  const binding = exported.expression.text;
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
    span: spanOf(exported, sourceFile),
  };
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
