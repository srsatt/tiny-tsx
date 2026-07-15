import ts from "typescript";
import type {ApplicationArgument, ApplicationEntry} from "./application-entry.js";
import {spanOf} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";
import type {ModuleGraph, SourceModule} from "./module-graph.js";
import {
  resolveApplicationRuntimeClass,
  resolveBaseRuntimeClass,
  resolveRuntimeClass,
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
  joinRuntimeStrings,
  type ExecutionResult,
  fromStaged,
  readProperty,
  stringValue,
  truthiness,
  typeOf,
  UNDEFINED,
  unknown,
  type ResponseBody,
  type Value,
  type RuntimeStringPart,
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
  response?: EvaluatedResponse;
}

export interface EvaluatedResponse {
  kind: "text";
  body: ResponseBody;
  status: number;
  contentType: string;
  headers?: Array<{name: string; value: string}>;
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
  instanceClasses: WeakMap<Value & {kind: "instance"}, ResolvedRuntimeClass>;
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
    routes: summarizeRoutes(evaluator, instance),
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
    instanceClasses: new WeakMap(),
  };
  const instance: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
  evaluator.instanceClasses.set(instance, resolved);
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
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name)
          || declaration.name.text === application.binding
          || declaration.initializer === undefined
        ) {
          continue;
        }
        environment.set(
          declaration.name.text,
          evaluate(evaluator, declaration.initializer, entry, environment, instance),
        );
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      continue;
    }
    const call = statement.expression;
    if (
      !ts.isPropertyAccessExpression(call.expression)
      || !ts.isIdentifier(call.expression.expression)
    ) {
      continue;
    }
    const receiver = environment.get(call.expression.expression.text);
    if (receiver?.kind !== "instance") {
      continue;
    }
    const callable = receiver.fields.get(call.expression.name.text);
    const arguments_ = call.arguments.map(argument =>
      evaluate(evaluator, argument, entry, environment, receiver)
    );
    if (callable?.kind === "closure") {
      invokeClosure(evaluator, callable, arguments_, receiver);
      continue;
    }
    const method = findInstanceMethod(evaluator, call.expression.name.text, receiver);
    if (method !== undefined) {
      invokeFunctionLike(
        evaluator,
        method.declaration,
        method.module,
        new Map(),
        arguments_,
        receiver,
      );
      continue;
    }
    issue(evaluator, call.expression, entry, "application method is not an installed closure");
  }
}

function summarizeRoutes(
  evaluator: Evaluator,
  instance: Value & {kind: "instance"},
): EvaluatedRoute[] {
  const routes = instance.fields.get("routes");
  if (routes?.kind !== "array") {
    return [];
  }
  return routes.items.flatMap((route, routeIndex) => {
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
    const hasLaterHandler = routes.items.slice(routeIndex + 1).some(candidate =>
      sameRoute(candidate, method.value, path.value)
    );
    if (["GET", "POST"].includes(method.value) && hasLaterHandler) {
      return [];
    }
    const middleware = routes.items.slice(0, routeIndex).flatMap(candidate =>
      matchingMiddleware(candidate, method.value, path.value)
    );
    const response = ["GET", "POST"].includes(method.value) && handler?.kind === "closure"
      ? evaluateRouteHandler(evaluator, handler, middleware, path.value)
      : undefined;
    return [{
      method: method.value,
      path: path.value,
      basePath: basePath.value,
      handlerKind: handler?.kind === "closure"
        ? "closure" as const
        : handler?.kind === "reference"
          ? "reference" as const
          : "unknown" as const,
      ...(response === undefined ? {} : {response}),
    }];
  });
}

