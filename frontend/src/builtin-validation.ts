import ts from "typescript";
import {CompileFailure, spanOf, type Diagnostic} from "./diagnostics.js";
import type {ModuleGraph} from "./module-graph.js";

const unavailableBuiltins = new Set([
  "tinytsx:fs",
  "tinytsx:sqlite",
  "tinytsx:actors",
]);

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENVIRONMENT_NAME_BYTES = 128;

interface ImportedOperation {
  specifier: string;
  operation: string;
}

/** Validates protected built-ins before symbolic application execution. */
export function validateBuiltinOperations(
  graph: ModuleGraph,
  allowedEnvironment: ReadonlySet<string>,
): void {
  const diagnostics: Diagnostic[] = [];
  for (const module of graph.modules) {
    const named = new Map<string, ImportedOperation>();
    const namespaces = new Map<string, string>();
    for (const statement of module.sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || (statement.moduleSpecifier.text !== "tinytsx:env"
          && !unavailableBuiltins.has(statement.moduleSpecifier.text))
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
        const invocation = ts.isCallExpression(node) || ts.isNewExpression(node) ? node : undefined;
        if (imported.specifier !== "tinytsx:env") {
          diagnostics.push({
            code: "TINY1500",
            message: `built-in operation \`${imported.specifier}.${imported.operation}\` is declared but has no native implementation yet`,
            span: spanOf(node, module.sourceFile),
            help: "run `tinytsx --list-builtins` and require status `native` before using an operation",
          });
        } else {
          const argument = invocation?.arguments?.[0];
          const name = argument !== undefined && ts.isStringLiteral(argument)
            ? argument.text
            : undefined;
          if (
            !["get", "require"].includes(imported.operation)
            || invocation?.arguments?.length !== 1
            || name === undefined
            || !ENVIRONMENT_NAME.test(name)
            || Buffer.byteLength(name, "utf8") > MAX_ENVIRONMENT_NAME_BYTES
          ) {
            diagnostics.push({
              code: "TINY1504",
              message: `built-in operation \`tinytsx:env.${imported.operation}\` requires one static portable environment name`,
              span: spanOf(node, module.sourceFile),
              help: "use get(\"NAME\") or require(\"NAME\") with an ASCII name up to 128 bytes",
            });
          } else if (!allowedEnvironment.has(name)) {
            diagnostics.push({
              code: "TINY1501",
              message: `environment variable \`${name}\` requires an explicit capability`,
              span: spanOf(node, module.sourceFile),
              help: `re-run with \`--allow-env ${name}\``,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  if (diagnostics.length > 0) throw new CompileFailure(diagnostics);
}
