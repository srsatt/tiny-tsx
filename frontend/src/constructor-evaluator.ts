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
  type EvaluationContext,
} from "./staged-value.js";
import {resolveRuntimeCallable} from "./runtime-callable.js";
import {
  continued,
  detail,
  type ExecutionResult,
  fromStaged,
  readProperty,
  stringValue,
  truthiness,
  typeOf,
  UNDEFINED,
  unknown,
  type Value,
  valuesEqual,
} from "./symbolic-value.js";

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

export interface EvaluatedRoute {
  method: string;
  path: string;
  basePath: string;
  handlerKind: "closure" | "reference" | "unknown";
}

export interface ApplicationInitializationEvaluation extends ConstructorEvaluation {
  routes: EvaluatedRoute[];
  routerInsertions: number;
}

interface Evaluator {
  graph: ModuleGraph;
  modules: ReadonlyMap<string, SourceModule>;
  staged: EvaluationContext;
  issues: ConstructorIssue[];
  root: ResolvedRuntimeClass;
  routerInsertions: number;
}

export function evaluateApplicationConstructor(
  graph: ModuleGraph,
  application: ApplicationEntry,
): ConstructorEvaluation | undefined {
  const resolved = resolveApplicationRuntimeClass(graph, application);
  if (resolved === undefined) {
    return undefined;
  }
  const state = initializeConstructor(graph, application, resolved);
  return summarize(state.evaluator, state.instance);
}

export function evaluateApplicationInitialization(
  graph: ModuleGraph,
  application: ApplicationEntry,
): ApplicationInitializationEvaluation | undefined {
  const resolved = resolveApplicationRuntimeClass(graph, application);
  if (resolved === undefined) {
    return undefined;
  }
  const {evaluator, instance} = initializeConstructor(graph, application, resolved);
  executeApplicationCalls(evaluator, application, instance);
  const summary = summarize(evaluator, instance);
  return {
    ...summary,
    routes: summarizeRoutes(instance),
    routerInsertions: evaluator.routerInsertions,
  };
}

function initializeConstructor(
  graph: ModuleGraph,
  application: ApplicationEntry,
  resolved: ResolvedRuntimeClass,
): {evaluator: Evaluator; instance: Value & {kind: "instance"}} {
  const evaluator: Evaluator = {
    graph,
    modules: new Map(graph.modules.map(module => [module.path, module])),
    staged: createEvaluationContext(graph),
    issues: [],
    root: resolved,
    routerInsertions: 0,
  };
  const instance: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
  const arguments_ = application.constructorArguments.map(applicationValue);
  executeClass(evaluator, resolved, arguments_, instance);
  return {evaluator, instance};
}

function summarize(
  evaluator: Evaluator,
  instance: Value & {kind: "instance"},
): ConstructorEvaluation {
  return {
    fields: [...instance.fields.entries()].map(([name, value]) => ({
      name,
      kind: value.kind,
      ...detail(value),
    })),
    issues: evaluator.issues,
  };
}

function executeApplicationCalls(
  evaluator: Evaluator,
  application: ApplicationEntry,
  instance: Value & {kind: "instance"},
): void {
  const entry = evaluator.modules.get(evaluator.graph.entry);
  if (entry === undefined) {
    return;
  }
  const environment = new Map<string, Value>([[application.binding, instance]]);
  for (const statement of entry.sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      continue;
    }
    const call = statement.expression;
    if (
      !ts.isPropertyAccessExpression(call.expression)
      || !ts.isIdentifier(call.expression.expression)
      || call.expression.expression.text !== application.binding
    ) {
      continue;
    }
    const callable = instance.fields.get(call.expression.name.text);
    const arguments_ = call.arguments.map(argument =>
      evaluate(evaluator, argument, entry, environment, instance)
    );
    if (callable?.kind !== "closure") {
      issue(evaluator, call.expression, entry, "application method is not an installed closure");
      continue;
    }
    invokeClosure(evaluator, callable, arguments_, instance);
  }
}