function evaluateRouteHandler(
  evaluator: Evaluator,
  handler: Value & {kind: "closure"},
  middleware: Array<Value & {kind: "closure"}>,
  routePattern: string,
): EvaluatedResponse | undefined {
  const contextClass = findRuntimeClass(evaluator, "Context");
  if (contextClass === undefined) {
    return undefined;
  }
  const context: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
  evaluator.instanceClasses.set(context, contextClass);
  executeClass(
    evaluator,
    contextClass,
    [unknown("runtime Request"), UNDEFINED],
    context,
  );
  context.fields.set("req", {kind: "request", routePattern});
  let response = invokeClosure(evaluator, handler, [context], context);
  if (response.kind === "response") {
    for (const middlewareHandler of [...middleware].reverse()) {
      const middlewareContext: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
      evaluator.instanceClasses.set(middlewareContext, contextClass);
      executeClass(
        evaluator,
        contextClass,
        [unknown("runtime Request"), UNDEFINED],
        middlewareContext,
      );
      middlewareContext.fields.set("req", {kind: "request", routePattern});
      middlewareContext.fields.set("#res", cloneResponse(response));
      middlewareContext.fields.set("finalized", {kind: "boolean", value: true});
      const issueCount = evaluator.issues.length;
      invokeClosure(
        evaluator,
        middlewareHandler,
        [middlewareContext, {
          kind: "reference",
          name: "next",
          module: middlewareHandler.module.path,
        }],
        middlewareContext,
      );
      const middlewareResponse = middlewareContext.fields.get("#res");
      if (evaluator.issues.length === issueCount && middlewareResponse?.kind === "response") {
        response = middlewareResponse;
      }
    }
  }
  if (response.kind !== "response") return undefined;
  const headers = [...response.headers.values()].filter(header =>
    header.name.toLowerCase() !== "content-type"
  );
  return {
    kind: "text",
    body: response.body,
    status: response.status,
    contentType: response.contentType,
    ...(headers.length === 0 ? {} : {headers}),
  };
}

function cloneResponse(response: Value & {kind: "response"}): Value & {kind: "response"} {
  return {
    ...response,
    headers: new Map(response.headers),
  };
}

function matchingMiddleware(
  route: Value,
  requestMethod: string,
  requestPath: string,
): Array<Value & {kind: "closure"}> {
  if (route.kind !== "record") return [];
  const method = route.fields.get("method");
  const path = route.fields.get("path");
  const handler = route.fields.get("handler");
  if (
    method?.kind !== "string"
    || path?.kind !== "string"
    || handler?.kind !== "closure"
  ) {
    return [];
  }
  if (method.value === requestMethod && path.value === requestPath) {
    return [handler];
  }
  if (method.value !== "ALL") return [];
  const matches = path.value === "/*"
    || path.value === requestPath
    || (path.value.endsWith("*") && requestPath.startsWith(path.value.slice(0, -1)));
  return matches ? [handler] : [];
}

function sameRoute(route: Value, method: string, path: string): boolean {
  if (route.kind !== "record") return false;
  const candidateMethod = route.fields.get("method");
  const candidatePath = route.fields.get("path");
  return candidateMethod?.kind === "string"
    && candidateMethod.value === method
    && candidatePath?.kind === "string"
    && candidatePath.value === path;
}

