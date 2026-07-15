import {createHash} from "node:crypto";
import path from "node:path";
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
  runtimeStringParts,
  type ExecutionResult,
  fromStaged,
  readProperty,
  stringValue,
  truthiness,
  typeOf,
  UNDEFINED,
  unknown,
  type ResponseBody,
  type ResponseHeaderValue,
  type Value,
  type RuntimeStringPart,
  type StreamState,
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
  headers?: Array<{name: string; value: ResponseHeaderValue}>;
  stderr?: string[];
  basicAuthorization?: EvaluatedBasicAuthorization;
  entityTag?: EvaluatedEntityTag;
}

interface EvaluatedRouteChoice {
  kind: "routeChoice";
  name: string;
  cases: Map<string, EvaluatedResponse>;
  fallback: EvaluatedResponse;
}

export interface EvaluatedBasicAuthorization {
  credentials: Array<{username: string; password: string}>;
  rejected: EvaluatedResponse;
}

export interface EvaluatedEntityTag {
  value: string;
  notModified: EvaluatedResponse;
}

export interface ApplicationInitializationEvaluation extends ConstructorEvaluation {
  routes: EvaluatedRoute[];
  notFoundResponse?: EvaluatedResponse;
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
  const installedErrorHandler = application.calls.some(call => call.method === "onError")
    ? instance.fields.get("errorHandler")
    : undefined;
  const errorHandler = installedErrorHandler?.kind === "closure"
    ? installedErrorHandler
    : undefined;
  const installedNotFoundHandler = instance.fields.get("#notFoundHandler");
  const notFoundHandler = installedNotFoundHandler?.kind === "closure"
    || installedNotFoundHandler?.kind === "reference" && installedNotFoundHandler.callable !== undefined
    ? installedNotFoundHandler
    : undefined;
  return {
    ...summary,
    routes: summarizeRoutes(evaluator, instance, errorHandler, notFoundHandler),
    ...(application.calls.some(call => call.method === "notFound")
      ? evaluateInstalledNotFound(evaluator, instance)
      : {}),
    routerInsertions: evaluator.routerInsertions,
  };
}

function evaluateInstalledNotFound(
  evaluator: Evaluator,
  instance: Value & {kind: "instance"},
): {notFoundResponse?: EvaluatedResponse} {
  const handler = instance.fields.get("#notFoundHandler");
  const routes = instance.fields.get("routes");
  if (handler?.kind !== "closure" || routes?.kind !== "array") return {};
  const requestPath = "/__tinytsx_not_found__";
  const middleware = routes.items.flatMap(candidate =>
    matchingMiddleware(candidate, "GET", requestPath)
  );
  const response = evaluateRouteHandler(
    evaluator,
    handler,
    middleware,
    requestPath,
    "GET",
    undefined,
    handler,
  );
  return response === undefined || response.kind === "routeChoice"
    ? {}
    : {notFoundResponse: response};
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
  errorHandler?: Value & {kind: "closure"},
  notFoundHandler?: Value,
): EvaluatedRoute[] {
  const routes = instance.fields.get("routes");
  if (routes?.kind !== "array") {
    return [];
  }
  return routes.items.flatMap((candidateRoute, routeIndex) => {
    if (candidateRoute.kind !== "record") {
      return [];
    }
    const method = candidateRoute.fields.get("method");
    const path = candidateRoute.fields.get("path");
    const basePath = candidateRoute.fields.get("basePath");
    const handler = candidateRoute.fields.get("handler");
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
      ? evaluateRouteHandler(
        evaluator,
        handler,
        middleware,
        path.value,
        method.value,
        errorHandler,
        notFoundHandler,
      )
      : undefined;
    const route: Omit<EvaluatedRoute, "response"> = {
      method: method.value,
      path: path.value,
      basePath: basePath.value,
      handlerKind: handler?.kind === "closure"
        ? "closure" as const
        : handler?.kind === "reference"
          ? "reference" as const
          : "unknown" as const,
    };
    if (response?.kind === "routeChoice") {
      return [
        ...[...response.cases].map(([key, selected]) => ({
          ...route,
          path: specializeRoutePath(path.value, response.name, key),
          response: selected,
        })),
        {...route, response: response.fallback},
      ];
    }
    return [{...route, ...(response === undefined ? {} : {response})}];
  });
}