function summarizeRoutes(instance: Value & {kind: "instance"}): EvaluatedRoute[] {
  const routes = instance.fields.get("routes");
  if (routes?.kind !== "array") {
    return [];
  }
  return routes.items.flatMap(route => {
    if (route.kind !== "record") {
      return [];
    }
    const method = route.fields.get("method");
    const path = route.fields.get("path");
    const basePath = route.fields.get("basePath");
    const handler = route.fields.get("handler");
    if (method?.kind !== "string" || path?.kind !== "string" || basePath?.kind !== "string") {
      return [];
    }
    return [{
      method: method.value,
      path: path.value,
      basePath: basePath.value,
      handlerKind: handler?.kind === "closure"
        ? "closure" as const
        : handler?.kind === "reference"
          ? "reference" as const
          : "unknown" as const,
    }];
  });
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
): ExecutionResult {
  if (ts.isBlock(statement)) {
    return executeStatements(evaluator, statement.statements, module, environment, instance);
  }
  if (ts.isReturnStatement(statement)) {
    return {
      returned: true,
      value: statement.expression === undefined
        ? UNDEFINED
        : evaluate(evaluator, statement.expression, module, environment, instance),
    };
  }
  if (ts.isIfStatement(statement)) {
    const condition = evaluate(evaluator, statement.expression, module, environment, instance);
    const decision = truthiness(condition);
    if (decision === undefined) {
      issue(evaluator, statement.expression, module, "if condition is not a closed boolean");
      return continued();
    }
    const branch = decision ? statement.thenStatement : statement.elseStatement;
    return branch === undefined
      ? continued()
      : executeStatement(evaluator, branch, module, environment, instance);
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer === undefined
        ? UNDEFINED
        : evaluate(evaluator, declaration.initializer, module, environment, instance);
      bind(evaluator, declaration.name, value, module, environment);
    }
    return continued();
  }
  if (!ts.isExpressionStatement(statement)) {
    issue(evaluator, statement, module, "constructor statement is not supported");
    return continued();
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
    return continued();
  }
  if (ts.isCallExpression(expression)) {
    if (executeForEach(evaluator, expression, module, environment, instance)) {
      return continued();
    }
    if (executeObjectAssign(evaluator, expression, module, environment, instance)) {
      return continued();
    }
    if (executeEffectCall(evaluator, expression, module, environment, instance)) {
      return continued();
    }
  }
  issue(evaluator, expression, module, "constructor expression effect is not supported");
  return continued();
}

function executeStatements(
  evaluator: Evaluator,
  statements: readonly ts.Statement[],
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): ExecutionResult {
  for (const statement of statements) {
    const result = executeStatement(evaluator, statement, module, environment, instance);
    if (result.returned) {
      return result;
    }
  }
  return continued();
}

function invokeClosure(
  evaluator: Evaluator,
  closure: Value & {kind: "closure"},
  arguments_: Value[],
  instance: Value & {kind: "instance"},
): Value {
  return invokeFunctionLike(
    evaluator,
    closure.expression,
    closure.module,
    new Map(closure.environment),
    arguments_,
    instance,
  );
}

function invokeFunctionLike(
  evaluator: Evaluator,
  declaration: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  arguments_: Value[],
  instance: Value & {kind: "instance"},
): Value {
  let argumentIndex = 0;
  for (const parameter of declaration.parameters) {
    if (!ts.isIdentifier(parameter.name)) {
      issue(evaluator, parameter, module, "call parameter binding is not supported");
      continue;
    }
    if (parameter.dotDotDotToken !== undefined) {
      environment.set(parameter.name.text, {kind: "array", items: arguments_.slice(argumentIndex)});
      argumentIndex = arguments_.length;
      continue;
    }
    const supplied = arguments_[argumentIndex++];
    environment.set(
      parameter.name.text,
      supplied ?? (parameter.initializer === undefined
        ? UNDEFINED
        : evaluate(evaluator, parameter.initializer, module, environment, instance)),
    );
  }
  if (ts.isArrowFunction(declaration) && !ts.isBlock(declaration.body)) {
    return evaluate(evaluator, declaration.body, module, environment, instance);
  }
  const body = declaration.body;
  return body === undefined || !ts.isBlock(body)
    ? UNDEFINED
    : executeStatements(evaluator, body.statements, module, environment, instance).value;
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

function executeEffectCall(
  evaluator: Evaluator,
  call: ts.CallExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return false;
  }
  const receiver = evaluate(evaluator, call.expression.expression, module, environment, instance);
  const name = memberName(call.expression.name);
  const arguments_ = call.arguments.map(argument =>
    evaluate(evaluator, argument, module, environment, instance)
  );
  if (receiver.kind === "array" && name === "push") {
    receiver.items.push(...arguments_);
    return true;
  }
  if (receiver.kind === "constructed" && name === "add") {
    evaluator.routerInsertions++;
    return true;
  }
  if (receiver.kind === "instance") {
    const method = findInstanceMethod(evaluator, name);
    if (method !== undefined) {
      invokeFunctionLike(
        evaluator,
        method.declaration,
        method.module,
        new Map(),
        arguments_,
        instance,
      );
      return true;
    }
  }
  return false;
}

function findInstanceMethod(
  evaluator: Evaluator,
  name: string,
): {module: SourceModule; declaration: ts.MethodDeclaration} | undefined {
  let current: ResolvedRuntimeClass | undefined = evaluator.root;
  while (current !== undefined) {
    const method = current.declaration.members.find(member =>
      ts.isMethodDeclaration(member) && memberName(member.name) === name
    );
    if (method !== undefined && ts.isMethodDeclaration(method)) {
      return {module: current.module, declaration: method};
    }
    current = resolveBaseRuntimeClass(current, evaluator.modules);
  }
  return undefined;
}

