import ts from "typescript";
import {tinyError} from "./diagnostics.js";

const forbiddenCalls = new Set(["eval", "require", "Function"]);
const supportedAttributes = new Set([
  "class", "className", "id", "href", "title", "lang", "name", "value",
  "type", "placeholder", "style",
]);

export function validateForbiddenSyntax(sourceFile: ts.SourceFile): void {
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      throw tinyError(
        "TINY1001",
        "`any` is not supported by TinyTSX",
        node,
        "replace `any` with a closed static type",
        sourceFile,
      );
    }

    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      throw tinyError("TINY1002", "classes are not supported by TinyTSX", node, undefined, sourceFile);
    }

    if (
      (ts.isFunctionLike(node)
        && ts.canHaveModifiers(node)
        && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))
      || ts.isAwaitExpression(node)
    ) {
      throw tinyError("TINY1003", "async functions are not supported by TinyTSX", node, undefined, sourceFile);
    }

    if (ts.isElementAccessExpression(node)) {
      throw tinyError(
        "TINY1004",
        "computed property access is not supported by TinyTSX",
        node,
        undefined,
        sourceFile,
      );
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (!supportedAttributes.has(name) && !name.startsWith("data-") && !name.startsWith("aria-")) {
        throw tinyError("TINY1204", `JSX attribute \`${name}\` is not supported`, node.name, undefined, sourceFile);
      }
    }

    if (ts.isImportDeclaration(node)) {
      throw tinyError(
        "TINY1005",
        "imports are not supported by the first static TinyTSX slice",
        node,
        undefined,
        sourceFile,
      );
    }

    if (ts.isThrowStatement(node) || ts.isTryStatement(node)) {
      throw tinyError("TINY1006", "exceptions are not supported by TinyTSX", node, undefined, sourceFile);
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && forbiddenCalls.has(node.expression.text)) {
      throw tinyError(
        "TINY1007",
        `\`${node.expression.text}\` is not supported by TinyTSX`,
        node,
        undefined,
        sourceFile,
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}
