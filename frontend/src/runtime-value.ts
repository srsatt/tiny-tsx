import ts from "typescript";
import type {SourceModule} from "./module-graph.js";

export interface ResolvedRuntimeValue {
  module: SourceModule;
  declaration: ts.VariableDeclaration;
}

export function resolveRuntimeValue(
  modules: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  localName: string,
  active: Set<string> = new Set(),
): ResolvedRuntimeValue | undefined {
  const key = `${module.path}\0local-value:${localName}`;
  if (active.has(key)) return undefined;
  active.add(key);
  const local = variable(module, localName);
  if (local !== undefined) return {module, declaration: local};
  for (const statement of module.sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.importClause?.namedBindings !== undefined
      && ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      const element = statement.importClause.namedBindings.elements.find(candidate =>
        candidate.name.text === localName
      );
      if (element !== undefined) {
        const target = importedModule(modules, module, statement.moduleSpecifier.text);
        return target === undefined
          ? undefined
          : resolveExportedRuntimeValue(
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

function resolveExportedRuntimeValue(
  modules: ReadonlyMap<string, SourceModule>,
  module: SourceModule,
  exportedName: string,
  active: Set<string>,
): ResolvedRuntimeValue | undefined {
  const key = `${module.path}\0export-value:${exportedName}`;
  if (active.has(key)) return undefined;
  active.add(key);
  const local = variable(module, exportedName, true);
  if (local !== undefined) return {module, declaration: local};
  for (const statement of module.sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      const element = statement.exportClause.elements.find(candidate => candidate.name.text === exportedName);
      if (element === undefined) continue;
      const sourceName = element.propertyName?.text ?? element.name.text;
      if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = importedModule(modules, module, statement.moduleSpecifier.text);
        return target === undefined
          ? undefined
          : resolveExportedRuntimeValue(modules, target, sourceName, active);
      }
      return resolveRuntimeValue(modules, module, sourceName, active);
    }
    if (
      statement.exportClause === undefined
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const target = importedModule(modules, module, statement.moduleSpecifier.text);
      const resolved = target === undefined
        ? undefined
        : resolveExportedRuntimeValue(modules, target, exportedName, active);
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

function variable(
  module: SourceModule,
  name: string,
  exported = false,
): ts.VariableDeclaration | undefined {
  for (const statement of module.sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || exported && !hasExportModifier(statement)) continue;
    const declaration = statement.declarationList.declarations.find(candidate =>
      ts.isIdentifier(candidate.name) && candidate.name.text === name && candidate.initializer !== undefined
    );
    if (declaration !== undefined) return declaration;
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
