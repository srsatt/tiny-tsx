import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {HtmlOp} from "./hir.js";
import {StringTable} from "./hir.js";

const intrinsicTags = new Set([
  "html", "head", "title", "meta", "link", "body", "main", "section",
  "article", "header", "footer", "nav", "div", "span", "h1", "h2", "h3",
  "p", "a", "ul", "ol", "li", "strong", "em", "code", "pre", "form",
  "label", "input", "button",
]);

const voidTags = new Set(["input", "meta", "link"]);
const staticAttributes = new Set([
  "class", "className", "id", "href", "title", "lang", "name", "value",
  "type", "placeholder", "style",
]);

type PendingOp =
  | {kind: "writeStatic"; value: string; node: ts.Node}
  | {kind: "callComponent"; component: number; node: ts.Node};

interface LoweringContext {
  sourceFile: ts.SourceFile;
  components: ReadonlyMap<string, number>;
  pending: PendingOp[];
}

export function lowerComponentBody(
  expression: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  sourceFile: ts.SourceFile,
  components: ReadonlyMap<string, number>,
  strings: StringTable,
): HtmlOp[] {
  const context: LoweringContext = {sourceFile, components, pending: []};
  lowerNode(expression, context);

  return context.pending.map(op => op.kind === "writeStatic"
    ? {kind: "writeStatic", string: strings.intern(op.value), span: spanOf(op.node, sourceFile)}
    : {kind: "callComponent", component: op.component, span: spanOf(op.node, sourceFile)});
}

function lowerNode(node: ts.JsxChild | ts.JsxFragment, context: LoweringContext): void {
  if (ts.isJsxText(node)) {
    appendStatic(context, node.getText(context.sourceFile), node);
    return;
  }

  if (ts.isJsxExpression(node)) {
    if (node.expression === undefined) {
      return;
    }
    throw tinyError(
      "TINY1205",
      "dynamic TSX expressions are not supported by the first static slice",
      node,
    );
  }

  if (ts.isJsxFragment(node)) {
    for (const child of node.children) {
      lowerNode(child, context);
    }
    return;
  }

  if (ts.isJsxSelfClosingElement(node)) {
    lowerSelfClosing(node, context);
    return;
  }

  const tag = tagName(node.openingElement.tagName);
  if (isComponentTag(tag)) {
    throw tinyError(
      "TINY1201",
      "components must be invoked with a self-closing tag in the static slice",
      node,
    );
  }
  ensureIntrinsic(tag, node.openingElement.tagName);
  if (voidTags.has(tag) && node.children.length > 0) {
    throw tinyError("TINY1202", `void element \`<${tag}>\` cannot have children`, node);
  }

  appendStatic(context, `<${tag}${lowerAttributes(node.openingElement.attributes)}>`, node.openingElement);
  for (const child of node.children) {
    lowerNode(child, context);
  }
  appendStatic(context, `</${tag}>`, node.closingElement);
}

function lowerSelfClosing(node: ts.JsxSelfClosingElement, context: LoweringContext): void {
  const tag = tagName(node.tagName);
  if (isComponentTag(tag)) {
    if (node.attributes.properties.length > 0) {
      throw tinyError(
        "TINY1203",
        "component props are not supported by the first static slice",
        node.attributes,
      );
    }
    const component = context.components.get(tag);
    if (component === undefined) {
      throw tinyError("TINY1200", `unknown component \`${tag}\``, node.tagName);
    }
    context.pending.push({kind: "callComponent", component, node});
    return;
  }

  ensureIntrinsic(tag, node.tagName);
  const suffix = voidTags.has(tag) ? ">" : `></${tag}>`;
  appendStatic(context, `<${tag}${lowerAttributes(node.attributes)}${suffix}`, node);
}

function lowerAttributes(attributes: ts.JsxAttributes): string {
  let output = "";
  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      throw tinyError("TINY1206", "spread attributes are not supported by TinyTSX", property);
    }

    if (!ts.isIdentifier(property.name)) {
      throw tinyError("TINY1207", "namespaced JSX attributes are not supported", property.name);
    }
    const sourceName = property.name.text;
    const name = sourceName === "className" ? "class" : sourceName;
    if (!staticAttributes.has(sourceName) && !sourceName.startsWith("data-") && !sourceName.startsWith("aria-")) {
      throw tinyError("TINY1204", `JSX attribute \`${sourceName}\` is not supported`, property.name);
    }

    if (property.initializer === undefined) {
      output += ` ${name}`;
      continue;
    }
    if (!ts.isStringLiteral(property.initializer)) {
      throw tinyError(
        "TINY1205",
        "dynamic JSX attributes are not supported by the first static slice",
        property.initializer,
      );
    }
    output += ` ${name}="${escapeAttribute(property.initializer.text)}"`;
  }
  return output;
}

function appendStatic(context: LoweringContext, value: string, node: ts.Node): void {
  if (value.length === 0) {
    return;
  }
  const previous = context.pending.at(-1);
  if (previous?.kind === "writeStatic") {
    previous.value += value;
  } else {
    context.pending.push({kind: "writeStatic", value, node});
  }
}

function tagName(name: ts.JsxTagNameExpression): string {
  if (!ts.isIdentifier(name)) {
    throw tinyError("TINY1207", "namespaced JSX tags are not supported", name);
  }
  return name.text;
}

function isComponentTag(tag: string): boolean {
  return tag[0]?.toUpperCase() === tag[0];
}

function ensureIntrinsic(tag: string, node: ts.Node): void {
  if (!intrinsicTags.has(tag)) {
    throw tinyError("TINY1208", `intrinsic element \`<${tag}>\` is not supported`, node);
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
