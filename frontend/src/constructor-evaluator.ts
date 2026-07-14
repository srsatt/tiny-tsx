import ts from "typescript";
import type {ApplicationArgument, ApplicationEntry} from "./application-entry.js";
import {spanOf} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";
import type {ModuleGraph, SourceModule} from "./module-graph.js";
import {
  resolveApplicationRuntimeClass,
  resolveBaseRuntimeClass,
  type ResolvedRuntimeClass,
} from "./runtime-class-plan.js";
import {
  createEvaluationContext,
  evaluateStagedValue,
  STAGED_UNDEFINED,
  type EvaluationContext,
  type StagedValue,
} from "./staged-value.js";

export interface EvaluatedField {
  name: string;
  kind: Value["kind"];
  detail?: string;
}

export interface ConstructorIssue {
  reason: string;
  span: SourceSpan;
}

export interface ConstructorEvaluation {
  fields: EvaluatedField[];
  issues: ConstructorIssue[];
}

type Value =
  | {kind: "undefined"}
  | {kind: "null"}
  | {kind: "boolean"; value: boolean}
  | {kind: "number"; value: number}
  | {kind: "bigint"; value: bigint}
  | {kind: "string"; value: string}
  | {kind: "array"; items: Value[]}
  | {kind: "record"; fields: Map<string, Value>}
  | {kind: "closure"; span: SourceSpan}
  | {kind: "reference"; name: string; module: string}
  | {kind: "constructed"; name: string; module: string}
  | {kind: "instance"; fields: Map<string, Value>}
  | {kind: "unknown"; reason: string};

interface Evaluator {
  graph: ModuleGraph;
  modules: ReadonlyMap<string, SourceModule>;
  staged: EvaluationContext;
  issues: ConstructorIssue[];
}

const UNDEFINED: Value = {kind: "undefined"};

export function evaluateApplicationConstructor(
  graph: ModuleGraph,
  application: ApplicationEntry,
): ConstructorEvaluation | undefined {
  const resolved = resolveApplicationRuntimeClass(graph, application);
  if (resolved === undefined) {
    return undefined;
  }
  const evaluator: Evaluator = {
    graph,
    modules: new Map(graph.modules.map(module => [module.path, module])),
    staged: createEvaluationContext(graph),
    issues: [],
  };
  const instance: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
  const arguments_ = application.constructorArguments.map(applicationValue);
  executeClass(evaluator, resolved, arguments_, instance);
  return {
    fields: [...instance.fields.entries()].map(([name, value]) => ({
      name,
      kind: value.kind,
      ...detail(value),
    })),
    issues: evaluator.issues,
  };
}

function executeClass(
  evaluator: Evaluator,
  resolved: ResolvedRuntimeClass,
  arguments_: Value[],
  instance: Value & {kind: "instance"},
): void {
  const constructor = resolved.declaration.members.find(ts.isConstructorDeclaration);
  const environment = new Map<string, Value>();
  for (const [index, parameter] of (constructor?.parameters ?? []).entries()) {
    if (!ts.isIdentifier(parameter.name)) {
      issue(evaluator, parameter, resolved.module, "constructor binding pattern is not supported");
      continue;
    }
    const supplied = arguments_[index];
    const value = supplied === undefined || supplied.kind === "undefined"
      ? parameter.initializer === undefined
        ? UNDEFINED
        : evaluate(evaluator, parameter.initializer, resolved.module, environment, instance)
      : supplied;
    environment.set(parameter.name.text, value);
    if (ts.getModifiers(parameter)?.some(modifier =>
      modifier.kind === ts.SyntaxKind.PublicKeyword
      || modifier.kind === ts.SyntaxKind.PrivateKeyword
      || modifier.kind === ts.SyntaxKind.ProtectedKeyword
      || modifier.kind === ts.SyntaxKind.ReadonlyKeyword
    )) {
      instance.fields.set(parameter.name.text, value);
    }
  }

  const base = resolveBaseRuntimeClass(resolved, evaluator.modules);
  const statements = constructor?.body?.statements ?? [];
  const superStatement = statements.find(statement =>
    ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression)
    && statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword
  );
  if (base !== undefined) {
    const superArguments = superStatement !== undefined
      && ts.isExpressionStatement(superStatement)
      && ts.isCallExpression(superStatement.expression)
      ? superStatement.expression.arguments.map(argument =>
        evaluate(evaluator, argument, resolved.module, environment, instance)
      )
      : arguments_;
    executeClass(evaluator, base, superArguments, instance);
  }
  initializeFields(evaluator, resolved, environment, instance);
  for (const statement of statements) {
    if (statement === superStatement) {
      continue;
    }
    executeStatement(evaluator, statement, resolved.module, environment, instance);
  }
}

function initializeFields(
  evaluator: Evaluator,
  resolved: ResolvedRuntimeClass,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): void {
  for (const member of resolved.declaration.members) {
    if (
      !ts.isPropertyDeclaration(member)
      || member.initializer === undefined
      || ts.getModifiers(member)?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)
    ) {
      continue;
    }
    const name = propertyName(member.name);
    if (name === undefined) {
      issue(evaluator, member.name, resolved.module, "computed class field initializer is not closed");
      continue;
    }
    instance.fields.set(
      name,
      evaluate(evaluator, member.initializer, resolved.module, environment, instance),
    );
  }
}

