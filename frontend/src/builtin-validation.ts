import ts from "typescript";
import {CompileFailure, spanOf, type Diagnostic} from "./diagnostics.js";
import type {ModuleGraph} from "./module-graph.js";

const declaredBuiltins = new Set([
  "tinytsx:env",
  "tinytsx:fs",
  "tinytsx:sqlite",
  "tinytsx:actors",
]);

interface ImportedOperation {
  specifier: string;
  operation: string;
}

/** Prevents a declaration-only built-in from silently evaluating as undefined. */
export function validateUnavailableBuiltinOperations(graph: ModuleGraph): void {
  const diagnostics: Diagnostic[] = [];
  for (const module of graph.modules) {
    const named = new Map<string, ImportedOperation>();
    const namespaces = new Map<string, string>();
    for (const statement of module.sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || !declaredBuiltins.has(statement.moduleSpecifier.text)
      ) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) {
        namespaces.set(bindings.name.text, statement.moduleSpecifier.text);
      } else {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          named.set(element.name.text, {
            specifier: statement.moduleSpecifier.text,
            operation: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    }
    const visit = (node: ts.Node): void => {
      let imported: ImportedOperation | undefined;
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node))
        && ts.isIdentifier(node.expression)
      ) {
        imported = named.get(node.expression.text);
      } else if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
      ) {
        const specifier = namespaces.get(node.expression.expression.text);
        if (specifier !== undefined) {
          imported = {specifier, operation: node.expression.name.text};
        }
      }
      if (imported !== undefined) {
        diagnostics.push({
          code: "TINY1500",
          message: `built-in operation \`${imported.specifier}.${imported.operation}\` is declared but has no native implementation yet`,
          span: spanOf(node, module.sourceFile),
          help: "run `tinytsx --list-builtins` and require status `native` before using an operation",
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  if (diagnostics.length > 0) throw new CompileFailure(diagnostics);
}