function evaluateCall(
  evaluator: Evaluator,
  call: ts.CallExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const arguments_ = call.arguments.map(argument =>
    evaluate(evaluator, argument, module, environment, instance)
  );
  if (ts.isIdentifier(call.expression)) {
    const callable = evaluate(evaluator, call.expression, module, environment, instance);
    if (callable.kind === "reference" && callable.callable !== undefined) {
      return invokeFunctionLike(
        evaluator,
        callable.callable.declaration,
        callable.callable.module,
        new Map(),
        arguments_,
        instance,
      );
    }
  }
  if (ts.isPropertyAccessExpression(call.expression)) {
    const receiver = evaluate(evaluator, call.expression.expression, module, environment, instance);
    const name = memberName(call.expression.name);
    if (receiver.kind === "string") {
      if (name === "toUpperCase") return {kind: "string", value: receiver.value.toUpperCase()};
      if (name === "at") {
        const index = arguments_[0];
        return index?.kind === "number"
          ? receiver.value.at(index.value) === undefined
            ? UNDEFINED
            : {kind: "string", value: receiver.value.at(index.value)!}
          : unknown("String.at index is not a number");
      }
      if (name === "slice") {
        const start = arguments_[0];
        const end = arguments_[1];
        return start?.kind === "number" && (end === undefined || end.kind === "number")
          ? {kind: "string", value: receiver.value.slice(start.value, end?.kind === "number" ? end.value : undefined)}
          : unknown("String.slice bounds are not numbers");
      }
    }
  }
  return unknown("call expression is not a supported compile-time callable");
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
    if (staged !== undefined) {
      return fromStaged(staged);
    }
    if (expression.text === "undefined") {
      return UNDEFINED;
    }
    const callable = resolveRuntimeCallable(evaluator.modules, module, expression.text);
    return {
      kind: "reference",
      name: expression.text,
      module: module.path,
      ...(callable === undefined ? {} : {callable}),
    };
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
    return {
      kind: "closure",
      span: spanOf(expression, module.sourceFile),
      expression,
      module,
      environment: new Map(environment),
    };
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return readProperty(
      evaluate(evaluator, expression.expression, module, environment, instance),
      expression.name.text,
    );
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression !== undefined) {
    const key = evaluate(evaluator, expression.argumentExpression, module, environment, instance);
    const receiver = evaluate(evaluator, expression.expression, module, environment, instance);
    if (key.kind === "string") {
      return readProperty(receiver, key.value);
    }
    if (key.kind === "number") {
      if (receiver.kind === "array") return receiver.items[key.value] ?? UNDEFINED;
      if (receiver.kind === "string") {
        const character = receiver.value[key.value];
        return character === undefined ? UNDEFINED : {kind: "string", value: character};
      }
    }
    return unknown("computed property key is not a closed string or number");
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    const left = evaluate(evaluator, expression.left, module, environment, instance);
    if (operator === ts.SyntaxKind.QuestionQuestionToken) {
      return left.kind === "undefined" || left.kind === "null"
        ? evaluate(evaluator, expression.right, module, environment, instance)
        : left;
    }
    if (
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken
      || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      const equal = valuesEqual(left, right);
      return {
        kind: "boolean",
        value: operator === ts.SyntaxKind.EqualsEqualsEqualsToken ? equal : !equal,
      };
    }
  }
  if (ts.isConditionalExpression(expression)) {
    const condition = evaluate(evaluator, expression.condition, module, environment, instance);
    const decision = truthiness(condition);
    return decision !== undefined
      ? evaluate(
        evaluator,
        decision ? expression.whenTrue : expression.whenFalse,
        module,
        environment,
        instance,
      )
      : unknown("conditional test is not a closed boolean");
  }
  if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression)) {
    return {kind: "constructed", name: expression.expression.text, module: module.path};
  }
  if (ts.isTypeOfExpression(expression)) {
    const value = evaluate(evaluator, expression.expression, module, environment, instance);
    return {kind: "string", value: typeOf(value)};
  }
  if (ts.isCallExpression(expression)) {
    return evaluateCall(evaluator, expression, module, environment, instance);
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      const part = evaluate(evaluator, span.expression, module, environment, instance);
      value += stringValue(part) + span.literal.text;
    }
    return {kind: "string", value};
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

function applicationValue(argument: ApplicationArgument): Value {
  return argument.kind === "string"
    ? {kind: "string", value: argument.value ?? ""}
    : unknown("application constructor argument is not a closed primitive");
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

function memberName(name: ts.MemberName | ts.PropertyName): string {
  if (ts.isComputedPropertyName(name)) return name.getText();
  return ts.isPrivateIdentifier(name) && !name.text.startsWith("#") ? `#${name.text}` : name.text;
}
