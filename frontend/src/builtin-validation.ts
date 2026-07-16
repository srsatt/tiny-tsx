import ts from "typescript";
import path from "node:path";
import {CompileFailure, spanOf, type Diagnostic} from "./diagnostics.js";
import type {ModuleGraph} from "./module-graph.js";

const unavailableBuiltins = new Set([
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
  allowedReadRoots: readonly string[],
): void {
  const diagnostics: Diagnostic[] = [];
  for (const module of graph.modules) {
    const named = new Map<string, ImportedOperation>();
    const namespaces = new Map<string, string>();
    for (const statement of module.sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || (!["tinytsx:env", "tinytsx:fs"].includes(statement.moduleSpecifier.text)
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
        if (unavailableBuiltins.has(imported.specifier)) {
          diagnostics.push({
            code: "TINY1500",
            message: `built-in operation \`${imported.specifier}.${imported.operation}\` is declared but has no native implementation yet`,
            span: spanOf(node, module.sourceFile),
            help: "run `tinytsx --list-builtins` and require status `native` before using an operation",
          });
        } else if (imported.specifier === "tinytsx:env") {
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
        } else {
          validateFilesystemCall(
            diagnostics,
            imported,
            invocation,
            node,
            module.sourceFile,
            allowedReadRoots,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  if (diagnostics.length > 0) throw new CompileFailure(diagnostics);
}

function validateFilesystemCall(
  diagnostics: Diagnostic[],
  imported: ImportedOperation,
  invocation: ts.CallExpression | ts.NewExpression | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  allowedReadRoots: readonly string[],
): void {
  const argument = invocation?.arguments?.[0];
  const file = argument !== undefined && ts.isStringLiteral(argument) ? argument.text : undefined;
  const portable = file !== undefined
    && file.length > 0
    && Buffer.byteLength(file, "utf8") <= 4096
    && !file.includes("\0")
    && !path.isAbsolute(file)
    && file.split(/[\\/]/).every(component => component !== "" && component !== "." && component !== "..");
  const options = invocation?.arguments?.[1];
  const maxBytes = options === undefined ? 1_048_576 : staticMaxBytes(options);
  if (
    imported.operation !== "readTextFile"
    || invocation?.arguments === undefined
    || invocation.arguments.length < 1
    || invocation.arguments.length > 2
    || !portable
    || maxBytes === undefined
  ) {
    diagnostics.push({
      code: "TINY1504",
      message: "`tinytsx:fs.readTextFile` requires a static normalized relative path and optional bounded maxBytes",
      span: spanOf(node, sourceFile),
      help: "use readTextFile(\"path/file.txt\", {maxBytes: 1048576}) without empty, dot, or parent segments",
    });
  } else if (allowedReadRoots.length === 0) {
    diagnostics.push({
      code: "TINY1502",
      message: `filesystem path \`${file}\` requires an explicit read capability`,
      span: spanOf(node, sourceFile),
      help: "re-run with `--allow-read <root>`",
    });
  }
}

function staticMaxBytes(expression: ts.Expression): number | undefined {
  if (!ts.isObjectLiteralExpression(expression)) return undefined;
  if (expression.properties.length === 0) return 1_048_576;
  if (expression.properties.length !== 1) return undefined;
  const property = expression.properties[0];
  if (
    property === undefined
    || !ts.isPropertyAssignment(property)
    || property.name.getText() !== "maxBytes"
    || !ts.isNumericLiteral(property.initializer)
  ) return undefined;
  const value = Number(property.initializer.text);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_048_576 ? value : undefined;
}