function findRuntimeClass(evaluator: Evaluator, name: string): ResolvedRuntimeClass | undefined {
  let current: ResolvedRuntimeClass | undefined = evaluator.root;
  while (current !== undefined) {
    const resolved = resolveRuntimeClass(current.module, name, evaluator.modules);
    if (resolved !== undefined) {
      return resolved;
    }
    current = resolveBaseRuntimeClass(current, evaluator.modules);
  }
  return undefined;
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
      if (
        condition.kind === "queryPredicate"
        && condition.test === "present"
        && statement.elseStatement === undefined
      ) {
        return executeQueryConditionalStatement(
          evaluator,
          statement,
          condition.name,
          module,
          environment,
          instance,
        );
      }
      issue(
        evaluator,
        statement.expression,
        module,
        `if condition is not a closed boolean (${condition.kind}${
          condition.kind === "unknown" ? `: ${condition.reason}` : ""
        })`,
      );
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
  if (ts.isForOfStatement(statement)) {
    const values = evaluate(evaluator, statement.expression, module, environment, instance);
    if (values.kind !== "array" || !ts.isVariableDeclarationList(statement.initializer)) {
      issue(evaluator, statement, module, "for-of source is not a closed array");
      return continued();
    }
    const declaration = statement.initializer.declarations[0];
    if (declaration === undefined) {
      return continued();
    }
    for (const value of values.items) {
      const loopEnvironment = new Map(environment);
      bind(evaluator, declaration.name, value, module, loopEnvironment);
      const result = executeStatement(
        evaluator,
        statement.statement,
        module,
        loopEnvironment,
        instance,
      );
      if (result.returned) return result;
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
  if (ts.isAwaitExpression(expression)) {
    evaluate(evaluator, expression.expression, module, environment, instance);
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

function executeQueryConditionalStatement(
  evaluator: Evaluator,
  statement: ts.IfStatement,
  query: string,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): ExecutionResult {
  const current = instance.fields.get("#res");
  if (current?.kind !== "response") {
    issue(evaluator, statement.expression, module, "query-conditional effect has no response");
    return continued();
  }
  const before: Value & {kind: "response"} = {
    ...current,
    headers: new Map(current.headers),
  };
  const result = executeStatement(
    evaluator,
    statement.thenStatement,
    module,
    environment,
    instance,
  );
  const after = instance.fields.get("#res");
  if (
    result.returned
    || after?.kind !== "response"
    || !sameResponseMetadata(before, after)
    || !isBranchResponseBody(before.body)
    || !isBranchResponseBody(after.body)
  ) {
    instance.fields.set("#res", before);
    issue(evaluator, statement, module, "query-conditional response effect is not mergeable");
    return continued();
  }
  instance.fields.set("#res", {
    ...before,
    body: {
      kind: "queryConditional",
      query,
      whenPresent: after.body,
      whenAbsent: before.body,
    },
  });
  return continued();
}

function isBranchResponseBody(
  body: ResponseBody,
): body is string | RuntimeStringPart[] {
  return typeof body === "string" || Array.isArray(body);
}

function sameResponseMetadata(
  left: Value & {kind: "response"},
  right: Value & {kind: "response"},
): boolean {
  if (left.status !== right.status || left.contentType !== right.contentType) return false;
  if (left.headers.size !== right.headers.size) return false;
  for (const [name, header] of left.headers) {
    const candidate = right.headers.get(name);
    if (candidate?.name !== header.name || candidate.value !== header.value) return false;
  }
  return true;
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
    || !["forEach", "map"].includes(call.expression.name.text)
    || call.arguments.length < 1
  ) {
    return false;
  }
  const values = evaluate(evaluator, call.expression.expression, module, environment, instance);
  const callback = call.arguments[0]!;
  if (values.kind !== "array" || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    return false;
  }
  for (const value of values.items) {
    invokeFunctionLike(
      evaluator,
      callback,
      module,
      new Map(environment),
      [value],
      instance,
    );
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
  const arguments_ = evaluateCallArguments(evaluator, call, module, environment, instance);
  if (receiver.kind === "array" && name === "push") {
    receiver.items.push(...arguments_);
    return true;
  }
  if (receiver.kind === "constructed" && name === "add") {
    evaluator.routerInsertions++;
    return true;
  }
  if (receiver.kind === "headers" && name === "set") {
    const headerName = arguments_[0];
    const headerValue = arguments_[1];
    if (headerName?.kind === "string" && headerValue?.kind === "string") {
      receiver.entries.set(headerName.value.toLowerCase(), {
        name: headerName.value,
        value: headerValue.value,
      });
      return true;
    }
  }
  if (receiver.kind === "instance") {
    const callable = receiver.fields.get(name);
    if (callable?.kind === "closure") {
      invokeClosure(evaluator, callable, arguments_, receiver);
      return true;
    }
    const method = findInstanceMethod(evaluator, name, receiver);
    if (method !== undefined) {
      invokeFunctionLike(
        evaluator,
        method.declaration,
        method.module,
        new Map(),
        arguments_,
        receiver,
      );
      return true;
    }
  }
  return false;
}

function findInstanceMethod(
  evaluator: Evaluator,
  name: string,
  instance?: Value & {kind: "instance"},
): {module: SourceModule; declaration: ts.MethodDeclaration} | undefined {
  let current: ResolvedRuntimeClass | undefined = instance === undefined
    ? evaluator.root
    : evaluator.instanceClasses.get(instance) ?? evaluator.root;
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
  const arguments_ = evaluateCallArguments(evaluator, call, module, environment, instance);
  if (ts.isIdentifier(call.expression)) {
    const callable = evaluate(evaluator, call.expression, module, environment, instance);
    if (callable.kind === "reference" && callable.name === "String") {
      const argument = arguments_[0] ?? UNDEFINED;
      return argument.kind === "unknown"
        ? unknown("String argument is not closed")
        : {kind: "string", value: stringValue(argument)};
    }
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
    if (receiver.kind === "request" && name === "param") {
      const key = arguments_[0];
      if (key?.kind !== "string") {
        return unknown("request parameter name is not a closed string");
      }
      return routeParameterNames(receiver.routePattern).includes(key.value)
        ? {kind: "routeParameter", name: key.value}
        : UNDEFINED;
    }
    if (receiver.kind === "request" && name === "query") {
      const key = arguments_[0];
      return key?.kind === "string"
        ? {kind: "queryParameter", name: key.value}
        : unknown("request query name is not a closed string");
    }
    if (receiver.kind === "request" && name === "header") {
      const key = arguments_[0];
      return key?.kind === "string"
        ? {kind: "requestHeader", name: key.value}
        : unknown("request header name is not a closed string");
    }
    if (receiver.kind === "reference" && receiver.name === "Object" && name === "entries") {
      const value = arguments_[0];
      return value?.kind === "record"
        ? {
          kind: "array",
          items: [...value.fields].map(([key, field]) => ({
            kind: "array",
            items: [{kind: "string", value: key}, field],
          })),
        }
        : unknown("Object.entries argument is not a closed record");
    }
    if (receiver.kind === "reference" && receiver.name === "JSON" && name === "stringify") {
      const value = arguments_[0] ?? UNDEFINED;
      const space = arguments_[2];
      const serialized = stringifyJson(value, space?.kind === "number" ? space.value : undefined);
      return serialized === undefined ? UNDEFINED : {kind: "string", value: serialized};
    }
    if (receiver.kind === "headers" && name === "get") {
      const key = arguments_[0];
      if (key?.kind !== "string") return unknown("header name is not a closed string");
      const value = receiver.entries.get(key.value.toLowerCase())?.value;
      return value === undefined ? UNDEFINED : {kind: "string", value};
    }
    if (receiver.kind === "response" && name === "json") {
      if (typeof receiver.body !== "string") {
        return unknown("Response JSON body is not closed");
      }
      try {
        return fromJsonValue(JSON.parse(receiver.body));
      } catch {
        return unknown("Response body is not valid JSON");
      }
    }
    if (receiver.kind === "regexp" && name === "test") {
      const input = arguments_[0];
      return input?.kind === "string"
        ? {kind: "boolean", value: new RegExp(receiver.source, receiver.flags).test(input.value)}
        : unknown("RegExp.test input is not a closed string");
    }
    if (receiver.kind === "instance") {
      const callable = receiver.fields.get(name);
      if (callable?.kind === "closure") {
        return invokeClosure(evaluator, callable, arguments_, receiver);
      }
      const method = findInstanceMethod(evaluator, name, receiver);
      if (method !== undefined) {
        return invokeFunctionLike(
          evaluator,
          method.declaration,
          method.module,
          new Map(),
          arguments_,
          receiver,
        );
      }
    }
    if (receiver.kind === "string") {
      if (name === "toUpperCase") return {kind: "string", value: receiver.value.toUpperCase()};
      if (name === "startsWith") {
        const prefix = arguments_[0];
        return prefix?.kind === "string"
          ? {kind: "boolean", value: receiver.value.startsWith(prefix.value)}
          : unknown("String.startsWith prefix is not a closed string");
      }
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

function evaluateCallArguments(
  evaluator: Evaluator,
  call: ts.CallExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value[] {
  const arguments_: Value[] = [];
  for (const argument of call.arguments) {
    if (!ts.isSpreadElement(argument)) {
      arguments_.push(evaluate(evaluator, argument, module, environment, instance));
      continue;
    }
    const spread = evaluate(evaluator, argument.expression, module, environment, instance);
    if (spread.kind === "array") {
      arguments_.push(...spread.items);
    } else {
      arguments_.push(unknown("call spread is not a closed array"));
    }
  }
  return arguments_;
}

function combineQueryOr(left: Value, right: Value): Value | undefined {
  const leftPredicate = left.kind === "queryParameter"
    ? {kind: "queryPredicate" as const, name: left.name, test: "truthy" as const}
    : left.kind === "queryPredicate" ? left : undefined;
  if (leftPredicate === undefined) return undefined;
  if (truthiness(right) === false) return leftPredicate;
  if (
    right.kind === "queryPredicate"
    && right.name === leftPredicate.name
    && ((leftPredicate.test === "truthy" && right.test === "empty")
      || leftPredicate.test === "present")
  ) {
    return {kind: "queryPredicate", name: leftPredicate.name, test: "present"};
  }
  return undefined;
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
  if (ts.isRegularExpressionLiteral(expression)) {
    const separator = expression.text.lastIndexOf("/");
    return {
      kind: "regexp",
      source: expression.text.slice(1, separator),
      flags: expression.text.slice(separator + 1),
    };
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
        if (spread.kind === "undefined" || spread.kind === "null") {
          continue;
        }
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
    if (operator === ts.SyntaxKind.QuestionQuestionEqualsToken) {
      if (left.kind !== "undefined" && left.kind !== "null") return left;
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      assign(evaluator, expression.left, right, module, environment, instance);
      return right;
    }
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      const decision = truthiness(left);
      if (decision === false) return left;
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (decision === true) return right;
      const rightDecision = truthiness(right);
      return rightDecision === true && left.kind === "queryPredicate"
        ? left
        : rightDecision === false
          ? right
          : unknown(`logical AND operand is not closed (${left.kind}${
            left.kind === "unknown" ? `: ${left.reason}` : ""
          }, ${right.kind}${
            right.kind === "unknown" ? `: ${right.reason}` : ""
          })`);
    }
    if (operator === ts.SyntaxKind.BarBarToken) {
      const decision = truthiness(left);
      if (decision === true) return left;
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (decision === false) return right;
      return combineQueryOr(left, right) ?? unknown(`logical OR operand is not closed (${left.kind}${
        left.kind === "unknown" ? `: ${left.reason}` : ""
      }, ${right.kind}${right.kind === "unknown" ? `: ${right.reason}` : ""})`);
    }
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
      if (
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken
        && left.kind === "queryParameter"
        && right.kind === "string"
        && right.value === ""
      ) {
        return {kind: "queryPredicate", name: left.name, test: "empty"};
      }
      const equal = valuesEqual(left, right);
      return {
        kind: "boolean",
        value: operator === ts.SyntaxKind.EqualsEqualsEqualsToken ? equal : !equal,
      };
    }
    if (operator === ts.SyntaxKind.PlusToken) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      const joined = joinRuntimeStrings([left, right]);
      if (joined !== undefined) return joined;
      if (left.kind === "number" && right.kind === "number") {
        return {kind: "number", value: left.value + right.value};
      }
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
    if (expression.expression.text === "Response") {
      const body = expression.arguments?.[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      if (
        body.kind !== "string"
        && body.kind !== "runtimeString"
        && body.kind !== "routeParameter"
        && body.kind !== "undefined"
        && body.kind !== "null"
      ) {
        return unknown("Response body is not a closed string or null");
      }
      const runtimeBody = body.kind === "routeParameter"
        ? [{kind: "routeParameter" as const, name: body.name}]
        : body.kind === "runtimeString"
          ? body.parts
          : undefined;
      const headers = responseHeaders(evaluator, expression, module, environment, instance);
      const explicitContentType = headers.get("content-type")?.value;
      return {
        kind: "response",
        body: runtimeBody ?? (body.kind === "string" ? body.value : ""),
        status: responseStatus(evaluator, expression, module, environment, instance),
        contentType: explicitContentType ?? (body.kind === "string" || runtimeBody !== undefined
          ? "text/plain;charset=UTF-8"
          : ""),
        headers,
      };
    }
    if (expression.expression.text === "Headers") {
      const init = expression.arguments?.[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      if (init.kind === "undefined" || init.kind === "null") {
        return {kind: "headers", entries: new Map()};
      }
      if (init.kind === "headers") {
        return {kind: "headers", entries: new Map(init.entries)};
      }
      if (init.kind === "record") {
        const entries = new Map<string, {name: string; value: string}>();
        for (const [name, value] of init.fields) {
          if (value.kind !== "string") {
            return unknown("Headers record value is not a closed string");
          }
          entries.set(name.toLowerCase(), {name, value: value.value});
        }
        return {kind: "headers", entries};
      }
      return unknown("Headers initializer is not closed");
    }
    const resolved = resolveRuntimeClass(module, expression.expression.text, evaluator.modules);
    if (resolved !== undefined && isApplicationRuntimeClass(evaluator, resolved)) {
      const value: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
      evaluator.instanceClasses.set(value, resolved);
      executeClass(
        evaluator,
        resolved,
        (expression.arguments ?? []).map(argument =>
          evaluate(evaluator, argument, module, environment, instance)
        ),
        value,
      );
      return value;
    }
    return {kind: "constructed", name: expression.expression.text, module: module.path};
  }
  if (
    ts.isPrefixUnaryExpression(expression)
    && (expression.operator === ts.SyntaxKind.PlusToken || expression.operator === ts.SyntaxKind.MinusToken)
  ) {
    const operand = evaluate(evaluator, expression.operand, module, environment, instance);
    return operand.kind === "number"
      ? {
        kind: "number",
        value: expression.operator === ts.SyntaxKind.MinusToken ? -operand.value : operand.value,
      }
      : unknown("numeric unary operand is not a closed number");
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = evaluate(evaluator, expression.operand, module, environment, instance);
    const decision = truthiness(operand);
    return decision === undefined
      ? unknown("logical NOT operand is not closed")
      : {kind: "boolean", value: !decision};
  }
  if (ts.isTypeOfExpression(expression)) {
    const value = evaluate(evaluator, expression.expression, module, environment, instance);
    return {kind: "string", value: typeOf(value)};
  }
  if (ts.isCallExpression(expression)) {
    return evaluateCall(evaluator, expression, module, environment, instance);
  }
  if (ts.isAwaitExpression(expression)) {
    return evaluate(evaluator, expression.expression, module, environment, instance);
  }
  if (ts.isTemplateExpression(expression)) {
    const values: Value[] = [{kind: "string", value: expression.head.text}];
    for (const span of expression.templateSpans) {
      const part = evaluate(evaluator, span.expression, module, environment, instance);
      if (
        part.kind === "unknown"
        || part.kind === "queryParameter"
        || part.kind === "queryPredicate"
      ) {
        return unknown("template value is not closed or lowerable");
      }
      values.push(
        part.kind === "routeParameter"
          || part.kind === "requestHeader"
          || part.kind === "runtimeString"
          ? part
          : {kind: "string", value: stringValue(part)},
        {kind: "string", value: span.literal.text},
      );
    }
    return joinRuntimeStrings(values) ?? unknown("template value is not string-compatible");
  }
  return unknown(`expression ${ts.SyntaxKind[expression.kind]} is not supported`);
}

function routeParameterNames(pattern: string): string[] {
  return pattern.split("/").flatMap(segment =>
    segment.startsWith(":") && segment.length > 1 ? [segment.slice(1)] : []
  );
}

const UNSUPPORTED_JSON = Symbol("unsupported JSON value");

function stringifyJson(value: Value, space?: number): string | undefined {
  const converted = jsonValue(value, false);
  return converted === UNSUPPORTED_JSON || converted === undefined
    ? undefined
    : JSON.stringify(converted, null, space);
}

function fromJsonValue(value: unknown): Value {
  if (value === null) return {kind: "null"};
  if (typeof value === "boolean") return {kind: "boolean", value};
  if (typeof value === "number") return {kind: "number", value};
  if (typeof value === "string") return {kind: "string", value};
  if (Array.isArray(value)) return {kind: "array", items: value.map(fromJsonValue)};
  if (typeof value === "object") {
    return {
      kind: "record",
      fields: new Map(Object.entries(value).map(([name, field]) => [name, fromJsonValue(field)])),
    };
  }
  return UNDEFINED;
}

function jsonValue(value: Value, arrayElement: boolean): unknown | typeof UNSUPPORTED_JSON {
  switch (value.kind) {
    case "undefined": return arrayElement ? null : undefined;
    case "null": return null;
    case "boolean":
    case "string": return value.value;
    case "number": return Number.isFinite(value.value) ? value.value : null;
    case "bigint": return UNSUPPORTED_JSON;
    case "array": {
      const result: unknown[] = [];
      for (const item of value.items) {
        const converted = jsonValue(item, true);
        if (converted === UNSUPPORTED_JSON) return UNSUPPORTED_JSON;
        result.push(converted);
      }
      return result;
    }
    case "record": {
      const result: Record<string, unknown> = {};
      for (const [name, field] of value.fields) {
        const converted = jsonValue(field, false);
        if (converted === UNSUPPORTED_JSON) return UNSUPPORTED_JSON;
        if (converted !== undefined) result[name] = converted;
      }
      return result;
    }
    default: return arrayElement ? null : undefined;
  }
}

function isApplicationRuntimeClass(evaluator: Evaluator, candidate: ResolvedRuntimeClass): boolean {
  let current: ResolvedRuntimeClass | undefined = evaluator.root;
  while (current !== undefined) {
    if (current.declaration === candidate.declaration && current.module.path === candidate.module.path) {
      return true;
    }
    current = resolveBaseRuntimeClass(current, evaluator.modules);
  }
  return false;
}

function responseStatus(
  evaluator: Evaluator,
  expression: ts.NewExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): number {
  const init = expression.arguments?.[1] === undefined
    ? UNDEFINED
    : evaluate(evaluator, expression.arguments[1], module, environment, instance);
  const status = init.kind === "record" ? init.fields.get("status") : undefined;
  return init.kind === "response"
    ? init.status
    : status?.kind === "number" ? status.value : 200;
}

function responseHeaders(
  evaluator: Evaluator,
  expression: ts.NewExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Map<string, {name: string; value: string}> {
  const init = expression.arguments?.[1] === undefined
    ? UNDEFINED
    : evaluate(evaluator, expression.arguments[1], module, environment, instance);
  if (init.kind === "response") {
    return new Map(init.headers);
  }
  const headers = init.kind === "record" ? init.fields.get("headers") : undefined;
  if (headers?.kind === "headers") {
    return new Map(headers.entries);
  }
  if (headers?.kind !== "record") {
    return new Map();
  }
  const result = new Map<string, {name: string; value: string}>();
  for (const [name, value] of headers.fields) {
    if (value.kind === "string") {
      result.set(name.toLowerCase(), {name, value: value.value});
    }
  }
  return result;
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
      receiver.fields.set(
        receiver.kind === "instance" && target.name.text === "res" ? "#res" : target.name.text,
        value,
      );
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
  if (ts.isArrayBindingPattern(name) && value.kind === "array") {
    for (const [index, element] of name.elements.entries()) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.dotDotDotToken !== undefined) {
        bind(
          evaluator,
          element.name,
          {kind: "array", items: value.items.slice(index)},
          module,
          environment,
        );
      } else {
        bind(evaluator, element.name, value.items[index] ?? UNDEFINED, module, environment);
      }
    }
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