function executeStatement(
  evaluator: Evaluator,
  statement: ts.Statement,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): void {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer === undefined
        ? UNDEFINED
        : evaluate(evaluator, declaration.initializer, module, environment, instance);
      bind(evaluator, declaration.name, value, module, environment);
    }
    return;
  }
  if (!ts.isExpressionStatement(statement)) {
    issue(evaluator, statement, module, "constructor statement is not supported");
    return;
  }
  const expression = statement.expression;
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    assign(evaluator, expression.left, evaluate(
      evaluator,
      expression.right,
      module,
      environment,
      instance,
    ), module, environment, instance);
    return;
  }
  if (ts.isCallExpression(expression)) {
    if (executeForEach(evaluator, expression, module, environment, instance)) {
      return;
    }
    if (executeObjectAssign(evaluator, expression, module, environment, instance)) {
      return;
    }
  }
  issue(evaluator, expression, module, "constructor expression effect is not supported");
}

function executeForEach(
  evaluator: Evaluator,
  call: ts.CallExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): boolean {
  if (
    !ts.isPropertyAccessExpression(call.expression)
    || call.expression.name.text !== "forEach"
    || call.arguments.length < 1
  ) {
    return false;
  }
  const values = evaluate(evaluator, call.expression.expression, module, environment, instance);
  const callback = call.arguments[0]!;
  if (values.kind !== "array" || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return false;
  }
  const parameter = callback.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) {
    return false;
  }
  for (const value of values.items) {
    const callbackEnvironment = new Map(environment);
    callbackEnvironment.set(parameter.name.text, value);
    if (ts.isBlock(callback.body)) {
      for (const statement of callback.body.statements) {
        executeStatement(evaluator, statement, module, callbackEnvironment, instance);
      }
    } else {
      evaluate(evaluator, callback.body, module, callbackEnvironment, instance);
    }
  }
  return true;
}

function executeObjectAssign(
  evaluator: Evaluator,
  call: ts.CallExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): boolean {
  if (
    !ts.isPropertyAccessExpression(call.expression)
    || !ts.isIdentifier(call.expression.expression)
    || call.expression.expression.text !== "Object"
    || call.expression.name.text !== "assign"
  ) {
    return false;
  }
  const target = call.arguments[0] === undefined
    ? UNDEFINED
    : evaluate(evaluator, call.arguments[0], module, environment, instance);
  if (target.kind !== "instance") {
    return false;
  }
  for (const sourceExpression of call.arguments.slice(1)) {
    const source = evaluate(evaluator, sourceExpression, module, environment, instance);
    if (source.kind !== "record") {
      return false;
    }
    for (const [name, value] of source.fields) {
      target.fields.set(name, value);
    }
  }
  return true;
}

function evaluate(
  evaluator: Evaluator,
  original: ts.Expression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const expression = unwrap(original);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return {kind: "string", value: expression.text};
  }
  if (ts.isNumericLiteral(expression)) {
    return {kind: "number", value: Number(expression.text)};
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) {
    return {kind: "boolean", value: expression.kind === ts.SyntaxKind.TrueKeyword};
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return {kind: "null"};
  }
  if (expression.kind === ts.SyntaxKind.ThisKeyword) {
    return instance;
  }
  if (ts.isIdentifier(expression)) {
    const local = environment.get(expression.text);
    if (local !== undefined) {
      return local;
    }
    const staged = evaluateStagedValue(expression, module.path, evaluator.staged);
    return staged === undefined
      ? expression.text === "undefined"
        ? UNDEFINED
        : {kind: "reference", name: expression.text, module: module.path}
      : fromStaged(staged);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const items: Value[] = [];
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = evaluate(evaluator, element.expression, module, environment, instance);
        if (spread.kind !== "array") {
          return unknown("array spread is not closed");
        }
        items.push(...spread.items);
      } else if (!ts.isOmittedExpression(element)) {
        items.push(evaluate(evaluator, element, module, environment, instance));
      }
    }
    return {kind: "array", items};
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const fields = new Map<string, Value>();
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = propertyName(property.name);
        if (name === undefined) {
          return unknown("object property name is not closed");
        }
        fields.set(name, evaluate(evaluator, property.initializer, module, environment, instance));
      } else if (ts.isShorthandPropertyAssignment(property)) {
        fields.set(property.name.text, environment.get(property.name.text) ?? UNDEFINED);
      } else if (ts.isSpreadAssignment(property)) {
        const spread = evaluate(evaluator, property.expression, module, environment, instance);
        if (spread.kind !== "record") {
          return unknown("object spread is not closed");
        }
        for (const [name, value] of spread.fields) {
          fields.set(name, value);
        }
      } else {
        return unknown("object member is not supported");
      }
    }
    return {kind: "record", fields};
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return {kind: "closure", span: spanOf(expression, module.sourceFile)};
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return readProperty(
      evaluate(evaluator, expression.expression, module, environment, instance),
      expression.name.text,
    );
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined) {
    const key = evaluate(evaluator, expression.argumentExpression, module, environment, instance);
    return key.kind === "string"
      ? readProperty(evaluate(evaluator, expression.expression, module, environment, instance), key.value)
      : unknown("computed property key is not a string");
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = evaluate(evaluator, expression.left, module, environment, instance);
    return left.kind === "undefined" || left.kind === "null"
      ? evaluate(evaluator, expression.right, module, environment, instance)
      : left;
  }
  if (ts.isConditionalExpression(expression)) {
    const condition = evaluate(evaluator, expression.condition, module, environment, instance);
    return condition.kind === "boolean"
      ? evaluate(
        evaluator,
        condition.value ? expression.whenTrue : expression.whenFalse,
        module,
        environment,
        instance,
      )
      : unknown("conditional test is not a closed boolean");
  }
  if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression)) {
    return {kind: "constructed", name: expression.expression.text, module: module.path};
  }
  return unknown(`expression ${ts.SyntaxKind[expression.kind]} is not supported`);
}

