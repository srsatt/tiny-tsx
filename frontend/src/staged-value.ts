import ts from "typescript";
import type {ModuleGraph} from "./module-graph.js";

export const STAGED_UNDEFINED: unique symbol = Symbol("tinytsx.staged.undefined");

export type StagedValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | typeof STAGED_UNDEFINED
  | StagedValue[]
  | {[key: string]: StagedValue};

interface Binding {
  module: string;
  initializer: ts.Expression;
}

interface ImportedBinding {
  module: string;
  name: string;
}

export interface EvaluationContext {
  bindings: ReadonlyMap<string, Binding>;
  imports: ReadonlyMap<string, ReadonlyMap<string, ImportedBinding>>;
  cache: Map<string, StagedValue | undefined>;
  active: Set<string>;
}

export function createEvaluationContext(graph?: ModuleGraph): EvaluationContext {
  return {
    bindings: graph === undefined ? new Map() : collectTopLevelBindings(graph),
    imports: graph === undefined ? new Map() : collectImports(graph),
    cache: new Map(),
    active: new Set(),
  };
}

export function evaluateStagedValue(
  expression: ts.Expression,
  module: string,
  context: EvaluationContext,
): StagedValue | undefined {
  const value = unwrap(expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  if (ts.isNumericLiteral(value)) {
    return Number(value.text);
  }
  if (ts.isBigIntLiteral(value)) {
    return BigInt(value.text.slice(0, -1).replaceAll("_", ""));
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (value.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (value.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (
    ts.isPrefixUnaryExpression(value)
    && (value.operator === ts.SyntaxKind.MinusToken || value.operator === ts.SyntaxKind.PlusToken)
  ) {
    const operand = evaluateStagedValue(value.operand, module, context);
    if (typeof operand === "number") {
      return value.operator === ts.SyntaxKind.MinusToken ? -operand : operand;
    }
    if (typeof operand === "bigint" && value.operator === ts.SyntaxKind.MinusToken) {
      return -operand;
    }
    return undefined;
  }
  if (ts.isIdentifier(value)) {
    return evaluateIdentifier(value.text, module, context);
  }
  if (ts.isArrayLiteralExpression(value)) {
    return evaluateArray(value, module, context);
  }
  if (ts.isObjectLiteralExpression(value)) {
    return evaluateObject(value, module, context);
  }
  return undefined;
}

export function staticPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function evaluateArray(
  expression: ts.ArrayLiteralExpression,
  module: string,
  context: EvaluationContext,
): StagedValue[] | undefined {
  const result: StagedValue[] = [];
  for (const element of expression.elements) {
    if (ts.isOmittedExpression(element)) {
      return undefined;
    }
    if (ts.isSpreadElement(element)) {
      const spread = evaluateStagedValue(element.expression, module, context);
      if (!Array.isArray(spread)) {
        return undefined;
      }
      result.push(...spread);
      continue;
    }
    const item = evaluateStagedValue(element, module, context);
    if (item === undefined) {
      return undefined;
    }
    result.push(item);
  }
  return result;
}

function evaluateObject(
  expression: ts.ObjectLiteralExpression,
  module: string,
  context: EvaluationContext,
): {[key: string]: StagedValue} | undefined {
  const fields = new Map<string, StagedValue>();
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = evaluateStagedValue(property.expression, module, context);
      if (spread === null || Array.isArray(spread) || typeof spread !== "object") {
        return undefined;
      }
      for (const [name, field] of Object.entries(spread)) {
        fields.set(name, field);
      }
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      const name = staticPropertyName(property.name);
      const field = evaluateStagedValue(property.initializer, module, context);
      if (name === undefined || field === undefined) {
        return undefined;
      }
      fields.set(name, field);
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      const field = evaluateIdentifier(property.name.text, module, context);
      if (field === undefined) {
        return undefined;
      }
      fields.set(property.name.text, field);
      continue;
    }
    return undefined;
  }
  return Object.fromEntries(fields);
}

function evaluateIdentifier(
  name: string,
  module: string,
  context: EvaluationContext,
): StagedValue | undefined {
  const imported = context.imports.get(module)?.get(name);
  const targetModule = imported?.module ?? module;
  const targetName = imported?.name ?? name;
  const key = bindingKey(targetModule, targetName);
  if (context.cache.has(key)) {
    return context.cache.get(key);
  }
  if (context.active.has(key)) {
    return undefined;
  }
  const binding = context.bindings.get(key);
  if (binding === undefined) {
    return imported === undefined && name === "undefined" ? STAGED_UNDEFINED : undefined;
  }
  context.active.add(key);
  const value = evaluateStagedValue(binding.initializer, binding.module, context);
  context.active.delete(key);
  context.cache.set(key, value);
  return value;
}

function collectTopLevelBindings(graph: ModuleGraph): Map<string, Binding> {
  const result = new Map<string, Binding>();
  for (const module of graph.modules) {
    for (const statement of module.sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          result.set(bindingKey(module.path, declaration.name.text), {
            module: module.path,
            initializer: declaration.initializer,
          });
        }
      }
    }
  }
  return result;
}

function collectImports(graph: ModuleGraph): Map<string, ReadonlyMap<string, ImportedBinding>> {
  const result = new Map<string, ReadonlyMap<string, ImportedBinding>>();
  for (const module of graph.modules) {
    const moduleImports = new Map<string, ImportedBinding>();
    for (const statement of module.sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.importClause?.isTypeOnly
        || statement.importClause?.namedBindings === undefined
        || !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      const target = module.runtimeImports.find(runtimeImport =>
        runtimeImport.specifier === specifier
      )?.path;
      if (target === undefined) {
        continue;
      }
      for (const element of statement.importClause.namedBindings.elements) {
        if (!element.isTypeOnly) {
          moduleImports.set(element.name.text, {
            module: target,
            name: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    }
    result.set(module.path, moduleImports);
  }
  return result;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function bindingKey(module: string, name: string): string {
  return `${module}\0${name}`;
}
