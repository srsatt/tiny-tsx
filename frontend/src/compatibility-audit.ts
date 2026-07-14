import path from "node:path";
import ts from "typescript";
import type {Diagnostic} from "./diagnostics.js";
import {spanOf} from "./diagnostics.js";
import type {ModuleGraphOptions} from "./module-graph.js";
import {loadModuleGraph} from "./module-graph.js";
import type {ComputedAccessDecision, SpreadDecision} from "./staging.js";
import {analyzeStaging} from "./staging.js";

export interface CompatibilityAuditOptions extends ModuleGraphOptions {
  root?: string;
}

export interface FeatureRequirement {
  feature: string;
  occurrences: number;
  modules: number;
  samples: ReturnType<typeof spanOf>[];
}

export interface CompatibilityReport {
  version: 1;
  entry: string;
  modules: Array<{path: string; dependencies: string[]}>;
  diagnostics: Diagnostic[];
  requirements: FeatureRequirement[];
  builtins: Array<{name: string; occurrences: number}>;
  staging: {
    constantBindings: number;
    constantSpreads: number;
    runtimeSpreads: number;
    spreads: SpreadDecision[];
    closedComputedAccesses: number;
    runtimeComputedAccesses: number;
    computedAccesses: ComputedAccessDecision[];
  };
  statistics: {modules: number; sourceBytes: number; sourceLines: number};
}

const featurePredicates = new Map<string, (node: ts.Node) => boolean>([
  ["functions-as-values", node => ts.isArrowFunction(node) || ts.isFunctionExpression(node)],
  ["classes", node => ts.isClassDeclaration(node) || ts.isClassExpression(node)],
  ["private-fields", ts.isPrivateIdentifier],
  ["accessors", node => ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)],
  ["async-await", node => isAsyncFunction(node) || ts.isAwaitExpression(node)],
  ["exceptions", node => ts.isThrowStatement(node) || ts.isTryStatement(node) || ts.isCatchClause(node)],
  ["computed-access", ts.isElementAccessExpression],
  ["object-literals", ts.isObjectLiteralExpression],
  ["array-literals", ts.isArrayLiteralExpression],
  ["new-expressions", ts.isNewExpression],
  ["loops", node => isLoop(node)],
  ["rest-spread", node => isRestOrSpread(node)],
  ["destructuring", node => ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)],
  ["regular-expressions", ts.isRegularExpressionLiteral],
  ["template-expressions", ts.isTemplateExpression],
  ["generators", node => isGenerator(node) || ts.isYieldExpression(node)],
]);

const builtinNames = new Set([
  "Array", "Blob", "DataView", "Error", "FormData", "Headers", "Map", "Object",
  "Promise", "RegExp", "Request", "Response", "Set", "String", "TextDecoder",
  "TextEncoder", "TransformStream", "URL", "URLSearchParams", "Uint8Array", "WeakMap",
]);

export function auditCompatibility(
  entryPath: string,
  options: CompatibilityAuditOptions = {},
): CompatibilityReport {
  const root = path.resolve(options.root ?? process.cwd());
  const graph = loadModuleGraph(entryPath, options);
  const staging = analyzeStaging(graph);
  const requirements = new Map<string, {occurrences: number; modules: Set<string>; samples: ReturnType<typeof spanOf>[]}>(
    [...featurePredicates.keys()].map(feature => [feature, {occurrences: 0, modules: new Set(), samples: []}]),
  );
  const builtins = new Map<string, number>();

  for (const module of graph.modules) {
    function visit(node: ts.Node): void {
      for (const [feature, predicate] of featurePredicates) {
        if (predicate(node)) {
          const requirement = requirements.get(feature)!;
          requirement.occurrences++;
          requirement.modules.add(module.path);
          if (requirement.samples.length < 3) {
            requirement.samples.push(relativeSpan(spanOf(node, module.sourceFile), root));
          }
        }
      }
      if (ts.isIdentifier(node) && builtinNames.has(node.text)) {
        builtins.set(node.text, (builtins.get(node.text) ?? 0) + 1);
      }
      ts.forEachChild(node, visit);
    }
    visit(module.sourceFile);
  }

  return {
    version: 1,
    entry: displayPath(graph.entry, root),
    modules: graph.modules.map(module => ({
      path: displayPath(module.path, root),
      dependencies: module.dependencies.map(dependency => displayPath(dependency, root)),
    })),
    diagnostics: graph.diagnostics.map(diagnostic => relativeDiagnostic(diagnostic, root)),
    requirements: [...requirements.entries()]
      .filter(([, requirement]) => requirement.occurrences > 0)
      .map(([feature, requirement]) => ({
        feature,
        occurrences: requirement.occurrences,
        modules: requirement.modules.size,
        samples: requirement.samples,
      })),
    builtins: [...builtins.entries()]
      .map(([name, occurrences]) => ({name, occurrences}))
      .sort((left, right) => right.occurrences - left.occurrences || left.name.localeCompare(right.name)),
    staging: {
      constantBindings: staging.bindings.length,
      constantSpreads: staging.spreads.filter(spread => spread.disposition === "constant").length,
      runtimeSpreads: staging.spreads.filter(spread => spread.disposition === "runtime").length,
      spreads: staging.spreads.map(spread => ({
        ...spread,
        span: relativeSpan(spread.span, root),
      })),
      closedComputedAccesses: staging.computedAccesses.filter(access =>
        access.disposition === "closed"
      ).length,
      runtimeComputedAccesses: staging.computedAccesses.filter(access =>
        access.disposition === "runtime"
      ).length,
      computedAccesses: staging.computedAccesses.map(access => ({
        ...access,
        span: relativeSpan(access.span, root),
      })),
    },
    statistics: {
      modules: graph.modules.length,
      sourceBytes: graph.modules.reduce((total, module) => total + Buffer.byteLength(module.sourceFile.text), 0),
      sourceLines: graph.modules.reduce((total, module) => total + module.sourceFile.getLineStarts().length, 0),
    },
  };
}

function isAsyncFunction(node: ts.Node): boolean {
  return ts.isFunctionLike(node)
    && ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;
}

function isLoop(node: ts.Node): boolean {
  return ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node);
}

function isRestOrSpread(node: ts.Node): boolean {
  return ts.isSpreadAssignment(node) || ts.isSpreadElement(node) || ts.isRestTypeNode(node)
    || (ts.isParameter(node) && node.dotDotDotToken !== undefined)
    || (ts.isBindingElement(node) && node.dotDotDotToken !== undefined);
}

function isGenerator(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
  ) && node.asteriskToken !== undefined;
}

function relativeDiagnostic(diagnostic: Diagnostic, root: string): Diagnostic {
  return diagnostic.span === undefined
    ? diagnostic
    : {...diagnostic, span: relativeSpan(diagnostic.span, root)};
}

function relativeSpan(span: ReturnType<typeof spanOf>, root: string): ReturnType<typeof spanOf> {
  return {...span, file: displayPath(span.file, root)};
}

function displayPath(file: string, root: string): string {
  const relative = path.relative(root, file);
  return relative.startsWith("..") ? path.resolve(file) : relative;
}
