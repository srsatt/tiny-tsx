import path from "node:path";
import ts from "typescript";
import {spanOf} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";
import type {ApplicationEntry} from "./application-entry.js";
import type {ModuleGraph, SourceModule} from "./module-graph.js";

export type ConstructorOperation =
  | "superCall"
  | "variable"
  | "forEach"
  | "assignment"
  | "call"
  | "other";

export interface RuntimeClassStep {
  name: string;
  module: string;
  span: SourceSpan;
  constructorSpan?: SourceSpan;
  operations: ConstructorOperation[];
}

export interface RuntimeClassPlan {
  classes: RuntimeClassStep[];
}

export interface ResolvedRuntimeClass {
  module: SourceModule;
  declaration: ts.ClassDeclaration;
}

export function resolveRuntimeClassPlan(
  graph: ModuleGraph,
  application: ApplicationEntry,
): RuntimeClassPlan | undefined {
  const modules = new Map(graph.modules.map(module => [module.path, module]));
  const entry = modules.get(graph.entry);
  if (entry === undefined) {
    return undefined;
  }
  const resolved = resolveApplicationRuntimeClass(graph, application);
  if (resolved === undefined) {
    return undefined;
  }
  const classes: RuntimeClassStep[] = [];
  const active = new Set<string>();
  let current: ResolvedRuntimeClass | undefined = resolved;
  while (current !== undefined) {
    const key = `${current.module.path}\0${current.declaration.name?.text ?? "<anonymous>"}`;
    if (active.has(key)) {
      return undefined;
    }
    active.add(key);
    const constructor = current.declaration.members.find(ts.isConstructorDeclaration);
    classes.push({
      name: current.declaration.name?.text ?? "<anonymous>",
      module: current.module.path,
      span: spanOf(current.declaration, current.module.sourceFile),
      ...(constructor === undefined
        ? {}
        : {constructorSpan: spanOf(constructor, current.module.sourceFile)}),
      operations: constructor?.body?.statements.map(classifyConstructorOperation) ?? [],
    });
    current = resolveBaseRuntimeClass(current, modules);
  }
  return {classes};
}

export function displayRuntimeClassPlan(plan: RuntimeClassPlan, root: string): string {
  return plan.classes
    .map(step => `${path.relative(root, step.module)}:${step.name}`)
    .join(" -> ");
}

export function resolveApplicationRuntimeClass(
  graph: ModuleGraph,
  application: ApplicationEntry,
): ResolvedRuntimeClass | undefined {
  const modules = new Map(graph.modules.map(module => [module.path, module]));
  const entry = modules.get(graph.entry);
  return entry === undefined
    ? undefined
    : resolveLocal(entry, application.constructorName, modules, new Set());
}

export function resolveRuntimeClass(
  module: SourceModule,
  localName: string,
  modules: ReadonlyMap<string, SourceModule>,
): ResolvedRuntimeClass | undefined {
  return resolveLocal(module, localName, modules, new Set());
}

export function resolveBaseRuntimeClass(
  resolved: ResolvedRuntimeClass,
  modules: ReadonlyMap<string, SourceModule>,
): ResolvedRuntimeClass | undefined {
  const heritage = resolved.declaration.heritageClauses?.find(clause =>
    clause.token === ts.SyntaxKind.ExtendsKeyword
  );
  const expression = heritage?.types[0]?.expression;
  return expression !== undefined && ts.isIdentifier(expression)
    ? resolveLocal(resolved.module, expression.text, modules, new Set())
    : undefined;
}

function resolveExport(
  module: SourceModule,
  exportedName: string,
  modules: ReadonlyMap<string, SourceModule>,
  active: Set<string>,
): ResolvedRuntimeClass | undefined {
  const key = `${module.path}\0export:${exportedName}`;
  if (active.has(key)) {
    return undefined;
  }
  active.add(key);
  for (const statement of module.sourceFile.statements) {
    if (
      ts.isClassDeclaration(statement)
      && statement.name?.text === exportedName
      && hasExportModifier(statement)
    ) {
      return {module, declaration: statement};
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (!ts.isNamedExports(statement.exportClause)) {
        continue;
      }
      const element = statement.exportClause.elements.find(candidate =>
        candidate.name.text === exportedName
      );
      if (element === undefined) {
        continue;
      }
      const importedName = element.propertyName?.text ?? element.name.text;
      if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = importedModule(module, statement.moduleSpecifier.text, modules);
        return target === undefined
          ? undefined
          : resolveExport(target, importedName, modules, active);
      }
      return resolveLocal(module, importedName, modules, active);
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause === undefined
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const target = importedModule(module, statement.moduleSpecifier.text, modules);
      const resolved = target === undefined
        ? undefined
        : resolveExport(target, exportedName, modules, active);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }
  return undefined;
}

function resolveLocal(
  module: SourceModule,
  localName: string,
  modules: ReadonlyMap<string, SourceModule>,
  active: Set<string>,
): ResolvedRuntimeClass | undefined {
  const key = `${module.path}\0local:${localName}`;
  if (active.has(key)) {
    return undefined;
  }
  active.add(key);
  for (const statement of module.sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name?.text === localName) {
      return {module, declaration: statement};
    }
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.importClause !== undefined
    ) {
      const target = importedModule(module, statement.moduleSpecifier.text, modules);
      if (target === undefined) {
        continue;
      }
      if (statement.importClause.name?.text === localName) {
        return resolveExport(target, "default", modules, active);
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        const element = bindings.elements.find(candidate => candidate.name.text === localName);
        if (element !== undefined) {
          return resolveExport(target, element.propertyName?.text ?? element.name.text, modules, active);
        }
      }
    }
  }
  return resolveExport(module, localName, modules, active);
}

function importedModule(
  module: SourceModule,
  specifier: string,
  modules: ReadonlyMap<string, SourceModule>,
): SourceModule | undefined {
  const target = module.runtimeImports.find(runtimeImport =>
    runtimeImport.specifier === specifier
  )?.path;
  return target === undefined ? undefined : modules.get(target);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function classifyConstructorOperation(statement: ts.Statement): ConstructorOperation {
  if (ts.isVariableStatement(statement)) {
    return "variable";
  }
  if (!ts.isExpressionStatement(statement)) {
    return "other";
  }
  const expression = statement.expression;
  if (ts.isCallExpression(expression)) {
    if (expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
      return "superCall";
    }
    if (
      ts.isPropertyAccessExpression(expression.expression)
      && expression.expression.name.text === "forEach"
    ) {
      return "forEach";
    }
    return "call";
  }
  return ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ? "assignment"
    : "other";
}
