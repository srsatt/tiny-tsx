import ts from "typescript";
import {spanOf} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";
import type {ModuleGraph, SourceModule} from "./module-graph.js";
import type {EvaluationContext, StagedValue} from "./staged-value.js";
import {
  createEvaluationContext,
  evaluateStagedValue,
  StagedSymbol,
  staticPropertyName,
} from "./staged-value.js";

export type {StagedValue} from "./staged-value.js";

export interface StagedBinding {
  module: string;
  name: string;
  span: SourceSpan;
  value: StagedValue;
}

export interface SpreadDecision {
  operation: "spread" | "rest";
  container: "array" | "object" | "arguments";
  disposition: "constant" | "runtime";
  span: SourceSpan;
  reason: string;
}

export interface ComputedAccessDecision {
  operation: "read" | "write";
  disposition: "closed" | "runtime";
  keys: string[];
  span: SourceSpan;
  reason: string;
}

export interface StagingReport {
  bindings: StagedBinding[];
  spreads: SpreadDecision[];
  computedAccesses: ComputedAccessDecision[];
}

export function analyzeStaging(graph: ModuleGraph): StagingReport {
  const context = createEvaluationContext(graph);
  const stagedBindings: StagedBinding[] = [];
  const spreads: SpreadDecision[] = [];
  const computedAccesses: ComputedAccessDecision[] = [];

  for (const module of graph.modules) {
    const closedComputed = collectClosedForEachAccesses(module, context);
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isConstDeclaration(node)) {
        if (node.initializer !== undefined) {
          const value = evaluateStagedValue(node.name, module.path, context)
            ?? evaluateStagedValue(node.initializer, module.path, context);
          if (value !== undefined) {
            stagedBindings.push({
              module: module.path,
              name: node.name.text,
              span: spanOf(node, module.sourceFile),
              value,
            });
          }
        }
      } else if (ts.isVariableDeclaration(node) && isConstDeclaration(node)) {
        stagedBindings.push(...evaluateDestructuring(node, module, context));
      }
      if (ts.isSpreadElement(node)) {
        spreads.push(spreadDecision(node.expression, "spread", spreadContainer(node), module, context));
      } else if (ts.isSpreadAssignment(node)) {
        spreads.push(spreadDecision(node.expression, "spread", "object", module, context));
      } else if (ts.isBindingElement(node) && node.dotDotDotToken !== undefined) {
        spreads.push(bindingRestDecision(node, module, context));
      } else if (ts.isParameter(node) && node.dotDotDotToken !== undefined) {
        spreads.push({
          operation: "rest",
          container: "arguments",
          disposition: "runtime",
          span: spanOf(node, module.sourceFile),
          reason: "rest parameter requires runtime argument packing or call-site specialization",
        });
      }
      if (ts.isElementAccessExpression(node)) {
        computedAccesses.push(closedComputed.get(node.pos) ?? {
          operation: isAssignmentTarget(node) ? "write" : "read",
          disposition: "runtime",
          keys: [],
          span: spanOf(node, module.sourceFile),
          reason: "computed key is not statically enumerable",
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(module.sourceFile);
  }

  return {bindings: stagedBindings, spreads, computedAccesses};
}

export function evaluateConstantExpression(expression: ts.Expression): StagedValue | undefined {
  return evaluateStagedValue(
    expression,
    expression.getSourceFile().fileName,
    createEvaluationContext(),
  );
}

function spreadDecision(
  expression: ts.Expression,
  operation: SpreadDecision["operation"],
  container: SpreadDecision["container"],
  module: SourceModule,
  context: EvaluationContext,
): SpreadDecision {
  const value = evaluateStagedValue(expression, module.path, context);
  const compatible = container === "object"
    ? value !== null
      && !Array.isArray(value)
      && !(value instanceof StagedSymbol)
      && typeof value === "object"
    : Array.isArray(value);
  return {
    operation,
    container,
    disposition: compatible ? "constant" : "runtime",
    span: spanOf(expression.parent, module.sourceFile),
    reason: compatible
      ? "spread source is a closed compile-time value"
      : "spread source requires runtime semantics or a later closed-shape specialization",
  };
}

function bindingRestDecision(
  node: ts.BindingElement,
  module: SourceModule,
  context: EvaluationContext,
): SpreadDecision {
  const declaration = ts.isVariableDeclaration(node.parent.parent) ? node.parent.parent : undefined;
  const source = declaration?.initializer === undefined
    ? undefined
    : evaluateStagedValue(declaration.initializer, module.path, context);
  const container = ts.isArrayBindingPattern(node.parent) ? "array" : "object";
  const compatible = container === "array"
    ? Array.isArray(source)
    : source !== null && !Array.isArray(source) && typeof source === "object";
  return {
    operation: "rest",
    container,
    disposition: compatible ? "constant" : "runtime",
    span: spanOf(node, module.sourceFile),
    reason: compatible
      ? "rest source is a closed compile-time value"
      : "rest source requires runtime semantics or a later closed-shape specialization",
  };
}

function evaluateDestructuring(
  declaration: ts.VariableDeclaration,
  module: SourceModule,
  context: EvaluationContext,
): StagedBinding[] {
  if (declaration.initializer === undefined) {
    return [];
  }
  const source = evaluateStagedValue(declaration.initializer, module.path, context);
  if (
    ts.isObjectBindingPattern(declaration.name)
    && source !== null
    && !Array.isArray(source)
    && !(source instanceof StagedSymbol)
    && typeof source === "object"
  ) {
    const excluded = new Set(declaration.name.elements
      .filter(element => element.dotDotDotToken === undefined)
      .map(element => staticBindingName(element))
      .filter((name): name is string => name !== undefined));
    const rest = Object.fromEntries(Object.entries(source).filter(([name]) => !excluded.has(name)));
    return declaration.name.elements
      .filter(element => element.dotDotDotToken !== undefined && ts.isIdentifier(element.name))
      .map(element => ({
        module: module.path,
        name: (element.name as ts.Identifier).text,
        span: spanOf(element, module.sourceFile),
        value: rest,
      }));
  }
  if (ts.isArrayBindingPattern(declaration.name) && Array.isArray(source)) {
    const restIndex = declaration.name.elements.findIndex(element =>
      ts.isBindingElement(element) && element.dotDotDotToken !== undefined
    );
    const rest = restIndex === -1 ? undefined : declaration.name.elements[restIndex];
    return rest !== undefined && ts.isBindingElement(rest) && ts.isIdentifier(rest.name)
      ? [{
          module: module.path,
          name: rest.name.text,
          span: spanOf(rest, module.sourceFile),
          value: source.slice(restIndex),
        }]
      : [];
  }
  return [];
}

function spreadContainer(node: ts.SpreadElement): SpreadDecision["container"] {
  return ts.isArrayLiteralExpression(node.parent) ? "array" : "arguments";
}

function staticBindingName(element: ts.BindingElement): string | undefined {
  if (element.propertyName !== undefined) {
    return staticPropertyName(element.propertyName);
  }
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

function isConstDeclaration(node: ts.VariableDeclaration): boolean {
  return ts.isVariableDeclarationList(node.parent)
    && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

function collectClosedForEachAccesses(
  module: SourceModule,
  context: EvaluationContext,
): ReadonlyMap<number, ComputedAccessDecision> {
  const decisions = new Map<number, ComputedAccessDecision>();

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "forEach"
      && node.arguments.length >= 1
      && (ts.isArrowFunction(node.arguments[0]!) || ts.isFunctionExpression(node.arguments[0]!))
    ) {
      const values = evaluateForEachSource(
        node.expression.expression,
        node,
        module,
        context,
      );
      const callback = node.arguments[0] as ts.ArrowFunction | ts.FunctionExpression;
      const parameter = callback.parameters[0];
      if (
        Array.isArray(values)
        && values.every((value): value is string => typeof value === "string")
        && parameter !== undefined
        && ts.isIdentifier(parameter.name)
      ) {
        const keys = [...new Set(values)];
        const parameterName = parameter.name.text;
        function visitCallback(child: ts.Node): void {
          if (
            ts.isElementAccessExpression(child)
            && child.argumentExpression !== undefined
            && ts.isIdentifier(child.argumentExpression)
            && child.argumentExpression.text === parameterName
          ) {
            decisions.set(child.pos, {
              operation: isAssignmentTarget(child) ? "write" : "read",
              disposition: "closed",
              keys,
              span: spanOf(child, module.sourceFile),
              reason: "computed key is enumerated by a closed compile-time forEach source",
            });
          }
          ts.forEachChild(child, visitCallback);
        }
        visitCallback(callback.body);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(module.sourceFile);
  return decisions;
}

function evaluateForEachSource(
  expression: ts.Expression,
  call: ts.CallExpression,
  module: SourceModule,
  context: EvaluationContext,
): StagedValue | undefined {
  const direct = evaluateStagedValue(expression, module.path, context);
  if (direct !== undefined || !ts.isIdentifier(expression)) {
    return direct;
  }
  let current: ts.Node | undefined = call.parent;
  while (current !== undefined && !ts.isBlock(current)) {
    current = current.parent;
  }
  if (current === undefined || !ts.isBlock(current)) {
    return undefined;
  }
  for (const statement of current.statements) {
    if (statement.pos >= call.pos) {
      break;
    }
    if (
      !ts.isVariableStatement(statement)
      || (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === expression.text
        && declaration.initializer !== undefined
      ) {
        return evaluateStagedValue(declaration.initializer, module.path, context);
      }
    }
  }
  return undefined;
}

function isAssignmentTarget(node: ts.ElementAccessExpression): boolean {
  return ts.isBinaryExpression(node.parent)
    && node.parent.left === node
    && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}
