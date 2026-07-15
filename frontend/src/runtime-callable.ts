import ts from "typescript";
import type {SourceModule} from "./module-graph.js";

export interface ResolvedCallable {
  module: SourceModule;
  declaration: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}

export function resolveRuntimeCallable(
  modules: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  localName: string,
  active: Set<string> = new Set(),
): ResolvedCallable | undefined {
  const key = `${module.path}\0local-callable:${localName}`;
  if (active.has(key)) return undefined;
  active.add(key);
  for (const statement of module.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === localName) {
      return {module, declaration: statement};
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(candidate =>
        ts.isIdentifier(candidate.name) && candidate.name.text === localName
      );
      const initializer = declaration?.initializer;
      if (initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        return {module, declaration: initializer};
      }
    }
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.importClause !== undefined
      && statement.importClause.namedBindings !== undefined
      && ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      const element = statement.importClause.namedBindings.elements.find(candidate =>
        candidate.name.text === localName
      );
      if (element !== undefined) {
        const target = importedModule(modules, module, statement.moduleSpecifier.text);
        return target === undefined
          ? undefined
          : resolveExportedCallable(
            modules,
            target,
            element.propertyName?.text ?? element.name.text,
            active,
          );
      }
    }
  }
  return undefined;
}

function resolveExportedCallable(
  modules: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  exportedName: string,
  active: Set<string>,
): ResolvedCallable | undefined {
  const key = `${module.path}\0export-callable:${exportedName}`;
  if (active.has(key)) return undefined;
  active.add(key);
  for (const statement of module.sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === exportedName
      && hasExportModifier(statement)
    ) {
      return {module, declaration: statement};
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      const declaration = statement.declarationList.declarations.find(candidate =>
        ts.isIdentifier(candidate.name) && candidate.name.text === exportedName
      );
      const initializer = declaration?.initializer;
      if (initializer !== undefined && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        return {module, declaration: initializer};
      }
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)
    ) {
      const element = statement.exportClause.elements.find(candidate => candidate.name.text === exportedName);
      if (element === undefined) continue;
      const sourceName = element.propertyName?.text ?? element.name.text;
      if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = importedModule(modules, module, statement.moduleSpecifier.text);
        return target === undefined
          ? undefined
          : resolveExportedCallable(modules, target, sourceName, active);
      }
      return resolveRuntimeCallable(modules, module, sourceName, active);
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause === undefined
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const target = importedModule(modules, module, statement.moduleSpecifier.text);
      const resolved = target === undefined
        ? undefined
        : resolveExportedCallable(modules, target, exportedName, active);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }
  return undefined;
}

function importedModule(
  modules: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  specifier: string,
): SourceModule | undefined {
  const target = module.runtimeImports.find(runtimeImport => runtimeImport.specifier === specifier)?.path;
  return target === undefined ? undefined : modules.get(target);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}
