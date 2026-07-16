import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {Diagnostic} from "./diagnostics.js";
import {spanOf} from "./diagnostics.js";

export interface ModuleGraphOptions {
  aliases?: Readonly<Record<string, string>>;
  builtins?: Readonly<Record<string, string>>;
}

export interface SourceModule {
  path: string;
  sourceFile: ts.SourceFile;
  dependencies: string[];
  runtimeImports: RuntimeImport[];
}

export interface RuntimeImport {
  specifier: string;
  path: string;
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
  const builtins = new Map(Object.entries(options.builtins ?? {}).map(([specifier, target]) => [
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
    const sourceModule: SourceModule = {
      path: resolvedFile,
      sourceFile,
      dependencies: [],
      runtimeImports: [],
    };
    modules.set(resolvedFile, sourceModule);

    for (const moduleReference of runtimeModuleReferences(sourceFile)) {
      const target = resolveReference(resolvedFile, moduleReference.specifier, aliases, builtins);
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
      if (moduleReference.kind === "import") {
        sourceModule.runtimeImports.push({specifier: moduleReference.specifier, path: dependency});
      }
      visit(dependency);
    }
  }

  visit(entry);
  return {entry, modules: [...modules.values()], diagnostics};
}

interface ModuleReference {
  specifier: string;
  node: ts.StringLiteralLike;
  kind: "import" | "worker";
}

function runtimeModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (!isTypeOnlyImport(statement.importClause)) {
        references.push({
          specifier: statement.moduleSpecifier.text,
          node: statement.moduleSpecifier,
          kind: "import",
        });
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      references.push({
        specifier: statement.moduleSpecifier.text,
        node: statement.moduleSpecifier,
        kind: "import",
      });
    }
  }
  const visit = (node: ts.Node): void => {
    const specifier = workerModuleSpecifier(node);
    if (specifier !== undefined) {
      references.push({specifier: specifier.text, node: specifier, kind: "worker"});
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function workerModuleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (
    !ts.isNewExpression(node)
    || !ts.isIdentifier(node.expression)
    || node.expression.text !== "Worker"
  ) return undefined;
  const url = node.arguments?.[0];
  if (
    url === undefined
    || !ts.isNewExpression(url)
    || !ts.isIdentifier(url.expression)
    || url.expression.text !== "URL"
  ) return undefined;
  const specifier = url.arguments?.[0];
  return specifier !== undefined && ts.isStringLiteralLike(specifier)
    ? specifier
    : undefined;
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
  builtins: ReadonlyMap<string, string>,
): string | undefined {
  const builtin = builtins.get(specifier);
  if (builtin !== undefined) {
    return builtin;
  }
  const alias = aliases.get(specifier);
  if (alias !== undefined) {
    return alias;
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(importer), specifier);
  }
  return resolvePackage(importer, specifier);
}

function resolvePackage(importer: string, specifier: string): string | undefined {
  const parsed = packageSpecifier(specifier);
  if (parsed === undefined) return undefined;

  let current = path.dirname(importer);
  while (true) {
    const root = path.join(current, "node_modules", parsed.name);
    if (isDirectory(root)) {
      return resolvePackageEntry(root, parsed.subpath);
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function packageSpecifier(specifier: string): {name: string; subpath: string} | undefined {
  if (specifier.startsWith("#") || specifier.includes("\\")) return undefined;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    if (parts.length < 2 || parts[0] === "" || parts[1] === "") return undefined;
    return {name: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join("/")};
  }
  if (parts[0] === "") return undefined;
  return {name: parts[0]!, subpath: parts.slice(1).join("/")};
}

function resolvePackageEntry(root: string, subpath: string): string | undefined {
  const manifest = readPackageManifest(root);
  if (manifest?.exports !== undefined) {
    const exported = resolveExport(manifest.exports, subpath === "" ? "." : `./${subpath}`);
    if (exported !== undefined) {
      const candidate = packageTarget(root, exported);
      return candidate === undefined ? undefined : resolveFile(candidate);
    }
    return undefined;
  }
  if (subpath !== "") return resolveFile(path.join(root, subpath));
  for (const field of [manifest?.module, manifest?.main]) {
    if (typeof field === "string") {
      const resolved = resolveFile(path.join(root, field));
      if (resolved !== undefined) return resolved;
    }
  }
  return resolveFile(path.join(root, "index"));
}

interface PackageManifest {
  exports?: unknown;
  module?: unknown;
  main?: unknown;
}

function readPackageManifest(root: string): PackageManifest | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

function resolveExport(exports: unknown, subpath: string): string | undefined {
  if (typeof exports === "string") return subpath === "." ? exports : undefined;
  if (Array.isArray(exports)) {
    for (const candidate of exports) {
      const resolved = resolveExport(candidate, subpath);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (exports === null || typeof exports !== "object") return undefined;
  const fields = exports as Record<string, unknown>;
  const subpathKeys = Object.keys(fields).filter(key => key.startsWith("."));
  if (subpathKeys.length > 0) {
    const exact = fields[subpath];
    if (exact !== undefined) return resolveExportTarget(exact);
    for (const key of subpathKeys.filter(key => key.includes("*"))) {
      const [prefix, suffix = ""] = key.split("*");
      if (!subpath.startsWith(prefix!) || !subpath.endsWith(suffix)) continue;
      const wildcard = subpath.slice(prefix!.length, subpath.length - suffix.length);
      const target = resolveExportTarget(fields[key]);
      if (target !== undefined) return target.replaceAll("*", wildcard);
    }
    return undefined;
  }
  return resolveExportTarget(fields);
}

function resolveExportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const resolved = resolveExportTarget(candidate);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (target === null || typeof target !== "object") return undefined;
  const conditions = target as Record<string, unknown>;
  for (const condition of ["tinytsx", "import", "module", "default", "node"]) {
    if (conditions[condition] === undefined) continue;
    const resolved = resolveExportTarget(conditions[condition]);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function packageTarget(root: string, target: string): string | undefined {
  if (!target.startsWith("./")) return undefined;
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? undefined : resolved;
}

function resolveFile(candidate: string): string | undefined {
  const sourceSubstitution = sourceExtensionSubstitution(candidate);
  if (sourceSubstitution !== undefined) {
    for (const extension of [".ts", ".tsx", path.extname(candidate)]) {
      const file = `${sourceSubstitution}${extension}`;
      if (isFile(file)) {
        return path.resolve(file);
      }
    }
  }
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

function sourceExtensionSubstitution(candidate: string): string | undefined {
  const extension = path.extname(candidate);
  return [".js", ".mjs", ".cjs"].includes(extension)
    ? candidate.slice(0, -extension.length)
    : undefined;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
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
