import ts from "typescript";
import {tinyError} from "./diagnostics.js";
import type {ComputedAccessDecision} from "./staging.js";

const forbiddenCalls = new Set(["eval", "require", "Function"]);
const supportedAttributes = new Set([
  "class", "className", "id", "href", "title", "lang", "name", "value",
  "type", "placeholder", "style",
]);

export function validateForbiddenSyntax(
  sourceFile: ts.SourceFile,
  computedAccesses: readonly ComputedAccessDecision[] = [],
  allowStagedAsync = false,
): void {
  const closedComputed = new Set(computedAccesses
    .filter(access => access.disposition === "closed")
    .map(access => spanKey(access.span)));
  function visit(node: ts.Node): void {
    if (
      !allowStagedAsync
      && (
      (ts.isFunctionLike(node)
        && ts.canHaveModifiers(node)
        && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))
      || ts.isAwaitExpression(node)
      )
    ) {
      throw tinyError("TINY1003", "async functions are not supported by TinyTSX", node, undefined, sourceFile);
    }

    if (
      ts.isElementAccessExpression(node)
      && !closedComputed.has(spanKeyFromNode(node, sourceFile))
    ) {
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

    if (ts.isTryStatement(node) || (ts.isThrowStatement(node) && !allowStagedAsync)) {
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

function spanKey(span: {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}): string {
  return `${span.file}:${span.line}:${span.column}:${span.endLine}:${span.endColumn}`;
}

function spanKeyFromNode(node: ts.Node, sourceFile: ts.SourceFile): string {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return spanKey({
    file: sourceFile.fileName,
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  });
}
