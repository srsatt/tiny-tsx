import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {Diagnostic} from "./diagnostics.js";
import {spanOf} from "./diagnostics.js";

export interface ModuleGraphOptions {
  aliases?: Readonly<Record<string, string>>;
}

export interface SourceModule {
  path: string;
  sourceFile: ts.SourceFile;
  dependencies: string[];
}

export interface ModuleGraph {
  entry: string;
  modules: SourceModule[];
  diagnostics: Diagnostic[];
}

const extensions = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs"];

export function loadModuleGraph(entryPath: string, options: ModuleGraphOptions = {}): ModuleGraph {
  const entry = path.resolve(entryPath);
  const aliases = new Map(Object.entries(options.aliases ?? {}).map(([specifier, target]) => [
    specifier,
    path.resolve(target),
  ]));
  const modules = new Map<string, SourceModule>();
  const diagnostics: Diagnostic[] = [];

  function visit(file: string): void {
    const resolvedFile = resolveFile(file);
    if (resolvedFile === undefined) {
      diagnostics.push({code: "TINY2001", message: `could not load runtime module: ${file}`});
      return;
    }
    if (modules.has(resolvedFile)) {
      return;
    }

    const sourceFile = ts.createSourceFile(
      resolvedFile,
      fs.readFileSync(resolvedFile, "utf8"),
      ts.ScriptTarget.ESNext,
      true,
      scriptKind(resolvedFile),
    );
    const sourceModule: SourceModule = {path: resolvedFile, sourceFile, dependencies: []};
    modules.set(resolvedFile, sourceModule);

    for (const moduleReference of runtimeModuleReferences(sourceFile)) {
      const target = resolveReference(resolvedFile, moduleReference.specifier, aliases);
      if (target === undefined) {
        diagnostics.push({
          code: "TINY2002",
          message: `could not resolve runtime import \`${moduleReference.specifier}\``,
          span: spanOf(moduleReference.node, sourceFile),
        });
        continue;
      }
      const dependency = resolveFile(target);
      if (dependency === undefined) {
        diagnostics.push({
          code: "TINY2001",
          message: `could not load runtime module: ${target}`,
          span: spanOf(moduleReference.node, sourceFile),
        });
        continue;
      }
      sourceModule.dependencies.push(dependency);
      visit(dependency);
    }
  }

  visit(entry);
  return {entry, modules: [...modules.values()], diagnostics};
}

interface ModuleReference {
  specifier: string;
  node: ts.StringLiteralLike;
}

function runtimeModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (!isTypeOnlyImport(statement.importClause)) {
        references.push({specifier: statement.moduleSpecifier.text, node: statement.moduleSpecifier});
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      references.push({specifier: statement.moduleSpecifier.text, node: statement.moduleSpecifier});
    }
  }
  return references;
}

function isTypeOnlyImport(importClause: ts.ImportClause | undefined): boolean {
  if (importClause === undefined || importClause.isTypeOnly) {
    return importClause?.isTypeOnly === true;
  }
  if (
    importClause.name !== undefined
    || importClause.namedBindings === undefined
    || !ts.isNamedImports(importClause.namedBindings)
  ) {
    return false;
  }
  return importClause.namedBindings.elements.length > 0
    && importClause.namedBindings.elements.every(element => element.isTypeOnly);
}

function resolveReference(
  importer: string,
  specifier: string,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const alias = aliases.get(specifier);
  if (alias !== undefined) {
    return alias;
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(importer), specifier);
  }
  return undefined;
}

function resolveFile(candidate: string): string | undefined {
  for (const extension of extensions) {
    const file = `${candidate}${extension}`;
    if (isFile(file)) {
      return path.resolve(file);
    }
  }
  for (const extension of extensions.slice(1)) {
    const file = path.join(candidate, `index${extension}`);
    if (isFile(file)) {
      return path.resolve(file);
    }
  }
  return undefined;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (file.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}