function evaluateRouteHandler(
  evaluator: Evaluator,
  handler: Value & {kind: "closure"},
  middleware: Array<Value & {kind: "closure"}>,
  routePattern: string,
  requestMethod: string,
  errorHandler?: Value & {kind: "closure"},
  notFoundHandler?: Value,
): EvaluatedResponse | EvaluatedRouteChoice | undefined {
  const contextClass = findRuntimeClass(evaluator, "Context");
  if (contextClass === undefined) {
    return undefined;
  }
  const context: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
  evaluator.instanceClasses.set(context, contextClass);
  executeClass(
    evaluator,
    contextClass,
    [unknown("runtime Request"), contextOptions(notFoundHandler)],
    context,
  );
  context.fields.set("req", {kind: "request", routePattern, method: requestMethod});
  let response = invokeClosure(evaluator, handler, [context], context);
  let middlewareFailed = false;
  if (response.kind === "thrown" && errorHandler !== undefined) {
    response = invokeClosure(evaluator, errorHandler, [response.value, context], context);
  } else if (response.kind === "string" && errorHandler !== undefined) {
    const invalidReturn = evaluateInvalidHonoResponseReturn(
      evaluator,
      context,
      errorHandler,
      middleware.length,
    );
    if (invalidReturn !== undefined) {
      response = invalidReturn;
      middlewareFailed = true;
    }
  }
  if (response.kind === "routeChoice") {
    if (middleware.length > 0) {
      issue(evaluator, handler.expression, handler.module, "route-selected responses with middleware are not supported");
      return undefined;
    }
    const selected = evaluateRouteChoiceResponse(response, context);
    if (selected === undefined) {
      issue(evaluator, handler.expression, handler.module, "route-selected handler did not close every response");
    }
    return selected;
  }
  let basicAuthorization: {
    credentials: Array<{username: string; password: string}>;
    rejected: Value & {kind: "response"};
    rejectedStderr: string[];
    protectedHeaders: Set<string>;
  } | undefined;
  let entityTag: {
    value: string;
    notModified: Value & {kind: "response"};
    protectedHeaders: Set<string>;
  } | undefined;
  if (response.kind === "response" && !middlewareFailed) {
    for (const middlewareHandler of [...middleware].reverse()) {
      const middlewareContext: Value & {kind: "instance"} = {kind: "instance", fields: new Map()};
      evaluator.instanceClasses.set(middlewareContext, contextClass);
      executeClass(
        evaluator,
        contextClass,
        [unknown("runtime Request"), contextOptions(notFoundHandler)],
        middlewareContext,
      );
      middlewareContext.fields.set("req", {
        kind: "request",
        routePattern,
        method: requestMethod,
      });
      middlewareContext.fields.set("#res", cloneResponse(response));
      middlewareContext.fields.set("finalized", {kind: "boolean", value: true});
      const tag = closedEntityTag(middlewareHandler, response);
      if (tag !== undefined && entityTag === undefined) {
        response.headers.set("etag", {name: "ETag", value: tag});
        entityTag = {
          value: tag,
          notModified: {
            kind: "response",
            body: "",
            status: 304,
            contentType: "",
            headers: new Map([["etag", {name: "ETag", value: tag}]]),
          },
          protectedHeaders: new Set(response.headers.keys()),
        };
        continue;
      }
      const authorization = closedBasicAuthorization(middlewareHandler);
      if (authorization !== undefined) {
        const rejected = evaluateBasicAuthorizationRejection(
          evaluator,
          middlewareContext,
          authorization,
          errorHandler,
        );
        if (rejected !== undefined && basicAuthorization === undefined) {
          basicAuthorization = {
            credentials: authorization.credentials,
            rejected: rejected.response,
            rejectedStderr: rejected.stderr,
            protectedHeaders: new Set(response.headers.keys()),
          };
          continue;
        }
      }
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
  if (response.kind !== "response") {
    issue(
      evaluator,
      handler.expression,
      handler.module,
      `route handler response is not closed (${response.kind}${
        response.kind === "unknown" ? `: ${response.reason}` : ""
      })`,
    );
    return undefined;
  }
  if (basicAuthorization !== undefined) {
    for (const [name, header] of response.headers) {
      if (!basicAuthorization.protectedHeaders.has(name)) {
        basicAuthorization.rejected.headers.set(name, header);
      }
    }
  }
  if (entityTag !== undefined) {
    for (const [name, header] of response.headers) {
      if (!entityTag.protectedHeaders.has(name)) {
        entityTag.notModified.headers.set(name, header);
      }
    }
  }
  const headers = [...response.headers.values()].filter(header =>
    header.name.toLowerCase() !== "content-type"
  );
  const stderr = context.fields.get("#stderr");
  const stderrLines = stderr?.kind === "array"
    ? stderr.items.flatMap(value => value.kind === "string" ? [value.value] : [])
    : [];
  return {
    kind: "text",
    body: response.body,
    status: response.status,
    contentType: response.contentType,
    ...(headers.length === 0 ? {} : {headers}),
    ...(stderrLines.length === 0 ? {} : {stderr: stderrLines}),
    ...(basicAuthorization === undefined
      ? {}
      : {
        basicAuthorization: {
          credentials: basicAuthorization.credentials,
          rejected: evaluatedResponse(
            basicAuthorization.rejected,
            basicAuthorization.rejectedStderr,
          ),
        },
      }),
    ...(entityTag === undefined
      ? {}
      : {
        entityTag: {
          value: entityTag.value,
          notModified: evaluatedResponse(entityTag.notModified, []),
        },
      }),
  };
}

function contextOptions(notFoundHandler?: Value): Value {
  return notFoundHandler === undefined
    ? UNDEFINED
    : {kind: "record", fields: new Map([["notFoundHandler", notFoundHandler]])};
}

function evaluateInvalidHonoResponseReturn(
  evaluator: Evaluator,
  context: Value & {kind: "instance"},
  errorHandler: Value & {kind: "closure"},
  middlewareCount: number,
): Value | undefined {
  // Hono first fails while a post-next middleware clones the truthy non-Response
  // value. Each enclosing middleware then retries error-response assignment
  // against the same invalid Context.res value. The final HonoBase catch invokes
  // the installed handler directly. These are the exact Bun/Hono errors pinned
  // by the complete basic example's deliberate `@ts-ignore` route.
  const errors: Array<Value & {kind: "error"}> = [{
    kind: "error",
    name: "TypeError [ERR_INVALID_ARG_TYPE]",
    message: "Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
  }];
  for (let index = 0; index < middlewareCount; index++) {
    errors.push({
      kind: "error",
      name: "TypeError",
      message: "undefined is not an object (evaluating 'this.#res.headers.entries')",
    });
  }
  let response: Value | undefined;
  for (const error of errors) {
    response = invokeClosure(evaluator, errorHandler, [error, context], context);
    if (response.kind !== "response") return undefined;
  }
  return response;
}

function closedEntityTag(
  middleware: Value & {kind: "closure"},
  response: Value & {kind: "response"},
): string | undefined {
  const module = middleware.module.path.replaceAll("\\", "/");
  if (
    !module.endsWith("/middleware/etag/index.ts")
    || !ts.isFunctionExpression(middleware.expression)
    || middleware.expression.name?.text !== "etag"
  ) {
    return undefined;
  }
  const weak = middleware.environment.get("weak");
  const generator = middleware.environment.get("generator");
  if (weak?.kind !== "boolean" || generator?.kind !== "undefined") return undefined;
  const existing = response.headers.get("etag")?.value;
  if (typeof existing === "string") return existing;
  if (typeof response.body !== "string" || response.body.length === 0) return undefined;
  const digest = createHash("sha1").update(response.body, "utf8").digest("hex");
  return `${weak.value ? "W/" : ""}\"${digest}\"`;
}

interface ClosedBasicAuthorization {
  credentials: Array<{username: string; password: string}>;
  realm: string;
  invalidUserMessage: string;
}

function closedBasicAuthorization(
  middleware: Value & {kind: "closure"},
): ClosedBasicAuthorization | undefined {
  const module = middleware.module.path.replaceAll("\\", "/");
  if (
    !module.endsWith("/middleware/basic-auth/index.ts")
    || !ts.isFunctionExpression(middleware.expression)
    || middleware.expression.name?.text !== "basicAuth"
  ) {
    return undefined;
  }
  const users = middleware.environment.get("users");
  const options = middleware.environment.get("options");
  if (users?.kind !== "array" || options?.kind !== "record") return undefined;
  const credentials = users.items.flatMap(user => {
    if (user.kind !== "record") return [];
    const username = user.fields.get("username");
    const password = user.fields.get("password");
    return username?.kind === "string" && password?.kind === "string"
      ? [{username: username.value, password: password.value}]
      : [];
  });
  const realm = options.fields.get("realm");
  const invalidUserMessage = options.fields.get("invalidUserMessage");
  return credentials.length === users.items.length
    && realm?.kind === "string"
    && invalidUserMessage?.kind === "string"
    ? {
      credentials,
      realm: realm.value,
      invalidUserMessage: invalidUserMessage.value,
    }
    : undefined;
}

function evaluateBasicAuthorizationRejection(
  evaluator: Evaluator,
  context: Value & {kind: "instance"},
  authorization: ClosedBasicAuthorization,
  errorHandler: Value & {kind: "closure"} | undefined,
): {response: Value & {kind: "response"}; stderr: string[]} | undefined {
  if (errorHandler !== undefined) {
    context.fields.delete("#res");
    context.fields.set("finalized", {kind: "boolean", value: false});
    const response = invokeClosure(
      evaluator,
      errorHandler,
      [{kind: "error", name: "Error", message: ""}, context],
      context,
    );
    if (response.kind !== "response") return undefined;
    return {response, stderr: stderrLines(context)};
  }
  return {
    response: {
      kind: "response",
      body: authorization.invalidUserMessage,
      status: 401,
      contentType: "",
      headers: new Map([[
        "www-authenticate",
        {
          name: "WWW-Authenticate",
          value: `Basic realm="${authorization.realm.replaceAll('"', '\\"')}"`,
        },
      ]]),
    },
    stderr: [],
  };
}

function stderrLines(context: Value & {kind: "instance"}): string[] {
  const stderr = context.fields.get("#stderr");
  return stderr?.kind === "array"
    ? stderr.items.flatMap(value => value.kind === "string" ? [value.value] : [])
    : [];
}

function evaluatedResponse(
  response: Value & {kind: "response"},
  stderr: string[],
): EvaluatedResponse {
  const headers = [...response.headers.values()].filter(header =>
    header.name.toLowerCase() !== "content-type"
  );
  return {
    kind: "text",
    body: response.body,
    status: response.status,
    contentType: response.contentType,
    ...(headers.length === 0 ? {} : {headers}),
    ...(stderr.length === 0 ? {} : {stderr}),
  };
}

function evaluateRouteChoiceResponse(
  choice: Value & {kind: "routeChoice"},
  context: Value & {kind: "instance"},
): EvaluatedRouteChoice | undefined {
  if (
    choice.fallback.kind !== "response"
    || [...choice.cases.values()].some(value => value.kind !== "response")
  ) {
    return undefined;
  }
  const stderr = stderrLines(context);
  return {
    kind: "routeChoice",
    name: choice.name,
    cases: new Map([...choice.cases].map(([key, response]) => [
      key,
      evaluatedResponse(response as Value & {kind: "response"}, stderr),
    ])),
    fallback: evaluatedResponse(choice.fallback, stderr),
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
  const wildcardPrefix = path.value.endsWith("*") ? path.value.slice(0, -1) : undefined;
  const wildcardBase = wildcardPrefix?.endsWith("/")
    ? wildcardPrefix.slice(0, -1)
    : wildcardPrefix;
  const matches = path.value === "/*"
    || path.value === requestPath
    || (wildcardPrefix !== undefined
      && (requestPath === wildcardBase || requestPath.startsWith(wildcardPrefix)));
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
    const supplied = arguments_[index];
    const value = supplied === undefined || supplied.kind === "undefined"
      ? parameter.initializer === undefined
        ? UNDEFINED
        : evaluate(evaluator, parameter.initializer, resolved.module, environment, instance)
      : supplied;
    bind(evaluator, parameter.name, value, resolved.module, environment, instance);
    if (ts.isIdentifier(parameter.name) && ts.getModifiers(parameter)?.some(modifier =>
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
  if (ts.isThrowStatement(statement)) {
    return {
      returned: true,
      value: {
        kind: "thrown",
        value: evaluate(evaluator, statement.expression, module, environment, instance),
      },
    };
  }
  if (ts.isTryStatement(statement)) {
    let result = executeStatement(evaluator, statement.tryBlock, module, environment, instance);
    if (result.returned && result.value.kind === "thrown" && statement.catchClause !== undefined) {
      const catchEnvironment = new Map(environment);
      const binding = statement.catchClause.variableDeclaration?.name;
      if (binding !== undefined) {
        bind(evaluator, binding, result.value.value, module, catchEnvironment, instance);
      }
      result = executeStatement(
        evaluator,
        statement.catchClause.block,
        module,
        catchEnvironment,
        instance,
      );
    }
    if (statement.finallyBlock !== undefined) {
      const finallyResult = executeStatement(
        evaluator,
        statement.finallyBlock,
        module,
        environment,
        instance,
      );
      if (finallyResult.returned) return finallyResult;
    }
    return result;
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
      bind(evaluator, declaration.name, value, module, environment, instance);
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
      bind(evaluator, declaration.name, value, module, loopEnvironment, instance);
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
  if (
    ts.isBinaryExpression(expression)
    && (
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken
    )
  ) {
    if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      assign(evaluator, expression.left, evaluate(
        evaluator,
        expression.right,
        module,
        environment,
        instance,
      ), module, environment, instance);
    } else {
      evaluate(evaluator, expression, module, environment, instance);
    }
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
    const callee = unwrap(expression.expression);
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      evaluate(evaluator, expression, module, environment, instance);
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
    if (
      candidate?.name !== header.name
      || !sameResponseHeaderValue(candidate.value, header.value)
    ) return false;
  }
  return true;
}

function sameResponseHeaderValue(left: ResponseHeaderValue, right: ResponseHeaderValue): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  return left.length === right.length && left.every((part, index) => {
    const candidate = right[index];
    if (part.kind === "literal") {
      return candidate?.kind === "literal" && candidate.value === part.value;
    }
    if (part.kind === "elapsedMilliseconds") {
      return candidate?.kind === "elapsedMilliseconds";
    }
    if (part.kind === "fetchStatus") {
      return candidate?.kind === "fetchStatus" && candidate.url === part.url;
    }
    if (part.kind === "workerCall") {
      return candidate?.kind === "workerCall"
        && candidate.module === part.module
        && sameWorkerMessage(candidate.input, part.input);
    }
    return candidate?.kind === part.kind && candidate.name === part.name;
  });
}

function sameWorkerMessage(
  left: Extract<RuntimeStringPart, {kind: "workerCall"}>["input"],
  right: Extract<RuntimeStringPart, {kind: "workerCall"}>["input"],
): boolean {
  return left.kind === right.kind && (left.kind === "literal"
    ? right.kind === "literal" && left.value === right.value
    : right.kind === "queryParameter"
      && left.name === right.name
      && left.fallback === right.fallback);
}

function executeStatements(
  evaluator: Evaluator,
  statements: readonly ts.Statement[],
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): ExecutionResult {
  for (const [index, statement] of statements.entries()) {
    if (ts.isIfStatement(statement)) {
      const condition = evaluate(evaluator, statement.expression, module, environment, instance);
      if (condition.kind === "routeChoice" && isBooleanRouteChoice(condition)) {
        return executeRouteConditional(
          evaluator,
          statement,
          statements.slice(index + 1),
          condition,
          module,
          environment,
          instance,
        );
      }
    }
    const result = executeStatement(evaluator, statement, module, environment, instance);
    if (result.returned) {
      return result;
    }
  }
  return continued();
}

function executeRouteConditional(
  evaluator: Evaluator,
  statement: ts.IfStatement,
  remaining: readonly ts.Statement[],
  condition: Value & {kind: "routeChoice"},
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): ExecutionResult {
  const cases = new Map<string, Value>();
  for (const [key, decision] of condition.cases) {
    cases.set(
      key,
      executeSelectedRouteBranch(
        evaluator,
        statement,
        remaining,
        decision,
        module,
        selectRouteEnvironment(environment, condition.name, key),
        instance,
      ),
    );
  }
  const fallback = executeSelectedRouteBranch(
    evaluator,
    statement,
    remaining,
    condition.fallback,
    module,
    selectRouteEnvironment(environment, condition.name),
    instance,
  );
  return {
    returned: true,
    value: {kind: "routeChoice", name: condition.name, cases, fallback},
  };
}

function executeSelectedRouteBranch(
  evaluator: Evaluator,
  statement: ts.IfStatement,
  remaining: readonly ts.Statement[],
  decision: Value,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const selected = truthiness(decision);
  if (selected === undefined) return unknown("route-selected if condition is not boolean");
  const branch = selected ? statement.thenStatement : statement.elseStatement;
  const result = branch === undefined
    ? continued()
    : executeStatement(evaluator, branch, module, environment, instance);
  return result.returned
    ? result.value
    : executeStatements(evaluator, remaining, module, environment, instance).value;
}

function selectRouteEnvironment(
  environment: Map<string, Value>,
  name: string,
  key?: string,
): Map<string, Value> {
  return new Map([...environment].map(([binding, value]) => [
    binding,
    selectRouteValue(value, name, key),
  ]));
}

function selectRouteValue(value: Value, name: string, key?: string): Value {
  if (value.kind === "routeChoice" && value.name === name) {
    return key === undefined ? value.fallback : value.cases.get(key) ?? value.fallback;
  }
  if (value.kind === "array") {
    return {kind: "array", items: value.items.map(item => selectRouteValue(item, name, key))};
  }
  if (value.kind === "record") {
    return {
      kind: "record",
      fields: new Map([...value.fields].map(([field, candidate]) => [
        field,
        selectRouteValue(candidate, name, key),
      ])),
    };
  }
  return value;
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
      const supplied = arguments_[argumentIndex++];
      const value = supplied === undefined || supplied.kind === "undefined"
        ? parameter.initializer === undefined
          ? UNDEFINED
          : evaluate(evaluator, parameter.initializer, module, environment, instance)
        : supplied;
      bind(evaluator, parameter.name, value, module, environment, instance);
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
      supplied === undefined || supplied.kind === "undefined"
        ? parameter.initializer === undefined
          ? UNDEFINED
          : evaluate(evaluator, parameter.initializer, module, environment, instance)
        : supplied,
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
  if (receiver.kind === "array" && name === "unshift") {
    receiver.items.unshift(...arguments_);
    return true;
  }
  if (receiver.kind === "worker" && name === "terminate" && arguments_.length === 0) {
    receiver.state.terminated = true;
    return true;
  }
  if (receiver.kind === "constructed" && name === "add") {
    evaluator.routerInsertions++;
    return true;
  }
  if (receiver.kind === "constructed" && receiver.name === "WeakMap" && name === "set") {
    return true;
  }
  if (receiver.kind === "reference" && receiver.name === "contextStash" && name === "set") {
    return true;
  }
  if (receiver.kind === "headers" && name === "set") {
    const headerName = arguments_[0];
    const headerValue = arguments_[1];
    const loweredValue = headerValue === undefined ? undefined : responseHeaderValue(headerValue);
    if (headerName?.kind === "string" && loweredValue !== undefined) {
      receiver.entries.set(headerName.value.toLowerCase(), {
        name: headerName.value,
        value: loweredValue,
      });
      return true;
    }
  }
  if (receiver.kind === "reference" && receiver.name === "console" && name === "error") {
    if (arguments_.some(argument => argument.kind === "unknown" || argument.kind === "thrown")) {
      return false;
    }
    const line = arguments_.map(stringValue).join(" ");
    const logs = instance.fields.get("#stderr");
    if (logs?.kind === "array") {
      logs.items.push({kind: "string", value: line});
    } else {
      instance.fields.set("#stderr", {
        kind: "array",
        items: [{kind: "string", value: line}],
      });
    }
    return true;
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

function responseHeaderValue(value: Value): ResponseHeaderValue | undefined {
  if (value.kind === "string") return value.value;
  return runtimeStringParts(value);
}

function streamChunk(value: Value): string | RuntimeStringPart[] | undefined {
  if (value.kind === "string") return value.value;
  return runtimeStringParts(value);
}

function streamStateFromInitializer(value: Value): StreamState | undefined {
  if (value.kind !== "record") return undefined;
  for (const field of value.fields.values()) {
    if (field.kind !== "closure") continue;
    for (const captured of field.environment.values()) {
      if (captured.kind === "streamReader") return captured.state;
    }
  }
  return undefined;
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
  const directCallee = unwrap(call.expression);
  if (ts.isPropertyAccessExpression(call.expression)) {
    const receiver = evaluate(evaluator, call.expression.expression, module, environment, instance);
    if (
      (receiver.kind === "undefined" || receiver.kind === "null")
      && (call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined)
    ) {
      return UNDEFINED;
    }
  }
  const arguments_ = evaluateCallArguments(evaluator, call, module, environment, instance);
  if (ts.isArrowFunction(directCallee) || ts.isFunctionExpression(directCallee)) {
    const callable = evaluate(evaluator, directCallee, module, environment, instance);
    return callable.kind === "closure"
      ? invokeClosure(evaluator, callable, arguments_, instance)
      : unknown("immediate function is not a closed closure");
  }
  if (ts.isIdentifier(call.expression)) {
    const callable = evaluate(evaluator, call.expression, module, environment, instance);
    if (callable.kind === "closure") {
      return invokeClosure(evaluator, callable, arguments_, instance);
    }
    if (callable.kind === "reference" && callable.name === "String") {
      const argument = arguments_[0] ?? UNDEFINED;
      return argument.kind === "unknown"
        ? unknown("String argument is not closed")
        : {kind: "string", value: stringValue(argument)};
    }
    if (callable.kind === "reference" && callable.name === "Error") {
      const message = arguments_[0] ?? UNDEFINED;
      return message.kind === "unknown"
        ? unknown("Error message is not closed")
        : {kind: "error", name: "Error", message: message.kind === "undefined" ? "" : stringValue(message)};
    }
    if (callable.kind === "reference" && callable.name === "fetch") {
      const url = arguments_[0];
      return arguments_.length === 1 && url?.kind === "string"
        ? {kind: "fetchResponse", url: url.value}
        : unknown("fetch requires one closed URL string");
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
    if (receiver.kind === "reference" && receiver.name === "Date" && name === "now") {
      return arguments_.length === 0
        ? {kind: "clockNow"}
        : unknown("Date.now arguments are not supported");
    }
    if (receiver.kind === "reference" && receiver.name === "Number" && name === "isInteger") {
      const value = arguments_[0];
      return {kind: "boolean", value: value?.kind === "number" && Number.isInteger(value.value)};
    }
    if (receiver.kind === "reference" && receiver.name === "Array" && name === "isArray") {
      return {kind: "boolean", value: arguments_[0]?.kind === "array"};
    }
    if (receiver.kind === "writableStream" && name === "getWriter") {
      return {kind: "streamWriter", state: receiver.state};
    }
    if (receiver.kind === "readableStream" && name === "getReader") {
      return {kind: "streamReader", state: receiver.state};
    }
    if (receiver.kind === "constructed" && receiver.name === "TextEncoder" && name === "encode") {
      const input = arguments_[0];
      return input?.kind === "string"
        ? input
        : unknown("TextEncoder input is not a closed string");
    }
    if (receiver.kind === "streamWriter" && name === "write") {
      const input = arguments_[0];
      const chunk = input === undefined ? undefined : streamChunk(input);
      if (chunk === undefined) return unknown("stream chunk is not a lowerable string");
      receiver.state.chunks.push(chunk);
      return UNDEFINED;
    }
    if (receiver.kind === "streamWriter" && (name === "close" || name === "releaseLock")) {
      if (name === "close") receiver.state.closed = true;
      return UNDEFINED;
    }
    if (receiver.kind === "streamReader" && name === "cancel") {
      receiver.state.closed = true;
      return UNDEFINED;
    }
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
    if (receiver.kind === "worker" && name === "request") {
      if (receiver.state.terminated) {
        return unknown("Worker.request cannot target a terminated worker");
      }
      const input = arguments_[0];
      if (arguments_.length !== 1 || input === undefined) {
        return unknown("Worker.request requires one string message");
      }
      if (input.kind === "string") {
        return {
          kind: "workerCall",
          module: receiver.state.module,
          input: {kind: "literal", value: input.value},
        };
      }
      if (input.kind === "queryParameter") {
        return {
          kind: "workerCall",
          module: receiver.state.module,
          input: {kind: "queryParameter", name: input.name, fallback: input.fallback},
        };
      }
      return unknown("Worker.request message is not a lowerable string");
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
    if (receiver.kind === "reference" && receiver.name === "Object" && name === "fromEntries") {
      const entries = arguments_[0];
      if (entries?.kind !== "array") {
        return unknown("Object.fromEntries argument is not a closed entry array");
      }
      const fields = new Map<string, Value>();
      for (const entry of entries.items) {
        const key = entry.kind === "array" ? entry.items[0] : undefined;
        const value = entry.kind === "array" ? entry.items[1] : undefined;
        if (key?.kind !== "string" || value === undefined) {
          return unknown("Object.fromEntries entry is not a closed string pair");
        }
        fields.set(key.value, value);
      }
      return {kind: "record", fields};
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
      return value === undefined
        ? UNDEFINED
        : typeof value === "string"
          ? {kind: "string", value}
          : {kind: "runtimeString", parts: value};
    }
    if (receiver.kind === "headers" && name === "entries") {
      return {
        kind: "array",
        items: [...receiver.entries].map(([key, header]) => ({
          kind: "array",
          items: [
            {kind: "string", value: key},
            typeof header.value === "string"
              ? {kind: "string", value: header.value}
              : {kind: "runtimeString", parts: header.value},
          ],
        })),
      };
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
    if (receiver.kind === "array" && name === "map") {
      const callback = arguments_[0];
      if (callback?.kind !== "closure") {
        return unknown("Array.map callback is not a compile-time closure");
      }
      return {
        kind: "array",
        items: receiver.items.map((value, index) => invokeClosure(
          evaluator,
          callback,
          [value, {kind: "number", value: index}, receiver],
          instance,
        )),
      };
    }
    if (receiver.kind === "array" && name === "includes") {
      const searched = arguments_[0] ?? UNDEFINED;
      return {kind: "boolean", value: receiver.items.some(item => valuesEqual(item, searched))};
    }
    if (receiver.kind === "array" && name === "filter") {
      const callback = arguments_[0];
      const items: Value[] = [];
      for (const [index, value] of receiver.items.entries()) {
        const selected = callback?.kind === "reference" && callback.name === "Boolean"
          ? truthiness(value)
          : callback?.kind === "closure"
            ? truthiness(invokeClosure(
              evaluator,
              callback,
              [value, {kind: "number", value: index}, receiver],
              instance,
            ))
            : undefined;
        if (selected === undefined) {
          return unknown("Array.filter callback is not a closed predicate");
        }
        if (selected) items.push(value);
      }
      return {kind: "array", items};
    }
    if (receiver.kind === "array" && name === "join") {
      const separator = arguments_[0];
      if (separator !== undefined && separator.kind !== "string") {
        return unknown("Array.join separator is not a closed string");
      }
      return {
        kind: "string",
        value: receiver.items.map(stringValue).join(separator?.kind === "string" ? separator.value : ","),
      };
    }
    if (receiver.kind === "array" && (name === "every" || name === "some")) {
      const callback = arguments_[0];
      if (callback?.kind !== "closure") {
        return unknown(`Array.${name} callback is not a compile-time closure`);
      }
      for (const [index, value] of receiver.items.entries()) {
        const selected = truthiness(invokeClosure(
          evaluator,
          callback,
          [value, {kind: "number", value: index}, receiver],
          instance,
        ));
        if (selected === undefined) {
          return unknown(`Array.${name} callback is not a closed predicate`);
        }
        if (name === "every" && !selected) return {kind: "boolean", value: false};
        if (name === "some" && selected) return {kind: "boolean", value: true};
      }
      return {kind: "boolean", value: name === "every"};
    }
    if (receiver.kind === "array" && name === "find") {
      const callback = arguments_[0];
      if (callback?.kind !== "closure") {
        return unknown("Array.find callback is not a compile-time closure");
      }
      let choiceName: string | undefined;
      const cases = new Map<string, Value>();
      let fallback: Value = UNDEFINED;
      for (const [index, value] of receiver.items.entries()) {
        const predicate = invokeClosure(
          evaluator,
          callback,
          [value, {kind: "number", value: index}, receiver],
          instance,
        );
        const decision = truthiness(predicate);
        if (decision === true) return value;
        if (decision === false) continue;
        if (predicate.kind !== "routeChoice" || !isBooleanRouteChoice(predicate)) {
          return unknown("Array.find predicate is not a closed or route-selected boolean");
        }
        if (choiceName !== undefined && choiceName !== predicate.name) {
          return unknown("Array.find predicates use different route parameters");
        }
        choiceName = predicate.name;
        for (const [key, candidate] of predicate.cases) {
          if (candidate.kind === "boolean" && candidate.value && !cases.has(key)) {
            cases.set(key, value);
          }
        }
        if (predicate.fallback.kind === "boolean" && predicate.fallback.value) {
          fallback = value;
        }
      }
      return choiceName === undefined
        ? UNDEFINED
        : {kind: "routeChoice", name: choiceName, cases, fallback};
    }
    if (receiver.kind === "instance" || receiver.kind === "record") {
      const callable = receiver.fields.get(name);
      if (callable?.kind === "closure") {
        return invokeClosure(
          evaluator,
          callable,
          arguments_,
          receiver.kind === "instance" ? receiver : instance,
        );
      }
      if (callable?.kind === "reference" && callable.callable !== undefined) {
        return invokeFunctionLike(
          evaluator,
          callable.callable.declaration,
          callable.callable.module,
          new Map(),
          arguments_,
          receiver.kind === "instance" ? receiver : instance,
        );
      }
      if (receiver.kind === "record") {
        return unknown(`record method ${name} is not a closed callable`);
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
  return unknown(
    `call expression is not a supported compile-time callable: ${call.expression.getText(module.sourceFile)}${
      ts.isPropertyAccessExpression(call.expression)
        ? (() => {
          const receiver = evaluate(
            evaluator,
            call.expression.expression,
            module,
            environment,
            instance,
          );
          return ` (receiver: ${receiver.kind}${
            receiver.kind === "unknown" ? `: ${receiver.reason}` : ""
          })`;
        })()
        : ""
    }`,
  );
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

function looselyEqual(left: Value, right: Value): boolean {
  if (
    (left.kind === "undefined" || left.kind === "null")
    && (right.kind === "undefined" || right.kind === "null")
  ) {
    return true;
  }
  return valuesEqual(left, right);
}

function routeParameterEquality(
  left: Value,
  right: Value,
): (Value & {kind: "routeChoice"}) | undefined {
  const parameter = left.kind === "routeParameter" && right.kind === "string"
    ? {name: left.name, value: right.value}
    : right.kind === "routeParameter" && left.kind === "string"
      ? {name: right.name, value: left.value}
      : undefined;
  return parameter === undefined
    ? undefined
    : {
      kind: "routeChoice",
      name: parameter.name,
      cases: new Map([[parameter.value, {kind: "boolean", value: true}]]),
      fallback: {kind: "boolean", value: false},
    };
}

function mapRouteChoice(
  choice: Value & {kind: "routeChoice"},
  mapper: (value: Value) => Value,
): Value & {kind: "routeChoice"} {
  return {
    kind: "routeChoice",
    name: choice.name,
    cases: new Map([...choice.cases].map(([key, value]) => [key, mapper(value)])),
    fallback: mapper(choice.fallback),
  };
}

function negateValue(value: Value): Value {
  const decision = truthiness(value);
  return decision === undefined
    ? unknown("logical NOT operand is not closed")
    : {kind: "boolean", value: !decision};
}

function isBooleanRouteChoice(choice: Value & {kind: "routeChoice"}): boolean {
  return choice.fallback.kind === "boolean"
    && [...choice.cases.values()].every(value => value.kind === "boolean");
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
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
    return evaluateJsx(evaluator, expression, module, environment, instance);
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
    if (operator === ts.SyntaxKind.InKeyword) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      return left.kind === "string" && (right.kind === "record" || right.kind === "instance")
        ? {kind: "boolean", value: right.fields.has(left.value)}
        : unknown("in operands are not a closed property key and record");
    }
    if (operator === ts.SyntaxKind.InstanceOfKeyword) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (right.kind !== "reference") {
        return unknown("instanceof constructor is not a closed reference");
      }
      if (right.name === "Headers") {
        return {kind: "boolean", value: left.kind === "headers"};
      }
      if (left.kind !== "instance") {
        return {kind: "boolean", value: false};
      }
      let current = evaluator.instanceClasses.get(left);
      while (current !== undefined) {
        if (current.declaration.name?.text === right.name) {
          return {kind: "boolean", value: true};
        }
        current = resolveBaseRuntimeClass(current, evaluator.modules);
      }
      return {kind: "boolean", value: false};
    }
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
      if (left.kind === "queryParameter") {
        const fallback = evaluate(evaluator, expression.right, module, environment, instance);
        return fallback.kind === "string"
          ? {...left, fallback: fallback.value}
          : unknown("query parameter fallback is not a closed string");
      }
      return left.kind === "undefined" || left.kind === "null"
        ? evaluate(evaluator, expression.right, module, environment, instance)
        : left;
    }
    if (
      operator === ts.SyntaxKind.EqualsEqualsToken
      || operator === ts.SyntaxKind.ExclamationEqualsToken
      || operator === ts.SyntaxKind.EqualsEqualsEqualsToken
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
      const routeChoice = routeParameterEquality(left, right);
      if (routeChoice !== undefined) {
        const equal = operator === ts.SyntaxKind.EqualsEqualsToken
          || operator === ts.SyntaxKind.EqualsEqualsEqualsToken;
        return equal ? routeChoice : mapRouteChoice(routeChoice, negateValue);
      }
      const equal = operator === ts.SyntaxKind.EqualsEqualsToken
        || operator === ts.SyntaxKind.ExclamationEqualsToken
        ? looselyEqual(left, right)
        : valuesEqual(left, right);
      return {
        kind: "boolean",
        value: operator === ts.SyntaxKind.EqualsEqualsToken
          || operator === ts.SyntaxKind.EqualsEqualsEqualsToken
          ? equal
          : !equal,
      };
    }
    if (
      operator === ts.SyntaxKind.LessThanToken
      || operator === ts.SyntaxKind.LessThanEqualsToken
      || operator === ts.SyntaxKind.GreaterThanToken
      || operator === ts.SyntaxKind.GreaterThanEqualsToken
    ) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (left.kind === "number" && right.kind === "number") {
        return {
          kind: "boolean",
          value: operator === ts.SyntaxKind.LessThanToken
            ? left.value < right.value
            : operator === ts.SyntaxKind.LessThanEqualsToken
              ? left.value <= right.value
              : operator === ts.SyntaxKind.GreaterThanToken
                ? left.value > right.value
                : left.value >= right.value,
        };
      }
      if (left.kind === "string" && right.kind === "string") {
        return {
          kind: "boolean",
          value: operator === ts.SyntaxKind.LessThanToken
            ? left.value < right.value
            : operator === ts.SyntaxKind.LessThanEqualsToken
              ? left.value <= right.value
              : operator === ts.SyntaxKind.GreaterThanToken
                ? left.value > right.value
                : left.value >= right.value,
        };
      }
    }
    if (operator === ts.SyntaxKind.PlusToken) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      const joined = joinRuntimeStrings([left, right]);
      if (joined !== undefined) return joined;
      if (left.kind === "number" && right.kind === "number") {
        return {kind: "number", value: left.value + right.value};
      }
    }
    if (operator === ts.SyntaxKind.MinusToken) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (left.kind === "clockNow" && right.kind === "clockNow") {
        return {kind: "elapsedMilliseconds"};
      }
      if (left.kind === "number" && right.kind === "number") {
        return {kind: "number", value: left.value - right.value};
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
    if (expression.expression.text === "Worker") {
      return evaluateWorkerConstruction(evaluator, expression, module, environment, instance);
    }
    if (expression.expression.text === "Error") {
      const message = expression.arguments?.[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      return message.kind === "unknown"
        ? unknown("Error message is not closed")
        : {kind: "error", name: "Error", message: message.kind === "undefined" ? "" : stringValue(message)};
    }
    if (expression.expression.text === "Response") {
      const body = expression.arguments?.[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      if (
        body.kind !== "string"
        && body.kind !== "html"
        && body.kind !== "runtimeString"
        && body.kind !== "runtimeHtml"
        && body.kind !== "readableStream"
        && body.kind !== "workerCall"
        && body.kind !== "routeParameter"
        && body.kind !== "responseBody"
        && body.kind !== "undefined"
        && body.kind !== "null"
      ) {
        return unknown(body.kind === "unknown"
          ? `Response body is not a closed string or null: ${body.reason}`
          : "Response body is not a closed string or null");
      }
      const runtimeBody = body.kind === "routeParameter"
        ? [{kind: "routeParameter" as const, name: body.name}]
        : body.kind === "workerCall"
          ? runtimeStringParts(body)
        : body.kind === "runtimeString"
          ? body.parts
          : body.kind === "runtimeHtml"
            ? body.parts
          : body.kind === "responseBody"
            ? body.body
            : body.kind === "readableStream"
              ? {kind: "stream" as const, chunks: body.state.chunks}
              : undefined;
      const headers = responseHeaders(evaluator, expression, module, environment, instance);
      const contentTypeHeader = headers.get("content-type")?.value;
      const explicitContentType = typeof contentTypeHeader === "string"
        ? contentTypeHeader
        : undefined;
      return {
        kind: "response",
        body: runtimeBody ?? (body.kind === "string" || body.kind === "html" ? body.value : ""),
        status: responseStatus(evaluator, expression, module, environment, instance),
        contentType: explicitContentType ?? (body.kind === "string" || body.kind === "html" || runtimeBody !== undefined
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
        const entries = new Map<string, {name: string; value: ResponseHeaderValue}>();
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
    if (expression.expression.text === "TransformStream") {
      const state = {chunks: [], closed: false};
      return {
        kind: "record",
        fields: new Map([
          ["readable", {kind: "readableStream", state}],
          ["writable", {kind: "writableStream", state}],
        ]),
      };
    }
    if (expression.expression.text === "ReadableStream") {
      const initializer = expression.arguments?.[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      const writer = instance.fields.get("writer");
      return {
        kind: "readableStream",
        state: streamStateFromInitializer(initializer)
          ?? (writer?.kind === "streamWriter"
            ? writer.state
            : {chunks: [], closed: false}),
      };
    }
    const resolved = resolveRuntimeClass(module, expression.expression.text, evaluator.modules);
    if (
      resolved?.declaration.name?.text === "SmartRouter"
      && resolved.module.path.endsWith("/router/smart-router/router.ts")
    ) {
      return {kind: "constructed", name: "SmartRouter", module: module.path};
    }
    if (resolved !== undefined) {
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
    if (operand.kind === "routeChoice") {
      return mapRouteChoice(operand, negateValue);
    }
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
  if (ts.isTaggedTemplateExpression(expression)) {
    return evaluateTaggedTemplate(evaluator, expression, module, environment, instance);
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
        || part.kind === "clockNow"
        || part.kind === "queryParameter"
        || part.kind === "queryPredicate"
      ) {
        return unknown("template value is not closed or lowerable");
      }
      values.push(
        part.kind === "routeParameter"
          || part.kind === "requestHeader"
          || part.kind === "fetchStatus"
          || part.kind === "elapsedMilliseconds"
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

function evaluateWorkerConstruction(
  evaluator: Evaluator,
  expression: ts.NewExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const url = expression.arguments?.[0];
  const options = expression.arguments?.[1] === undefined
    ? UNDEFINED
    : evaluate(evaluator, expression.arguments[1], module, environment, instance);
  if (
    url === undefined
    || !ts.isNewExpression(url)
    || !ts.isIdentifier(url.expression)
    || url.expression.text !== "URL"
    || url.arguments?.length !== 2
    || !ts.isStringLiteralLike(url.arguments[0]!)
    || !isImportMetaUrl(url.arguments[1]!)
  ) {
    return unknown("Worker requires new URL(\"./module.ts\", import.meta.url)");
  }
  const type = options.kind === "record" ? options.fields.get("type") : undefined;
  if (type?.kind !== "string" || type.value !== "module") {
    return unknown("Worker requires { type: \"module\" }");
  }
  const candidate = path.resolve(path.dirname(module.path), url.arguments[0]!.text);
  const workerModule = module.dependencies.find(dependency => dependency === candidate);
  if (workerModule === undefined || !evaluator.modules.has(workerModule)) {
    return unknown(`Worker module is not in the runtime graph: ${url.arguments[0]!.text}`);
  }
  return {kind: "worker", state: {module: workerModule, terminated: false}};
}

function isImportMetaUrl(expression: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === "url"
    && ts.isMetaProperty(expression.expression)
    && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && expression.expression.name.text === "meta";
}

const jsxVoidTags = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen",
  "link", "meta", "param", "source", "track", "wbr",
]);

const jsxBooleanAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls",
  "default", "defer", "disabled", "download", "hidden", "inert", "ismap",
  "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open",
  "playsinline", "readonly", "required", "reversed", "selected",
]);

function evaluateJsx(
  evaluator: Evaluator,
  expression: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  if (ts.isJsxFragment(expression)) {
    return renderJsxChildren(evaluator, expression.children, module, environment, instance);
  }
  const opening = ts.isJsxElement(expression) ? expression.openingElement : expression;
  const children = ts.isJsxElement(expression) ? expression.children : [];
  if (!ts.isIdentifier(opening.tagName)) {
    return unknown("JSX tag name is not a closed identifier");
  }
  const attributes = evaluateJsxAttributes(
    evaluator,
    opening.attributes,
    module,
    environment,
    instance,
  );
  if (attributes.kind !== "record") return attributes;
  const renderedChildren = renderJsxChildValues(
    evaluator,
    children,
    module,
    environment,
    instance,
  );
  if (renderedChildren.kind === "unknown") return renderedChildren;
  if (/^[A-Z]/.test(opening.tagName.text)) {
    if (renderedChildren.items.length === 1) {
      attributes.fields.set("children", renderedChildren.items[0]!);
    } else if (renderedChildren.items.length > 1) {
      attributes.fields.set("children", renderedChildren);
    }
    const component = evaluate(evaluator, opening.tagName, module, environment, instance);
    if (component.kind === "closure") {
      return invokeClosure(evaluator, component, [attributes], instance);
    }
    return component.kind === "reference" && component.callable !== undefined
      ? invokeFunctionLike(
        evaluator,
        component.callable.declaration,
        component.callable.module,
        new Map(),
        [attributes],
        instance,
      )
      : unknown(`JSX component ${opening.tagName.text} is not a compile-time callable`);
  }

  const parts: RuntimeStringPart[] = [{kind: "literal", value: `<${opening.tagName.text}`}];
  for (const [sourceName, value] of attributes.fields) {
    const name = sourceName === "className" ? "class" : sourceName;
    if (value.kind === "undefined" || value.kind === "null" || value.kind === "boolean" && !value.value) {
      continue;
    }
    if (value.kind === "boolean") {
      if (jsxBooleanAttributes.has(name.toLowerCase())) {
        appendRuntimePart(parts, {kind: "literal", value: ` ${name}=""`});
      }
      continue;
    }
    if (value.kind === "queryParameter") {
      appendRuntimePart(parts, {kind: "literal", value: ` ${name}="`});
      appendRuntimePart(parts, {
        kind: "queryParameter",
        name: value.name,
        fallback: value.fallback,
        escapeHtml: true,
      });
      appendRuntimePart(parts, {kind: "literal", value: '"'});
      continue;
    }
    if (value.kind !== "string" && value.kind !== "number" && value.kind !== "bigint") {
      return unknown(`JSX attribute ${sourceName} is not a closed primitive`);
    }
    appendRuntimePart(parts, {
      kind: "literal",
      value: ` ${name}="${escapeHtmlAttribute(stringValue(value))}"`,
    });
  }
  if (jsxVoidTags.has(opening.tagName.text) && renderedChildren.items.length === 0) {
    appendRuntimePart(parts, {kind: "literal", value: "/>"});
    return htmlValue(parts);
  }
  appendRuntimePart(parts, {kind: "literal", value: ">"});
  const rendered = renderHtmlParts(renderedChildren.items, true);
  if (rendered === undefined) {
    return unknown("JSX children are not closed HTML values");
  }
  for (const part of rendered) appendRuntimePart(parts, part);
  appendRuntimePart(parts, {kind: "literal", value: `</${opening.tagName.text}>`});
  return htmlValue(parts);
}

function evaluateJsxAttributes(
  evaluator: Evaluator,
  attributes: ts.JsxAttributes,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const fields = new Map<string, Value>();
  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      const spread = evaluate(evaluator, property.expression, module, environment, instance);
      if (spread.kind !== "record") return unknown("JSX spread is not a closed record");
      for (const [name, value] of spread.fields) fields.set(name, value);
      continue;
    }
    if (!ts.isIdentifier(property.name)) return unknown("JSX attribute name is not closed");
    let value: Value;
    if (property.initializer === undefined) {
      value = {kind: "boolean", value: true};
    } else if (ts.isStringLiteral(property.initializer)) {
      value = {kind: "string", value: property.initializer.text};
    } else if (ts.isJsxExpression(property.initializer)) {
      value = property.initializer.expression === undefined
        ? UNDEFINED
        : evaluate(evaluator, property.initializer.expression, module, environment, instance);
    } else {
      return unknown("JSX attribute initializer is not supported");
    }
    fields.set(property.name.text, value);
  }
  return {kind: "record", fields};
}

function renderJsxChildren(
  evaluator: Evaluator,
  children: readonly ts.JsxChild[],
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const values = renderJsxChildValues(evaluator, children, module, environment, instance);
  if (values.kind === "unknown") return values;
  const rendered = renderHtmlParts(values.items, true);
  return rendered === undefined
    ? unknown("JSX children are not closed HTML values")
    : htmlValue(rendered);
}

function renderJsxChildValues(
  evaluator: Evaluator,
  children: readonly ts.JsxChild[],
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value & ({kind: "array"} | {kind: "unknown"}) {
  const values: Value[] = [];
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = normalizeJsxText(child.text);
      if (text.length > 0) values.push({kind: "string", value: text});
    } else if (ts.isJsxExpression(child)) {
      if (child.expression !== undefined) {
        values.push(evaluate(evaluator, child.expression, module, environment, instance));
      }
    } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      values.push(evaluateJsx(evaluator, child, module, environment, instance));
    }
  }
  const invalid = values.find(value => value.kind === "unknown");
  return invalid?.kind === "unknown" ? invalid : {kind: "array", items: values};
}

function normalizeJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let output = "";
  for (const [index, sourceLine] of lines.entries()) {
    let line = sourceLine.replaceAll("\t", " ");
    if (index > 0) line = line.replace(/^ +/, "");
    if (index + 1 < lines.length) line = line.replace(/ +$/, "");
    if (line.length === 0) continue;
    output += line;
    if (index + 1 < lines.length) output += " ";
  }
  return output;
}

function evaluateTaggedTemplate(
  evaluator: Evaluator,
  expression: ts.TaggedTemplateExpression,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): Value {
  const tag = evaluate(evaluator, expression.tag, module, environment, instance);
  if (tag.kind !== "reference" || tag.name !== "html") {
    return unknown("tagged template is not the Hono html helper");
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression.template)) {
    return {kind: "html", value: expression.template.text};
  }
  const parts: RuntimeStringPart[] = [{kind: "literal", value: expression.template.head.text}];
  for (const span of expression.template.templateSpans) {
    const value = evaluate(evaluator, span.expression, module, environment, instance);
    const rendered = renderHtmlParts([value], true);
    if (rendered === undefined) return unknown("html template value is not closed");
    for (const part of rendered) appendRuntimePart(parts, part);
    appendRuntimePart(parts, {kind: "literal", value: span.literal.text});
  }
  return htmlValue(parts);
}

function renderHtmlParts(
  values: readonly Value[],
  escapeStrings: boolean,
): RuntimeStringPart[] | undefined {
  const output: RuntimeStringPart[] = [];
  for (const value of values) {
    if (value.kind === "html") {
      appendRuntimePart(output, {kind: "literal", value: value.value});
    } else if (value.kind === "runtimeHtml") {
      for (const part of value.parts) appendRuntimePart(output, part);
    } else if (value.kind === "string") {
      appendRuntimePart(output, {
        kind: "literal",
        value: escapeStrings ? escapeHtmlText(value.value) : value.value,
      });
    } else if (value.kind === "number" || value.kind === "bigint") {
      appendRuntimePart(output, {kind: "literal", value: stringValue(value)});
    } else if (value.kind === "queryParameter") {
      appendRuntimePart(output, {
        kind: "queryParameter",
        name: value.name,
        fallback: value.fallback,
        escapeHtml: escapeStrings,
      });
    } else if (value.kind === "array") {
      const nested = renderHtmlParts(value.items, escapeStrings);
      if (nested === undefined) return undefined;
      for (const part of nested) appendRuntimePart(output, part);
    } else if (value.kind !== "undefined" && value.kind !== "null" && value.kind !== "boolean") {
      return undefined;
    }
  }
  return output;
}

function appendRuntimePart(parts: RuntimeStringPart[], part: RuntimeStringPart): void {
  const previous = parts.at(-1);
  if (part.kind === "literal" && previous?.kind === "literal") {
    previous.value += part.value;
  } else if (part.kind !== "literal" || part.value !== "") {
    parts.push({...part});
  }
}

function htmlValue(parts: RuntimeStringPart[]): Value {
  return parts.every(part => part.kind === "literal")
    ? {kind: "html", value: parts.map(part => part.value).join("")}
    : {kind: "runtimeHtml", parts};
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value);
}

function routeParameterNames(pattern: string): string[] {
  return pattern.split("/").flatMap(segment => {
    const match = /^:([A-Za-z0-9_]+)(?:\{.*\})?$/.exec(segment);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

function specializeRoutePath(pattern: string, name: string, value: string): string {
  return pattern.split("/").map(segment => {
    const match = /^:([A-Za-z0-9_]+)(?:\{.*\})?$/.exec(segment);
    return match?.[1] === name ? value : segment;
  }).join("/");
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
): Map<string, {name: string; value: ResponseHeaderValue}> {
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
  const result = new Map<string, {name: string; value: ResponseHeaderValue}>();
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
  instance: Value & {kind: "instance"},
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
          instance,
        );
      } else {
        const selected = value.items[index] ?? UNDEFINED;
        bind(
          evaluator,
          element.name,
          selected.kind === "undefined" && element.initializer !== undefined
            ? evaluate(evaluator, element.initializer, module, environment, instance)
            : selected,
          module,
          environment,
          instance,
        );
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
    if (field === undefined) {
      issue(evaluator, element, module, "constructor destructuring binding is not supported");
      continue;
    }
    excluded.add(field);
    const selected = value.fields.get(field) ?? UNDEFINED;
    bind(
      evaluator,
      element.name,
      selected.kind === "undefined" && element.initializer !== undefined
        ? evaluate(evaluator, element.initializer, module, environment, instance)
        : selected,
      module,
      environment,
      instance,
    );
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