function assign(
  evaluator: Evaluator,
  target: ts.Expression,
  value: Value,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): void {
  if (ts.isIdentifier(target)) {
    environment.set(target.text, value);
    return;
  }
  if (ts.isPropertyAccessExpression(target)) {
    const receiver = evaluate(evaluator, target.expression, module, environment, instance);
    if (receiver.kind === "instance" || receiver.kind === "record") {
      receiver.fields.set(target.name.text, value);
      return;
    }
  }
  if (ts.isElementAccessExpression(target) && target.argumentExpression !== undefined) {
    const receiver = evaluate(evaluator, target.expression, module, environment, instance);
    const key = evaluate(evaluator, target.argumentExpression, module, environment, instance);
    if ((receiver.kind === "instance" || receiver.kind === "record") && key.kind === "string") {
      receiver.fields.set(key.value, value);
      return;
    }
  }
  issue(evaluator, target, module, "assignment target is not closed");
}

function bind(
  evaluator: Evaluator,
  name: ts.BindingName,
  value: Value,
  module: SourceModule,
  environment: Map<string, Value>,
): void {
  if (ts.isIdentifier(name)) {
    environment.set(name.text, value);
    return;
  }
  if (!ts.isObjectBindingPattern(name) || value.kind !== "record") {
    issue(evaluator, name, module, "constructor destructuring source is not a closed record");
    return;
  }
  const excluded = new Set<string>();
  for (const element of name.elements) {
    if (element.dotDotDotToken !== undefined) {
      if (ts.isIdentifier(element.name)) {
        environment.set(element.name.text, {
          kind: "record",
          fields: new Map([...value.fields].filter(([field]) => !excluded.has(field))),
        });
      }
      continue;
    }
    const field = element.propertyName === undefined
      ? ts.isIdentifier(element.name) ? element.name.text : undefined
      : propertyName(element.propertyName);
    if (field === undefined || !ts.isIdentifier(element.name)) {
      issue(evaluator, element, module, "constructor destructuring binding is not supported");
      continue;
    }
    excluded.add(field);
    environment.set(element.name.text, value.fields.get(field) ?? UNDEFINED);
  }
}

function readProperty(value: Value, name: string): Value {
  return value.kind === "record" || value.kind === "instance"
    ? value.fields.get(name) ?? UNDEFINED
    : UNDEFINED;
}

function fromStaged(value: StagedValue): Value {
  if (value === STAGED_UNDEFINED) return UNDEFINED;
  if (value === null) return {kind: "null"};
  if (typeof value === "string") return {kind: "string", value};
  if (typeof value === "number") return {kind: "number", value};
  if (typeof value === "bigint") return {kind: "bigint", value};
  if (typeof value === "boolean") return {kind: "boolean", value};
  if (Array.isArray(value)) return {kind: "array", items: value.map(fromStaged)};
  return {kind: "record", fields: new Map(Object.entries(value).map(([name, field]) => [
    name,
    fromStaged(field),
  ]))};
}

function applicationValue(argument: ApplicationArgument): Value {
  return argument.kind === "string"
    ? {kind: "string", value: argument.value ?? ""}
    : argument.kind === "function"
      ? {kind: "closure", span: argument.span}
      : unknown("application argument is not closed");
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isPrivateIdentifier(name)) return name.text.startsWith("#") ? name.text : `#${name.text}`;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function issue(evaluator: Evaluator, node: ts.Node, module: SourceModule, reason: string): void {
  evaluator.issues.push({reason, span: spanOf(node, module.sourceFile)});
}

function unknown(reason: string): Value {
  return {kind: "unknown", reason};
}

function detail(value: Value): {detail?: string} {
  switch (value.kind) {
    case "string": return {detail: value.value};
    case "reference": return {detail: value.name};
    case "constructed": return {detail: value.name};
    case "unknown": return {detail: value.reason};
    default: return {};
  }
}
