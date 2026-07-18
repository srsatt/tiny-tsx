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
import {resolveRuntimeValue} from "./runtime-value.js";
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
  type ActorState,
  type DatabaseState,
  type SqliteParameter,
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
  memory: EvaluatedMemoryReport;
}

export type EvaluatedLifetime = "compileTime" | "static" | "request" | "worker" | "message" | "managed";
export type EvaluatedEscapeTarget = "none" | "response" | "worker" | "message" | "process";

export interface EvaluatedAllocationSite {
  module: string;
  line: number;
  column: number;
  valueKind: Value["kind"];
  instances: number;
  maxReferences: number;
  lifetime: EvaluatedLifetime;
  escape: EvaluatedEscapeTarget;
}

export interface EvaluatedMemoryReport {
  policy: "arena";
  managedHeapRequired: boolean;
  sites: EvaluatedAllocationSite[];
  summary: Record<EvaluatedLifetime, number> & {
    aliasedSites: number;
    responseEscapes: number;
  };
}

export interface EvaluatedRoute {
  method: string;
  path: string;
  basePath: string;
  handlerKind: "closure" | "reference" | "unknown";
  response?: EvaluatedResponse;
  parameterValidations?: EvaluatedParameterValidation[];
}

export interface EvaluatedParameterValidation {
  name: string;
  minLength: number;
  rejected: EvaluatedResponse;
}

export interface EvaluatedResponse {
  kind: "text";
  body: ResponseBody;
  status: number;
  contentType: string;
  headers?: Array<{name: string; value: ResponseHeaderValue}>;
  stderr?: string[];
  basicAuthorization?: EvaluatedBasicAuthorization;
  requestId?: {headerName: string; maxLength: number};
  bodyLimit?: EvaluatedBodyLimit;
  entityTag?: EvaluatedEntityTag;
  sqliteExistence?: EvaluatedSqliteExistence;
  actorActions?: EvaluatedActorAction[];
  databaseActions?: EvaluatedDatabaseAction[];
}

export interface EvaluatedBodyLimit {
  maxBytes: number;
  rejected: EvaluatedResponse;
}

export interface EvaluatedSqliteExistence {
  query: Value & {kind: "sqliteQuery"};
  missing: EvaluatedResponse;
}

export interface EvaluatedActorAction {
  kind: "tell" | "stop";
  actor: ActorState;
  message?: number | string;
}

export interface EvaluatedDatabaseAction {
  kind: "exec" | "transaction" | "transactionSteps" | "close";
  database: DatabaseState;
  sql?: string;
  parameters?: SqliteParameter[];
  result?: number;
  steps?: Array<{sql: string; parameters: SqliteParameter[]}>;
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
  actors: ActorState[];
  databases: DatabaseState[];
}

interface Evaluator {
  graph: ModuleGraph;
  modules: ReadonlyMap<string, SourceModule>;
  staged: EvaluationContext;
  issues: ConstructorIssue[];
  root: ResolvedRuntimeClass;
  routerInsertions: number;
  pathParameterValidations: Map<string, EvaluatedParameterValidation[]>;
  instanceClasses: WeakMap<Value & {kind: "instance"}, ResolvedRuntimeClass>;
  runtimeValues: Map<string, Value>;
  activeRuntimeValues: Set<string>;
  memory: MemoryTracker;
  actorActions: WeakMap<Value & {kind: "instance"}, EvaluatedActorAction[]>;
  actors: Map<string, ActorState>;
  databaseActions: WeakMap<Value & {kind: "instance"}, EvaluatedDatabaseAction[]>;
  sqliteExistence: WeakMap<Value & {kind: "instance"}, {
    query: Value & {kind: "sqliteQuery"};
    missing: Value & {kind: "response"};
  }>;
  databases: Map<string, DatabaseState>;
}

interface MemorySiteState {
  module: string;
  line: number;
  column: number;
  valueKind: Value["kind"];
  instances: number;
  maxReferences: number;
  escape: EvaluatedEscapeTarget;
}

interface MemoryValueState {
  site: MemorySiteState;
  references: number;
}

interface MemoryTracker {
  sites: Map<string, MemorySiteState>;
  values: WeakMap<object, MemoryValueState>;
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
  const routes = summarizeRoutes(evaluator, instance, errorHandler, notFoundHandler);
  const installedNotFound = application.calls.some(call => call.method === "notFound")
    ? evaluateInstalledNotFound(evaluator, instance)
    : {};
  return {
    ...summarize(evaluator, instance),
    routes,
    ...installedNotFound,
    routerInsertions: evaluator.routerInsertions,
    actors: [...evaluator.actors.values()],
    databases: [...evaluator.databases.values()],
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
    pathParameterValidations: new Map(),
    instanceClasses: new WeakMap(),
    runtimeValues: new Map(),
    activeRuntimeValues: new Set(),
    memory: {sites: new Map(), values: new WeakMap()},
    actorActions: new WeakMap(),
    actors: new Map(),
    databaseActions: new WeakMap(),
    sqliteExistence: new WeakMap(),
    databases: new Map(),
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
    memory: summarizeMemory(evaluator.memory),
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
    if (call.expression.name.text === "openapi") {
      recordOpenApiParameterValidations(evaluator, arguments_[0]);
    }
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
  const summarized = routes.items.flatMap((candidateRoute, routeIndex) => {
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
    if (isSupportedHttpMethod(method.value) && hasLaterHandler) {
      return [];
    }
    return expandOptionalRoutePaths(path.value).flatMap(resolvedPath => {
      const middleware = routes.items.slice(0, routeIndex).flatMap(candidate =>
        matchingMiddleware(candidate, method.value, resolvedPath)
      );
      const response = isSupportedHttpMethod(method.value) && handler?.kind === "closure"
        ? evaluateRouteHandler(
          evaluator,
          handler,
          middleware,
          resolvedPath,
          method.value,
          errorHandler,
          notFoundHandler,
        )
        : undefined;
      const installedValidations = evaluator.pathParameterValidations.get(
        `${method.value}\0${resolvedPath}`,
      ) ?? evaluator.pathParameterValidations.get(`${method.value}\0${path.value}`);
      const route: Omit<EvaluatedRoute, "response"> = {
        method: method.value,
        path: resolvedPath,
        basePath: basePath.value,
        handlerKind: handler?.kind === "closure"
          ? "closure" as const
          : handler?.kind === "reference"
            ? "reference" as const
            : "unknown" as const,
        ...(installedValidations === undefined
          ? parameterValidations(middleware)
          : {parameterValidations: installedValidations}),
      };
      const selectedRoutes = response?.kind === "routeChoice"
        ? [
          ...[...response.cases].map(([key, selected]) => ({
            ...route,
            path: specializeRoutePath(resolvedPath, response.name, key),
            response: selected,
          })),
          {...route, response: response.fallback},
        ]
        : [{...route, ...(response === undefined ? {} : {response})}];
      const cors = middleware.map(closedCors).find(candidate => candidate !== undefined);
      return cors === undefined || response === undefined || !isSupportedHttpMethod(method.value)
        || method.value === "OPTIONS"
        ? selectedRoutes
        : [...selectedRoutes, corsPreflightRoute(route, cors)];
    });
  });
  return summarized.filter((route, index, all) =>
    all.findIndex(candidate => candidate.method === route.method && candidate.path === route.path)
      === index
  );
}

function isSupportedHttpMethod(method: string): boolean {
  return ["GET", "POST", "PUT", "DELETE", "OPTIONS"].includes(method);
}

function parameterValidations(
  middleware: Array<Value & {kind: "closure"}>,
): {parameterValidations?: EvaluatedParameterValidation[]} {
  const schemas = middleware.flatMap(handler => {
    const values = nestedValues(handler);
    const targetsParam = values.some(value => value.kind === "string" && value.value === "param");
    return targetsParam
      ? values.filter((value): value is Value & {kind: "schema"} =>
        value.kind === "schema" && value.schemaType === "object"
      )
      : [];
  });
  const validations = schemas.flatMap(schema => [...(schema.fields ?? new Map())].flatMap(
    ([name, field]) => field.kind === "schema" && field.minLength !== undefined
      ? [{
        name,
        minLength: field.minLength,
        rejected: zodMinimumLengthRejection(name, field.minLength),
      }]
      : [],
  ));
  return validations.length === 0 ? {} : {parameterValidations: validations};
}

function recordOpenApiParameterValidations(evaluator: Evaluator, route: Value | undefined): void {
  if (route?.kind !== "record") return;
  const method = route.fields.get("method");
  const path = route.fields.get("path");
  const request = route.fields.get("request");
  const params = request?.kind === "record" ? request.fields.get("params") : undefined;
  if (
    method?.kind !== "string"
    || path?.kind !== "string"
    || params?.kind !== "schema"
    || params.schemaType !== "object"
  ) return;
  const validations = [...(params.fields ?? new Map())].flatMap(([name, field]) =>
    field.kind === "schema" && field.minLength !== undefined
      ? [{
        name,
        minLength: field.minLength,
        rejected: zodMinimumLengthRejection(name, field.minLength),
      }]
      : []
  );
  if (validations.length === 0) return;
  const routingPath = path.value.replaceAll(/\/{(.+?)}/g, "/:$1");
  evaluator.pathParameterValidations.set(`${method.value.toUpperCase()}\0${routingPath}`, validations);
}

function nestedValues(root: Value): Value[] {
  const output: Value[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: Value): void => {
    output.push(value);
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.kind === "closure") {
      for (const captured of value.environment.values()) visit(captured);
    } else if (value.kind === "record" || value.kind === "instance") {
      for (const field of value.fields.values()) visit(field);
    } else if (value.kind === "array") {
      for (const item of value.items) visit(item);
    }
  };
  visit(root);
  return output;
}

function zodMinimumLengthRejection(name: string, minimum: number): EvaluatedResponse {
  const issue = [{
    origin: "string",
    code: "too_small",
    minimum,
    inclusive: true,
    path: [name],
    message: `Too small: expected string to have >=${minimum} characters`,
  }];
  return {
    kind: "text",
    body: JSON.stringify({
      success: false,
      error: {name: "ZodError", message: JSON.stringify(issue, null, 2)},
    }),
    status: 400,
    contentType: "application/json",
  };
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
  context.fields.set("env", {kind: "environmentBindings"});
  context.fields.set("req", {kind: "request", routePattern, method: requestMethod});
  for (const middlewareHandler of middleware) {
    applyContextVariableMiddlewarePrelude(evaluator, middlewareHandler, context);
  }
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
  let bodyLimit: number | undefined;
  let requestId: {headerName: string; maxLength: number} | undefined;
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
      middlewareContext.fields.set("env", {kind: "environmentBindings"});
      middlewareContext.fields.set("req", {
        kind: "request",
        routePattern,
        method: requestMethod,
      });
      middlewareContext.fields.set("#res", cloneResponse(response));
      middlewareContext.fields.set("finalized", {kind: "boolean", value: true});
      if (isBodyLimitMiddleware(middlewareHandler)) {
        const requestBodyLimit = closedBodyLimit(middlewareHandler);
        if (requestBodyLimit === undefined) {
          issue(
            evaluator,
            middlewareHandler.expression,
            middlewareHandler.module,
            "bodyLimit requires a default error handler and a closed maxSize from 0 through 65536",
          );
          continue;
        }
        bodyLimit = bodyLimit === undefined
          ? requestBodyLimit
          : Math.min(bodyLimit, requestBodyLimit);
        continue;
      }
      if (isRequestIdMiddleware(middlewareHandler)) {
        const closed = closedRequestId(middlewareHandler);
        if (closed === undefined) {
          issue(
            evaluator,
            middlewareHandler.expression,
            middlewareHandler.module,
            "requestId requires its default generator, a closed valid headerName, and a limitLength from 1 through 1024",
          );
          continue;
        }
        if (requestId !== undefined) {
          issue(
            evaluator,
            middlewareHandler.expression,
            middlewareHandler.module,
            "multiple requestId middleware policies on one route are not supported",
          );
          continue;
        }
        requestId = closed;
        continue;
      }
      const cors = closedCors(middlewareHandler);
      if (cors !== undefined) {
        applyCorsHeaders(response, cors);
        continue;
      }
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
  if (responseUsesRequestId(response) && requestId === undefined) {
    issue(
      evaluator,
      handler.expression,
      handler.module,
      "Context.get(\"requestId\") requires one matched upstream requestId middleware",
    );
    return undefined;
  }
  if (requestId !== undefined) {
    const bound = bindResponseRequestId(response, requestId.headerName);
    response.body = bound.body;
    response.headers = bound.headers;
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
  const actorActions = evaluator.actorActions.get(context) ?? [];
  const databaseActions = evaluator.databaseActions.get(context) ?? [];
  const sqliteExistence = evaluator.sqliteExistence.get(context);
  if (sqliteExistence !== undefined) {
    for (const [name, header] of response.headers) {
      if (!sqliteExistence.missing.headers.has(name)) {
        sqliteExistence.missing.headers.set(name, header);
      }
    }
  }
  return {
    kind: "text",
    body: response.body,
    status: response.status,
    contentType: response.contentType,
    ...(headers.length === 0 ? {} : {headers}),
    ...(stderrLines.length === 0 ? {} : {stderr: stderrLines}),
    ...(actorActions.length === 0 ? {} : {actorActions}),
    ...(databaseActions.length === 0 ? {} : {databaseActions}),
    ...(sqliteExistence === undefined
      ? {}
      : {
        sqliteExistence: {
          query: sqliteExistence.query,
          missing: evaluatedResponse(sqliteExistence.missing, []),
        },
      }),
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
    ...(bodyLimit === undefined
      ? {}
      : {
        bodyLimit: {
          maxBytes: bodyLimit,
          rejected: {
            kind: "text" as const,
            body: "Payload Too Large",
            status: 413,
            contentType: "text/plain;charset=UTF-8",
          },
        },
      }),
    ...(requestId === undefined ? {} : {requestId}),
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

function closedRequestId(
  middleware: Value & {kind: "closure"},
): {headerName: string; maxLength: number} | undefined {
  if (!isRequestIdMiddleware(middleware)) return undefined;
  const limitLength = middleware.environment.get("limitLength");
  const headerName = middleware.environment.get("headerName");
  const generator = middleware.environment.get("generator");
  if (
    limitLength?.kind !== "number"
    || !Number.isSafeInteger(limitLength.value)
    || limitLength.value < 1
    || limitLength.value > 1024
    || headerName?.kind !== "string"
    || headerName.value.length === 0
    || Buffer.byteLength(headerName.value, "utf8") > 128
    || !/^[\w!#$%&'*.^`|~+-]+$/.test(headerName.value)
    || generator?.kind !== "closure"
    || !/\/middleware\/request-id\/request-id\.(?:ts|js)$/.test(
      generator.module.path.replaceAll("\\", "/"),
    )
  ) return undefined;
  return {headerName: headerName.value, maxLength: limitLength.value};
}

function isRequestIdMiddleware(middleware: Value & {kind: "closure"}): boolean {
  return /\/middleware\/request-id\/request-id\.(?:ts|js)$/.test(
    middleware.module.path.replaceAll("\\", "/"),
  )
    && ts.isFunctionExpression(middleware.expression)
    && /^requestId\d*$/.test(middleware.expression.name?.text ?? "");
}

interface ClosedCors {
  allowMethods: string[];
  allowHeaders: string[];
  exposeHeaders: string[];
  credentials: boolean;
  maxAge?: number;
}

function closedBodyLimit(middleware: Value & {kind: "closure"}): number | undefined {
  if (!isBodyLimitMiddleware(middleware)) {
    return undefined;
  }
  const maxSize = middleware.environment.get("maxSize");
  const onError = middleware.environment.get("onError");
  if (
    maxSize?.kind !== "number"
    || !Number.isSafeInteger(maxSize.value)
    || maxSize.value < 0
    || maxSize.value > 64 * 1024
    || onError?.kind !== "closure"
    || !/\/middleware\/body-limit\/index\.(?:ts|js)$/.test(
      onError.module.path.replaceAll("\\", "/"),
    )
  ) {
    return undefined;
  }
  return maxSize.value;
}

function isBodyLimitMiddleware(middleware: Value & {kind: "closure"}): boolean {
  return /\/middleware\/body-limit\/index\.(?:ts|js)$/.test(
    middleware.module.path.replaceAll("\\", "/"),
  )
    && ts.isFunctionExpression(middleware.expression)
    && /^bodyLimit\d*$/.test(middleware.expression.name?.text ?? "");
}

function closedCors(middleware: Value & {kind: "closure"}): ClosedCors | undefined {
  const module = middleware.module.path.replaceAll("\\", "/");
  if (
    !/\/middleware\/cors\/index\.(?:ts|js)$/.test(module)
    || !ts.isFunctionExpression(middleware.expression)
    || !["cors", "cors2"].includes(middleware.expression.name?.text ?? "")
  ) {
    return undefined;
  }
  const options = middleware.environment.get("opts");
  if (options?.kind !== "record") return undefined;
  const origin = options.fields.get("origin");
  const allowMethods = closedStringArray(options.fields.get("allowMethods"));
  const allowHeaders = closedStringArray(options.fields.get("allowHeaders"));
  const exposeHeaders = closedStringArray(options.fields.get("exposeHeaders"));
  const credentials = options.fields.get("credentials");
  const maxAge = options.fields.get("maxAge");
  if (
    origin?.kind !== "string"
    || origin.value !== "*"
    || allowMethods === undefined
    || allowHeaders === undefined
    || exposeHeaders === undefined
    || credentials !== undefined && credentials.kind !== "undefined"
      && credentials.kind !== "boolean"
    || maxAge !== undefined && maxAge.kind !== "undefined"
      && (maxAge.kind !== "number" || !Number.isSafeInteger(maxAge.value) || maxAge.value < 0)
  ) {
    return undefined;
  }
  return {
    allowMethods,
    allowHeaders,
    exposeHeaders,
    credentials: credentials?.kind === "boolean" && credentials.value,
    ...(maxAge?.kind === "number" ? {maxAge: maxAge.value} : {}),
  };
}

function closedStringArray(value: Value | undefined): string[] | undefined {
  if (value?.kind !== "array" || value.items.some(item => item.kind !== "string")) {
    return undefined;
  }
  return value.items.map(item => item.kind === "string" ? item.value : "");
}

function applyCorsHeaders(response: Value & {kind: "response"}, cors: ClosedCors): void {
  response.headers.set("access-control-allow-origin", {
    name: "Access-Control-Allow-Origin",
    value: "*",
  });
  if (cors.credentials) {
    response.headers.set("access-control-allow-credentials", {
      name: "Access-Control-Allow-Credentials",
      value: "true",
    });
  }
  if (cors.exposeHeaders.length > 0) {
    response.headers.set("access-control-expose-headers", {
      name: "Access-Control-Expose-Headers",
      value: cors.exposeHeaders.join(","),
    });
  }
}

function corsPreflightRoute(
  route: Omit<EvaluatedRoute, "response">,
  cors: ClosedCors,
): EvaluatedRoute {
  const headers: Array<{name: string; value: string}> = [{
    name: "Access-Control-Allow-Origin",
    value: "*",
  }];
  if (cors.credentials) {
    headers.push({name: "Access-Control-Allow-Credentials", value: "true"});
  }
  if (cors.exposeHeaders.length > 0) {
    headers.push({name: "Access-Control-Expose-Headers", value: cors.exposeHeaders.join(",")});
  }
  if (cors.allowMethods.length > 0) {
    headers.push({name: "Access-Control-Allow-Methods", value: cors.allowMethods.join(",")});
  }
  if (cors.allowHeaders.length > 0) {
    headers.push({name: "Access-Control-Allow-Headers", value: cors.allowHeaders.join(",")});
    headers.push({name: "Vary", value: "Access-Control-Request-Headers"});
  }
  if (cors.maxAge !== undefined) {
    headers.push({name: "Access-Control-Max-Age", value: String(cors.maxAge)});
  }
  return {
    ...route,
    method: "OPTIONS",
    response: {
      kind: "text",
      body: "",
      status: 204,
      contentType: "",
      headers,
    },
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

function responseUsesRequestId(response: Value & {kind: "response"}): boolean {
  return responseBodyUsesRequestId(response.body)
    || [...response.headers.values()].some(header => headerValueUsesRequestId(header.value));
}

function responseBodyUsesRequestId(body: ResponseBody): boolean {
  if (typeof body === "string") return false;
  if (Array.isArray(body)) return body.some(part => part.kind === "requestId");
  if (body.kind === "stream") {
    return body.chunks.some(chunk =>
      typeof chunk !== "string" && chunk.some(part => part.kind === "requestId")
    );
  }
  return headerValueUsesRequestId(body.whenPresent)
    || headerValueUsesRequestId(body.whenAbsent);
}

function headerValueUsesRequestId(value: ResponseHeaderValue): boolean {
  return typeof value !== "string" && value.some(part => part.kind === "requestId");
}

function bindResponseRequestId(
  response: Value & {kind: "response"},
  headerName: string,
): Value & {kind: "response"} {
  return {
    ...response,
    body: bindResponseBodyRequestId(response.body, headerName),
    headers: new Map([...response.headers].map(([key, header]) => [
      key,
      {...header, value: bindHeaderValueRequestId(header.value, headerName)},
    ])),
  };
}

function bindResponseBodyRequestId(body: ResponseBody, headerName: string): ResponseBody {
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return bindRuntimePartsRequestId(body, headerName);
  if (body.kind === "stream") {
    return {
      ...body,
      chunks: body.chunks.map(chunk => typeof chunk === "string"
        ? chunk
        : bindRuntimePartsRequestId(chunk, headerName)),
    };
  }
  return {
    ...body,
    whenPresent: bindHeaderValueRequestId(body.whenPresent, headerName),
    whenAbsent: bindHeaderValueRequestId(body.whenAbsent, headerName),
  };
}

function bindHeaderValueRequestId(
  value: ResponseHeaderValue,
  headerName: string,
): ResponseHeaderValue {
  return typeof value === "string" ? value : bindRuntimePartsRequestId(value, headerName);
}

function bindRuntimePartsRequestId(
  parts: RuntimeStringPart[],
  headerName: string,
): RuntimeStringPart[] {
  return parts.map(part => part.kind === "requestId" ? {...part, headerName} : part);
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

function isHonoContextInstance(
  evaluator: Evaluator,
  instance: Value & {kind: "instance"},
): boolean {
  const resolved = evaluator.instanceClasses.get(instance);
  return resolved !== undefined && /(?:^|\/)hono\/(?:src|dist)\/context\.(?:ts|js)$/.test(
    resolved.module.path.replaceAll("\\", "/"),
  );
}

function contextVariables(instance: Value & {kind: "instance"}): Map<string, Value> {
  const existing = instance.fields.get("#tinytsxContextVariables");
  if (existing?.kind === "record") return existing.fields;
  const fields = new Map<string, Value>();
  instance.fields.set("#tinytsxContextVariables", {kind: "record", fields});
  return fields;
}

function isBoundedContextVariable(value: Value): boolean {
  return value.kind === "undefined"
    || value.kind === "null"
    || value.kind === "boolean"
    || (value.kind === "number" && Number.isFinite(value.value))
    || value.kind === "string"
    || value.kind === "routeParameter"
    || value.kind === "requestHeader"
    || value.kind === "requestCookie"
    || value.kind === "environmentVariable"
    || value.kind === "fileText"
    || value.kind === "runtimeString";
}

function applyContextVariableMiddlewarePrelude(
  evaluator: Evaluator,
  middleware: Value & {kind: "closure"},
  context: Value & {kind: "instance"},
): void {
  if (isRequestIdMiddleware(middleware)) return;
  const declaration = middleware.expression;
  const body = declaration.body;
  if (body === undefined || !ts.isBlock(body)) return;
  const contextParameter = declaration.parameters[0]?.name;
  const nextParameter = declaration.parameters[1]?.name;
  if (
    contextParameter === undefined
    || nextParameter === undefined
    || !ts.isIdentifier(contextParameter)
    || !ts.isIdentifier(nextParameter)
  ) return;

  const prelude: ts.ExpressionStatement[] = [];
  let reachesNext = false;
  for (const statement of body.statements) {
    if (
      ts.isExpressionStatement(statement)
      && ts.isAwaitExpression(statement.expression)
      && ts.isCallExpression(statement.expression.expression)
      && ts.isIdentifier(statement.expression.expression.expression)
      && statement.expression.expression.expression.text === nextParameter.text
    ) {
      reachesNext = true;
      break;
    }
    if (
      !ts.isExpressionStatement(statement)
      || !ts.isCallExpression(statement.expression)
      || !ts.isPropertyAccessExpression(statement.expression.expression)
      || !ts.isIdentifier(statement.expression.expression.expression)
      || statement.expression.expression.expression.text !== contextParameter.text
      || statement.expression.expression.name.text !== "set"
    ) {
      return;
    }
    prelude.push(statement);
  }
  if (!reachesNext || prelude.length === 0) return;

  const environment = new Map(middleware.environment);
  environment.set(contextParameter.text, context);
  environment.set(nextParameter.text, {
    kind: "reference",
    name: "next",
    module: middleware.module.path,
  });
  for (const statement of prelude) {
    executeStatement(evaluator, statement, middleware.module, environment, context);
  }
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
  } else if (
    resolved.declaration.heritageClauses?.some(clause =>
      clause.token === ts.SyntaxKind.ExtendsKeyword
      && clause.types.some(type => ts.isIdentifier(type.expression) && type.expression.text === "Error")
    ) === true
  ) {
    const message = superStatement !== undefined
      && ts.isExpressionStatement(superStatement)
      && ts.isCallExpression(superStatement.expression)
      && superStatement.expression.arguments[0] !== undefined
      ? evaluate(
        evaluator,
        superStatement.expression.arguments[0],
        resolved.module,
        environment,
        instance,
      )
      : {kind: "string", value: ""} as const;
    instance.fields.set("name", {kind: "string", value: "Error"});
    instance.fields.set("message", message);
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
    const name = evaluatedPropertyName(
      evaluator,
      member.name,
      resolved.module,
      environment,
      instance,
    );
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
  if (ts.isBreakStatement(statement)) {
    return {returned: false, value: UNDEFINED, control: "break"};
  }
  if (ts.isContinueStatement(statement)) {
    return {returned: false, value: UNDEFINED, control: "continue"};
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
      if (value.kind === "thrown") {
        return {returned: true, value};
      }
      bind(evaluator, declaration.name, value, module, environment, instance);
    }
    return continued();
  }
  if (ts.isForOfStatement(statement)) {
    const values = evaluate(evaluator, statement.expression, module, environment, instance);
    if (values.kind !== "array" || !ts.isVariableDeclarationList(statement.initializer)) {
      issue(
        evaluator,
        statement,
        module,
        `for-of source ${statement.expression.getText(module.sourceFile)} is not a closed array (${values.kind}${
          values.kind === "unknown" ? `: ${values.reason}` : ""
        })`,
      );
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
      if (result.control === "break") return continued();
      if (result.control === "continue") continue;
    }
    return continued();
  }
  if (ts.isForStatement(statement)) {
    if (statement.initializer !== undefined) {
      if (ts.isVariableDeclarationList(statement.initializer)) {
        for (const declaration of statement.initializer.declarations) {
          bind(
            evaluator,
            declaration.name,
            declaration.initializer === undefined
              ? UNDEFINED
              : evaluate(evaluator, declaration.initializer, module, environment, instance),
            module,
            environment,
            instance,
          );
        }
      } else {
        evaluate(evaluator, statement.initializer, module, environment, instance);
      }
    }
    for (let iteration = 0; iteration < 1024; iteration++) {
      const condition = statement.condition === undefined
        ? {kind: "boolean", value: true} as const
        : evaluate(evaluator, statement.condition, module, environment, instance);
      const decision = truthiness(condition);
      if (decision === false) return continued();
      if (decision === undefined) {
        issue(evaluator, statement.condition ?? statement, module, "for condition is not closed");
        return continued();
      }
      const result = executeStatement(evaluator, statement.statement, module, environment, instance);
      if (result.returned) return result;
      if (result.control === "break") return continued();
      if (statement.incrementor !== undefined) {
        evaluate(evaluator, statement.incrementor, module, environment, instance);
      }
    }
    issue(evaluator, statement, module, "for loop exceeded 1024 compile-time iterations");
    return continued();
  }
  if (ts.isDoStatement(statement)) {
    for (let iteration = 0; iteration < 64; iteration++) {
      const result = executeStatement(evaluator, statement.statement, module, environment, instance);
      if (result.returned) return result;
      if (result.control === "break") return continued();
      const condition = evaluate(evaluator, statement.expression, module, environment, instance);
      const decision = truthiness(condition);
      if (decision === false) return continued();
      if (decision === undefined) {
        issue(
          evaluator,
          statement.expression,
          module,
          `do-while condition is not closed (${condition.kind}${
            condition.kind === "unknown" ? `: ${condition.reason}` : ""
          })`,
        );
        return continued();
      }
    }
    issue(evaluator, statement, module, "do-while exceeded 64 compile-time iterations");
    return continued();
  }
  if (ts.isSwitchStatement(statement)) {
    const selected = evaluate(evaluator, statement.expression, module, environment, instance);
    if (selected.kind === "unknown") {
      issue(evaluator, statement.expression, module, `switch value is not closed: ${selected.reason}`);
      return continued();
    }
    let matched = false;
    for (const clause of statement.caseBlock.clauses) {
      if (ts.isDefaultClause(clause)) {
        if (!matched) matched = true;
      } else if (!matched) {
        const candidate = evaluate(evaluator, clause.expression, module, environment, instance);
        matched = valuesEqual(selected, candidate);
      }
      if (!matched) continue;
      const result = executeStatements(evaluator, clause.statements, module, environment, instance);
      if (result.control === "break") return continued();
      if (result.returned || result.control === "continue") return result;
    }
    return continued();
  }
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
    return continued();
  }
  if (!ts.isExpressionStatement(statement)) {
    issue(
      evaluator,
      statement,
      module,
      `statement ${ts.SyntaxKind[statement.kind]} is not supported`,
    );
    return continued();
  }
  const expression = statement.expression;
  if (
    ts.isBinaryExpression(expression)
    && (
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken
      || expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
    )
  ) {
    if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const value = evaluate(
        evaluator,
        expression.right,
        module,
        environment,
        instance,
      );
      if (value.kind === "thrown") return {returned: true, value};
      assign(evaluator, expression.left, value, module, environment, instance);
    } else {
      const value = evaluate(evaluator, expression, module, environment, instance);
      if (value.kind === "thrown") return {returned: true, value};
      if (value.kind === "unknown") {
        issue(evaluator, expression, module, value.reason);
      }
    }
    return continued();
  }
  if (ts.isAwaitExpression(expression)) {
    const value = evaluate(evaluator, expression.expression, module, environment, instance);
    if (value.kind === "thrown") return {returned: true, value};
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
    const result = evaluate(evaluator, expression, module, environment, instance);
    if (result.kind === "thrown") return {returned: true, value: result};
    if (result.kind !== "unknown") {
      return continued();
    }
  }
  issue(
    evaluator,
    expression,
    module,
    `expression effect is not supported: ${expression.getText(module.sourceFile)}`,
  );
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
    if (part.kind === "openAiChatText") {
      return candidate?.kind === "openAiChatText"
        && candidate.url === part.url
        && candidate.authorization === part.authorization
        && candidate.body === part.body;
    }
    if (part.kind === "environmentVariable") {
      return candidate?.kind === "environmentVariable"
        && candidate.name === part.name
        && candidate.required === part.required
        && candidate.fallback === part.fallback;
    }
    if (part.kind === "fileText") {
      return candidate?.kind === "fileText"
        && candidate.path === part.path
        && candidate.maxBytes === part.maxBytes;
    }
    if (part.kind === "actorCall") {
      return candidate?.kind === "actorCall"
        && candidate.actor.key === part.actor.key
        && candidate.message === part.message
        && candidate.timeoutMs === part.timeoutMs;
    }
    if (part.kind === "sqliteQuery") {
      return candidate?.kind === "sqliteQuery"
        && candidate.statement.database.key === part.statement.database.key
        && candidate.statement.sql === part.statement.sql
        && candidate.mode === part.mode
        && sameSqliteParameters(candidate.parameters, part.parameters);
    }
    if (part.kind === "requestId") {
      return candidate?.kind === "requestId" && candidate.headerName === part.headerName;
    }
    if (part.kind === "sqliteRunChanges") {
      return candidate?.kind === "sqliteRunChanges" && candidate.result === part.result;
    }
    if (part.kind === "sqliteRunLastInsertRowId") {
      return candidate?.kind === "sqliteRunLastInsertRowId"
        && candidate.result === part.result
        && candidate.json === part.json;
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
      if (
        condition.kind === "sqlitePredicate"
        && condition.test === "missing"
        && statement.elseStatement === undefined
      ) {
        const result = executeSqliteMissingConditional(
          evaluator,
          statement,
          condition.query,
          module,
          environment,
          instance,
        );
        if (result.returned || result.control !== undefined) return result;
        continue;
      }
    }
    const result = executeStatement(evaluator, statement, module, environment, instance);
    if (result.returned || result.control !== undefined) {
      return result;
    }
  }
  return continued();
}

function executeSqliteMissingConditional(
  evaluator: Evaluator,
  statement: ts.IfStatement,
  query: Value & {kind: "sqliteQuery"},
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): ExecutionResult {
  if (evaluator.sqliteExistence.has(instance)) {
    issue(evaluator, statement, module, "only one SQLite existence guard is supported per route");
    return continued();
  }
  const actorActionCount = evaluator.actorActions.get(instance)?.length ?? 0;
  const databaseActionCount = evaluator.databaseActions.get(instance)?.length ?? 0;
  const result = executeStatement(
    evaluator,
    statement.thenStatement,
    module,
    new Map(environment),
    instance,
  );
  const actorActions = evaluator.actorActions.get(instance) ?? [];
  const databaseActions = evaluator.databaseActions.get(instance) ?? [];
  const hasEffects = actorActions.length !== actorActionCount
    || databaseActions.length !== databaseActionCount;
  actorActions.length = actorActionCount;
  databaseActions.length = databaseActionCount;
  if (!result.returned || result.value.kind !== "response" || hasEffects) {
    issue(
      evaluator,
      statement,
      module,
      "SQLite missing branch must directly return a closed response without effects",
    );
    return continued();
  }
  evaluator.sqliteExistence.set(instance, {query, missing: result.value});
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
  const environment = new Map(closure.environment);
  if (closure.lexicalThis !== undefined) environment.set("#this", closure.lexicalThis);
  return invokeFunctionLike(
    evaluator,
    closure.expression,
    closure.module,
    environment,
    arguments_,
    instance,
  );
}

function invokeFunctionLike(
  evaluator: Evaluator,
  declaration: ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.ArrowFunction | ts.FunctionExpression,
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
  if (receiver.kind === "instance" && isHonoContextInstance(evaluator, receiver) && name === "set") {
    const key = arguments_[0];
    const value = arguments_[1];
    if (arguments_.length !== 2 || key?.kind !== "string") {
      issue(evaluator, call, module, "Context.set requires one static string key and one value");
      return true;
    }
    const keyBytes = Buffer.byteLength(key.value, "utf8");
    if (key.value.length === 0 || keyBytes > 128) {
      issue(evaluator, call, module, "Context.set key must be a non-empty UTF-8 string of at most 128 bytes");
      return true;
    }
    if (key.value === "requestId") {
      issue(evaluator, call, module, "Context.set cannot replace the reserved requestId value");
      return true;
    }
    if (value === undefined || !isBoundedContextVariable(value)) {
      issue(
        evaluator,
        call,
        module,
        "Context.set value must be a bounded primitive or supported request-time string",
      );
      return true;
    }
    const variables = contextVariables(receiver);
    if (!variables.has(key.value) && variables.size >= 16) {
      issue(evaluator, call, module, "Context.set supports at most 16 static slots per route");
      return true;
    }
    variables.set(key.value, value);
    return true;
  }
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
  if (receiver.kind === "headers" && (name === "set" || name === "append")) {
    const headerName = arguments_[0];
    const headerValue = arguments_[1];
    const loweredValue = headerValue === undefined ? undefined : responseHeaderValue(headerValue);
    if (headerName?.kind === "string" && loweredValue !== undefined) {
      const key = headerName.value.toLowerCase();
      const existing = name === "append" ? receiver.entries.get(key) : undefined;
      receiver.entries.set(key, {
        name: headerName.value,
        value: existing === undefined
          ? loweredValue
          : appendResponseHeaderValue(existing.value, loweredValue),
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

function appendResponseHeaderValue(
  current: ResponseHeaderValue,
  appended: ResponseHeaderValue,
): ResponseHeaderValue {
  if (typeof current === "string" && typeof appended === "string") {
    return `${current}, ${appended}`;
  }
  return [
    ...(typeof current === "string" ? [{kind: "literal" as const, value: current}] : current),
    {kind: "literal", value: ", "},
    ...(typeof appended === "string" ? [{kind: "literal" as const, value: appended}] : appended),
  ];
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

function findInstanceGetter(
  evaluator: Evaluator,
  name: string,
  instance: Value & {kind: "instance"},
): {module: SourceModule; declaration: ts.GetAccessorDeclaration} | undefined {
  let current: ResolvedRuntimeClass | undefined = evaluator.instanceClasses.get(instance) ?? evaluator.root;
  while (current !== undefined) {
    const getter = current.declaration.members.find(member =>
      ts.isGetAccessorDeclaration(member) && memberName(member.name) === name
    );
    if (getter !== undefined && ts.isGetAccessorDeclaration(getter)) {
      return {module: current.module, declaration: getter};
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
  if (ts.isIdentifier(call.expression) && call.questionDotToken !== undefined) {
    const callable = evaluate(evaluator, call.expression, module, environment, instance);
    if (callable.kind === "undefined" || callable.kind === "null") {
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
    if (callable.kind === "reference" && isPinnedCreateOpenAiCompatible(callable)) {
      return evaluatePinnedCreateOpenAiCompatible(arguments_);
    }
    if (callable.kind === "reference" && isPinnedStreamText(callable)) {
      return evaluatePinnedStreamText(evaluator, arguments_, instance);
    }
    if (callable.kind === "reference" && isPinnedGenerateText(callable)) {
      const providerResult = evaluatePinnedProviderGenerateText(arguments_);
      if (providerResult !== undefined) return providerResult;
    }
    if (callable.kind === "reference" && isPinnedGetCookie(callable)) {
      const context = arguments_[0];
      const name = arguments_[1];
      const prefix = arguments_[2];
      const finalName = name?.kind !== "string"
        ? undefined
        : prefix?.kind === "string" && prefix.value === "secure"
          ? `__Secure-${name.value}`
          : prefix?.kind === "string" && prefix.value === "host"
            ? `__Host-${name.value}`
            : prefix === undefined || prefix.kind === "undefined"
              ? name.value
              : undefined;
      return (arguments_.length === 2 || arguments_.length === 3)
        && context?.kind === "instance"
        && finalName !== undefined
        && Buffer.byteLength(finalName, "utf8") <= 128
        && /^[\w!#$%&'*.^`|~+-]+$/.test(finalName)
        ? {kind: "requestCookie", name: finalName}
        : unknown("getCookie requires a context, one closed valid cookie name, and an optional closed prefix");
    }
    if (callable.kind === "openAiProvider") {
      const model = arguments_[0];
      return arguments_.length === 1 && model?.kind === "string"
        ? {
          kind: "openAiModel",
          baseUrl: callable.baseUrl,
          authorization: callable.authorization,
          model: model.value,
        }
        : unknown("OpenAI-compatible provider requires one closed model id");
    }
    if (callable.kind === "closure") {
      return invokeClosure(evaluator, callable, arguments_, instance);
    }
    if (callable.kind === "reference" && callable.name === "String") {
      const argument = arguments_[0] ?? UNDEFINED;
      return argument.kind === "unknown"
        ? unknown("String argument is not closed")
        : {kind: "string", value: stringValue(argument)};
    }
    if (callable.kind === "reference" && callable.name === "encodeURIComponent") {
      const input = arguments_[0];
      if (arguments_.length !== 1 || input?.kind !== "string") {
        return unknown("encodeURIComponent requires one closed string");
      }
      try {
        const value = encodeURIComponent(input.value);
        return Buffer.byteLength(value, "utf8") <= 65_536
          ? {kind: "string", value}
          : unknown("encodeURIComponent result exceeds 65536 bytes");
      } catch {
        return {kind: "thrown", value: {kind: "error", name: "URIError", message: "URI malformed"}};
      }
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
    if (callable.kind === "reference" && isEnvironmentBuiltin(callable)) {
      const name = arguments_[0];
      const operation = environmentBuiltinOperation(callable);
      return arguments_.length === 1
        && name?.kind === "string"
        && (operation === "get" || operation === "require")
        ? {kind: "environmentVariable", name: name.value, required: operation === "require"}
        : unknown("environment access requires one closed name string");
    }
    if (callable.kind === "reference" && isFilesystemBuiltin(callable)) {
      const file = arguments_[0];
      const options = arguments_[1];
      const maxBytes = options === undefined
        ? 1_048_576
        : options.kind === "record" && options.fields.size === 0
          ? 1_048_576
          : options.kind === "record" && options.fields.size === 1
            ? options.fields.get("maxBytes")
          : undefined;
      return arguments_.length >= 1
        && arguments_.length <= 2
        && file?.kind === "string"
        && (typeof maxBytes === "number"
          || maxBytes?.kind === "number" && Number.isSafeInteger(maxBytes.value))
        ? {
          kind: "fileText",
          path: file.value,
          maxBytes: typeof maxBytes === "number" ? maxBytes : maxBytes.value,
        }
        : unknown("filesystem read requires a closed path and maxBytes");
    }
    if (callable.kind === "reference" && isActorSpawnBuiltin(callable)) {
      const behavior = arguments_[0];
      const initialState = arguments_[1];
      const options = arguments_[2];
      const optionFields = options === undefined
        ? new Map<string, Value>()
        : options.kind === "record"
          ? options.fields
          : undefined;
      const mailbox = options === undefined
        ? 64
        : optionFields?.size === 0
          ? 64
          : optionFields?.get("mailboxCapacity") ?? 64;
      const mailboxCapacity = typeof mailbox === "number"
        ? mailbox
        : mailbox?.kind === "number"
          ? mailbox.value
          : undefined;
      const persistenceValue = optionFields?.get("persistence");
      const persistenceDatabase = persistenceValue?.kind === "record"
        ? persistenceValue.fields.get("database")
        : undefined;
      const persistenceKey = persistenceValue?.kind === "record"
        ? persistenceValue.fields.get("key")
        : undefined;
      const persistence = persistenceValue === undefined
        ? undefined
        : persistenceDatabase?.kind === "database"
          && persistenceKey?.kind === "string"
          && persistenceKey.value.length > 0
          && Buffer.byteLength(persistenceKey.value, "utf8") <= 128
          ? {database: persistenceDatabase.state, key: persistenceKey.value}
          : null;
      const restartValue = optionFields?.get("restart");
      const restartMax = restartValue?.kind === "record"
        ? restartValue.fields.get("maxRestarts")
        : undefined;
      const restartWithin = restartValue?.kind === "record"
        ? restartValue.fields.get("withinMs")
        : undefined;
      const restart = restartValue === undefined
        ? undefined
        : restartValue.kind === "record"
          && restartValue.fields.size === 2
          && restartMax?.kind === "number"
          && Number.isSafeInteger(restartMax.value)
          && restartMax.value >= 1
          && restartMax.value <= 16
          && restartWithin?.kind === "number"
          && Number.isSafeInteger(restartWithin.value)
          && restartWithin.value >= 1
          && restartWithin.value <= 60_000
          ? {maxRestarts: restartMax.value, withinMs: restartWithin.value}
          : null;
      const counter = behavior?.kind === "closure"
        && initialState?.kind === "number"
        && Number.isSafeInteger(initialState.value)
        && isCounterActorBehavior(behavior);
      const failureMessage = behavior?.kind === "closure"
        && initialState?.kind === "number"
        && Number.isSafeInteger(initialState.value)
        ? fallibleCounterMessage(behavior)
        : undefined;
      const initialJson = behavior?.kind === "closure" && isJsonMailboxActorBehavior(behavior)
        ? boundedActorJson(initialState)
        : undefined;
      if (
        arguments_.length < 2
        || arguments_.length > 3
        || behavior?.kind !== "closure"
        || mailboxCapacity === undefined
        || !Number.isSafeInteger(mailboxCapacity)
        || mailboxCapacity < 1
        || mailboxCapacity > 64
        || optionFields === undefined
        || [...optionFields.keys()].some(name => name !== "mailboxCapacity" && name !== "persistence" && name !== "restart")
        || persistence === null
        || restart === null
        || (!counter && failureMessage === undefined && initialJson === undefined)
        || (initialJson !== undefined && persistence !== undefined)
        || (failureMessage === undefined) !== (restart === undefined)
        || (failureMessage !== undefined && persistence !== undefined)
      ) {
        return unknown("actor spawn requires a bounded counter or JSON-mailbox behavior and mailbox capacity up to 64");
      }
      const key = `${module.path}:${call.getStart(module.sourceFile)}`;
      let state = evaluator.actors.get(key);
      if (state === undefined) {
        state = {
          id: evaluator.actors.size,
          key,
          operation: failureMessage !== undefined
            ? "fallibleCounter"
            : counter ? "counter" : "jsonMailbox",
          initialState: counter || failureMessage !== undefined
            ? initialState?.kind === "number" ? initialState.value : 0
            : 0,
          ...(initialJson === undefined ? {} : {initialJson}),
          mailboxCapacity,
          ...(failureMessage === undefined ? {} : {failureMessage}),
          ...(restart === undefined ? {} : {restart}),
          ...(persistence === undefined ? {} : {persistence}),
        };
        evaluator.actors.set(key, state);
      }
      return {kind: "actor", state};
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
    if (receiver.kind === "database" && name === "exec") {
      const sql = arguments_[0];
      if (arguments_.length !== 1 || sql?.kind !== "string" || Buffer.byteLength(sql.value, "utf8") > 65_536) {
        return unknown("Database.exec requires one closed SQL string up to 65536 bytes");
      }
      appendDatabaseAction(evaluator, instance, {
        kind: "exec",
        database: receiver.state,
        sql: sql.value,
      });
      return UNDEFINED;
    }
    if (receiver.kind === "database" && name === "transaction") {
      const transaction = arguments_[0];
      if (arguments_.length !== 1 || transaction === undefined) {
        return unknown("Database.transaction requires one closed SQL string or bounded async callback");
      }
      if (transaction.kind === "closure") {
        const actions = evaluator.databaseActions.get(instance) ?? [];
        evaluator.databaseActions.set(instance, actions);
        const start = actions.length;
        const result = invokeClosure(evaluator, transaction, [], instance);
        const callbackActions = actions.splice(start);
        evaluator.databaseActions.set(instance, actions);
        const steps = callbackActions.flatMap(action =>
          action.kind === "exec"
          && action.database === receiver.state
          && action.sql !== undefined
          && action.result !== undefined
            ? [{sql: action.sql, parameters: action.parameters ?? []}]
            : []
        );
        const sqlBytes = steps.reduce((total, step) => total + Buffer.byteLength(step.sql, "utf8"), 0);
        const parameterCount = steps.reduce((total, step) => total + step.parameters.length, 0);
        if (
          result.kind !== "undefined"
          || callbackActions.length === 0
          || callbackActions.length > 16
          || steps.length !== callbackActions.length
          || sqlBytes > 65_536
          || parameterCount > 64
        ) {
          return unknown(
            "Database.transaction callback requires 1-16 same-database Statement.run calls within 65536 SQL bytes and 64 parameters",
          );
        }
        appendDatabaseAction(evaluator, instance, {
          kind: "transactionSteps",
          database: receiver.state,
          steps,
        });
        return UNDEFINED;
      }
      if (transaction.kind !== "string" || Buffer.byteLength(transaction.value, "utf8") > 65_536) {
        return unknown("Database.transaction requires one closed SQL string or bounded async callback");
      }
      appendDatabaseAction(evaluator, instance, {
        kind: "transaction",
        database: receiver.state,
        sql: transaction.value,
      });
      return UNDEFINED;
    }
    if (receiver.kind === "database" && name === "prepare") {
      const sql = arguments_[0];
      return arguments_.length === 1
        && sql?.kind === "string"
        && Buffer.byteLength(sql.value, "utf8") <= 65_536
        ? {kind: "statement", state: {database: receiver.state, sql: sql.value}}
        : unknown("Database.prepare requires one closed SQL string up to 65536 bytes");
    }
    if (receiver.kind === "database" && (name === "close" || name === "dispose")) {
      if (arguments_.length !== 0) return unknown(`Database.${name} does not accept arguments`);
      appendDatabaseAction(evaluator, instance, {kind: "close", database: receiver.state});
      return UNDEFINED;
    }
    if (receiver.kind === "statement" && (name === "all" || name === "get")) {
      const parameters = sqliteParameters(arguments_);
      return parameters !== undefined
        ? {
          kind: "sqliteQuery",
          statement: receiver.state,
          mode: name === "all" ? "all" : "first",
          parameters,
        }
        : unknown(`Statement.${name} accepts up to 16 route or JSON-field values`);
    }
    if (receiver.kind === "statement" && name === "run") {
      const parameters = sqliteParameters(arguments_);
      if (parameters === undefined) return unknown("Statement.run accepts up to 16 route or JSON-field values");
      const action: EvaluatedDatabaseAction = {
        kind: "exec",
        database: receiver.state.database,
        sql: receiver.state.sql,
        ...(parameters.length === 0 ? {} : {parameters}),
      };
      const result = appendDatabaseAction(evaluator, instance, action);
      action.result = result;
      return {
        kind: "record",
        fields: new Map([
          ["changes", {kind: "sqliteRunChanges", result}],
          ["lastInsertRowId", {kind: "sqliteRunLastInsertRowId", result}],
        ]),
      };
    }
    if (receiver.kind === "statement" && (name === "close" || name === "dispose")) {
      return arguments_.length === 0
        ? UNDEFINED
        : unknown(`Statement.${name} does not accept arguments`);
    }
    if (receiver.kind === "actor" && name === "ask") {
      const message = arguments_[0];
      const timeoutMs = actorAskTimeout(arguments_[1]);
      if (arguments_.length < 1 || arguments_.length > 2 || message === undefined || timeoutMs === undefined) {
        return unknown("ActorRef.ask requires one closed message and optional bounded timeoutMs");
      }
      if (receiver.state.operation !== "jsonMailbox") {
        return message.kind === "number" && Number.isSafeInteger(message.value)
          ? {
            kind: "actorCall",
            actor: receiver.state,
            message: message.value,
            ...(timeoutMs === 0 ? {} : {timeoutMs}),
          }
          : unknown("CounterActorRef.ask requires one closed integer message");
      }
      const json = boundedActorJson(message);
      if (json === undefined) return unknown("ValueActorRef.ask requires one bounded closed JSON message");
      markValueEscape(evaluator.memory, message, "message");
      return {
        kind: "actorCall",
        actor: receiver.state,
        message: json,
        ...(timeoutMs === 0 ? {} : {timeoutMs}),
      };
    }
    if (receiver.kind === "actor" && name === "tell") {
      const message = arguments_[0];
      if (arguments_.length !== 1 || message === undefined) {
        return unknown("ActorRef.tell requires one closed message");
      }
      const lowered = receiver.state.operation !== "jsonMailbox"
        ? message.kind === "number" && Number.isSafeInteger(message.value) ? message.value : undefined
        : boundedActorJson(message);
      if (lowered === undefined) {
        return unknown(receiver.state.operation !== "jsonMailbox"
          ? "CounterActorRef.tell requires one closed integer message"
          : "ValueActorRef.tell requires one bounded closed JSON message");
      }
      if (receiver.state.operation === "jsonMailbox") markValueEscape(evaluator.memory, message, "message");
      appendActorAction(evaluator, instance, {
        kind: "tell",
        actor: receiver.state,
        message: lowered,
      });
      return UNDEFINED;
    }
    if (receiver.kind === "actor" && (name === "stop" || name === "dispose")) {
      if (arguments_.length !== 0) return unknown(`ActorRef.${name} does not accept arguments`);
      appendActorAction(evaluator, instance, {kind: "stop", actor: receiver.state});
      return UNDEFINED;
    }
    if (
      receiver.kind === "instance"
      && (name === "getOpenAPIDocument" || name === "getOpenAPI31Document")
    ) {
      const document = evaluateOpenApiDocument(receiver, arguments_[0]);
      if (document !== undefined) return document;
    }
    if (receiver.kind === "reference" && receiver.name === "Date" && name === "now") {
      return arguments_.length === 0
        ? {kind: "clockNow"}
        : unknown("Date.now arguments are not supported");
    }
    if (receiver.kind === "reference" && receiver.name === "Math" && name === "random") {
      return arguments_.length === 0
        ? {kind: "number", value: 0}
        : unknown("Math.random arguments are not supported");
    }
    if (receiver.kind === "reference" && receiver.name === "crypto" && name === "randomUUID") {
      return arguments_.length === 0
        ? {kind: "randomUuid"}
        : unknown("crypto.randomUUID arguments are not supported");
    }
    if (receiver.kind === "reference" && receiver.name === "Number" && name === "isInteger") {
      const value = arguments_[0];
      return {kind: "boolean", value: value?.kind === "number" && Number.isInteger(value.value)};
    }
    if (receiver.kind === "reference" && receiver.name === "Array" && name === "isArray") {
      return {kind: "boolean", value: arguments_[0]?.kind === "array"};
    }
    if (receiver.kind === "reference" && receiver.name === "Promise" && name === "all") {
      const values = arguments_[0];
      return values?.kind === "array"
        ? values
        : unknown("Promise.all input is not a closed array");
    }
    if (receiver.kind === "reference" && receiver.name === "Symbol" && name === "for") {
      const key = arguments_[0];
      return key?.kind === "string"
        ? {kind: "string", value: `@@symbol.for:${key.value}`}
        : unknown("Symbol.for key is not a closed string");
    }
    if (
      receiver.kind === "reference"
      && receiver.name === "z"
      && [
        "array",
        "bigint",
        "boolean",
        "coerce",
        "date",
        "enum",
        "literal",
        "null",
        "number",
        "object",
        "record",
        "string",
        "undefined",
        "union",
        "unknown",
      ].includes(name)
    ) {
      const first = arguments_[0];
      return {
        kind: "schema",
        schemaType: name,
        ...(name === "object" && first?.kind === "record" ? {fields: first.fields} : {}),
        ...(name === "array" && first?.kind === "schema" ? {item: first} : {}),
      };
    }
    if (receiver.kind === "reference" && receiver.name === "z4" && name === "safeParseAsync") {
      return {
        kind: "record",
        fields: new Map([
          ["success", {kind: "boolean", value: true}],
          ["data", arguments_[1] ?? UNDEFINED],
        ]),
      };
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
    if (receiver.kind === "streamWriter" && name === "enqueue") {
      const input = arguments_[0];
      if (input === undefined) return unknown("stream controller enqueue requires one value");
      (receiver.state.values ??= []).push(input);
      return UNDEFINED;
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
    if (receiver.kind === "record" && name === "toTextStreamResponse") {
      const response = receiver.fields.get("#textStreamResponse");
      if (response?.kind !== "response") {
        return unknown("streamText result has no closed text response");
      }
      const source = receiver.fields.get("#sourceStream");
      if (source !== undefined) markValueEscape(evaluator.memory, source, "response");
      return response;
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
    if (receiver.kind === "request" && name === "json") {
      return arguments_.length === 0
        ? {kind: "requestJson"}
        : unknown("request.json does not accept arguments");
    }
    if (receiver.kind === "request" && name === "valid") {
      const target = arguments_[0];
      if (target?.kind !== "string") {
        return unknown("request validation target is not a closed string");
      }
      if (target.value === "param") {
        return {
          kind: "record",
          fields: new Map(routeParameterNames(receiver.routePattern).map(parameter => [
            parameter,
            {kind: "routeParameter", name: parameter},
          ])),
        };
      }
      return unknown(`validated request target ${target.value} is not lowerable`);
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
      markValueEscape(evaluator.memory, input, "message");
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
    if (receiver.kind === "reference" && receiver.name === "Object" && name === "keys") {
      const value = arguments_[0];
      return value?.kind === "record" || value?.kind === "instance"
        ? {
          kind: "array",
          items: [...value.fields.keys()].map(key => ({kind: "string", value: key})),
        }
        : unknown("Object.keys argument is not a closed object");
    }
    if (receiver.kind === "reference" && receiver.name === "Object" && name === "defineProperty") {
      const target = arguments_[0];
      const key = arguments_[1];
      const descriptor = arguments_[2];
      if (
        (target?.kind !== "record" && target?.kind !== "instance")
        || key?.kind !== "string"
        || descriptor?.kind !== "record"
      ) {
        return unknown("Object.defineProperty arguments are not closed");
      }
      const value = descriptor.fields.get("value");
      if (value !== undefined) target.fields.set(key.value, value);
      return target;
    }
    if (receiver.kind === "reference" && receiver.name === "Object" && name === "values") {
      const value = arguments_[0];
      return value?.kind === "record"
        ? {kind: "array", items: [...value.fields.values()]}
        : unknown("Object.values argument is not a closed record");
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
      if (serialized !== undefined) return {kind: "string", value: serialized};
      if (space !== undefined && space.kind !== "undefined") return UNDEFINED;
      const parts = stringifyRuntimeJson(value);
      return parts === undefined ? UNDEFINED : {kind: "runtimeString", parts};
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
    if (
      receiver.kind === "instance"
      && name === "get"
      && isHonoContextInstance(evaluator, receiver)
    ) {
      const key = arguments_[0];
      if (arguments_.length !== 1 || key?.kind !== "string") {
        return unknown("Context.get requires one static string key");
      }
      if (key.value.length === 0 || Buffer.byteLength(key.value, "utf8") > 128) {
        return unknown("Context.get key must be a non-empty UTF-8 string of at most 128 bytes");
      }
      if (key.value === "requestId") {
        return {kind: "requestId", headerName: "X-Request-Id"};
      }
      return contextVariables(receiver).get(key.value) ?? UNDEFINED;
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
    if (receiver.kind === "schema") {
      if (name === "safeParseAsync" || name === "safeParse") {
        return {
          kind: "record",
          fields: new Map([
            ["success", {kind: "boolean", value: true}],
            ["data", arguments_[0] ?? UNDEFINED],
          ]),
        };
      }
      if (name === "parseAsync" || name === "parse") return arguments_[0] ?? UNDEFINED;
      if (name === "array") return {...receiver, schemaType: "array", item: receiver};
      if (name === "openapi") {
        const first = arguments_[0];
        const second = arguments_[1];
        return {
          ...receiver,
          ...(first?.kind === "string" ? {refId: first.value} : {}),
          ...(first?.kind === "record" ? {metadata: first} : {}),
          ...(second?.kind === "record" ? {metadata: second} : {}),
        };
      }
      if (name === "min") {
        const minimum = arguments_[0];
        return minimum?.kind === "number"
          ? {
            ...receiver,
            ...(receiver.schemaType === "string"
              ? {minLength: minimum.value}
              : {minimum: minimum.value}),
          }
          : unknown("Zod min constraint is not a closed number");
      }
      if (name === "length") {
        const length = arguments_[0];
        return length?.kind === "number" && receiver.schemaType === "string"
          ? {...receiver, minLength: length.value}
          : receiver;
      }
      if (name === "optional") return {...receiver, optional: true};
      if ([
        "default",
        "describe",
        "int",
        "max",
        "nullable",
        "nullish",
        "positive",
        "nonnegative",
      ].includes(name)) {
        return {...receiver};
      }
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
    if (receiver.kind === "array" && name === "flatMap") {
      const callback = arguments_[0];
      if (callback?.kind !== "closure") {
        return unknown("Array.flatMap callback is not a compile-time closure");
      }
      const items: Value[] = [];
      for (const [index, value] of receiver.items.entries()) {
        const mapped = invokeClosure(
          evaluator,
          callback,
          [value, {kind: "number", value: index}, receiver],
          instance,
        );
        if (mapped.kind === "array") items.push(...mapped.items);
        else items.push(mapped);
      }
      return {kind: "array", items};
    }
    if (receiver.kind === "array" && name === "flat") {
      const depth = arguments_[0];
      if (depth !== undefined && depth.kind !== "number") {
        return unknown("Array.flat depth is not a closed number");
      }
      let items = [...receiver.items];
      for (let level = 0; level < (depth?.kind === "number" ? depth.value : 1); level++) {
        items = items.flatMap(item => item.kind === "array" ? item.items : [item]);
      }
      return {kind: "array", items};
    }
    if (receiver.kind === "array" && name === "includes") {
      const searched = arguments_[0] ?? UNDEFINED;
      return {kind: "boolean", value: receiver.items.some(item => valuesEqual(item, searched))};
    }
    if (receiver.kind === "array" && name === "at") {
      const index = arguments_[0];
      return index?.kind === "number"
        ? receiver.items.at(index.value) ?? UNDEFINED
        : unknown("Array.at index is not a closed number");
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
      if (name === "charAt") {
        const index = arguments_[0];
        return index?.kind === "number"
          ? {kind: "string", value: receiver.value.charAt(index.value)}
          : unknown("String.charAt index is not a number");
      }
      if (name === "replace" || name === "replaceAll") {
        const searched = arguments_[0];
        const replacement = arguments_[1];
        if (replacement?.kind !== "string") {
          return unknown(`String.${name} replacement is not a closed string`);
        }
        if (searched?.kind === "string") {
          return {
            kind: "string",
            value: name === "replaceAll"
              ? receiver.value.replaceAll(searched.value, replacement.value)
              : receiver.value.replace(searched.value, replacement.value),
          };
        }
        if (searched?.kind === "regexp") {
          const expression = new RegExp(searched.source, searched.flags);
          return {
            kind: "string",
            value: name === "replaceAll"
              ? receiver.value.replaceAll(expression, replacement.value)
              : receiver.value.replace(expression, replacement.value),
          };
        }
        return unknown(`String.${name} search value is not closed`);
      }
      if (name === "includes") {
        const searched = arguments_[0];
        return searched?.kind === "string"
          ? {kind: "boolean", value: receiver.value.includes(searched.value)}
          : unknown("String.includes search value is not a closed string");
      }
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

function actorAskTimeout(options: Value | undefined): number | undefined {
  if (options === undefined) return 0;
  if (options.kind !== "record" || options.fields.size !== 1) return undefined;
  const timeout = options.fields.get("timeoutMs");
  return timeout?.kind === "number"
    && Number.isSafeInteger(timeout.value)
    && timeout.value >= 1
    && timeout.value <= 60_000
    ? timeout.value
    : undefined;
}

function isEnvironmentBuiltin(value: Value & {kind: "reference"}): boolean {
  return environmentBuiltinOperation(value) !== undefined
    && value.callable?.module.path.replaceAll("\\", "/").endsWith("/sdk/builtins/env.ts") === true;
}

function isFilesystemBuiltin(value: Value & {kind: "reference"}): boolean {
  const declaration = value.callable?.declaration;
  return declaration !== undefined
    && ts.isFunctionDeclaration(declaration)
    && declaration.name?.text === "readTextFile"
    && value.callable?.module.path.replaceAll("\\", "/").endsWith("/sdk/builtins/fs.ts") === true;
}

function isActorSpawnBuiltin(value: Value & {kind: "reference"}): boolean {
  const declaration = value.callable?.declaration;
  return declaration !== undefined
    && ts.isFunctionDeclaration(declaration)
    && declaration.name?.text === "spawn"
    && value.callable?.module.path.replaceAll("\\", "/").endsWith("/sdk/builtins/actors.ts") === true;
}

function isSqliteDatabaseBuiltin(value: ResolvedRuntimeClass): boolean {
  return value.declaration.name?.text === "Database"
    && value.module.path.replaceAll("\\", "/").endsWith("/sdk/builtins/sqlite.ts");
}

function isCounterActorBehavior(value: Value & {kind: "closure"}): boolean {
  const expression = value.expression;
  const body = expression.body;
  if (expression.parameters.length !== 2 || body === undefined || !ts.isBlock(body)) return false;
  const context = expression.parameters[0]?.name;
  const message = expression.parameters[1]?.name;
  if (!context || !message || !ts.isIdentifier(context) || !ts.isIdentifier(message)) return false;
  return isCounterActorStatements(body.statements, context.text, message.text);
}

function fallibleCounterMessage(value: Value & {kind: "closure"}): number | undefined {
  const expression = value.expression;
  const body = expression.body;
  if (expression.parameters.length !== 2 || body === undefined || !ts.isBlock(body)) return undefined;
  const context = expression.parameters[0]?.name;
  const message = expression.parameters[1]?.name;
  if (!context || !message || !ts.isIdentifier(context) || !ts.isIdentifier(message)) return undefined;
  const [failure, ...counter] = body.statements;
  if (
    failure === undefined
    || !ts.isIfStatement(failure)
    || failure.elseStatement !== undefined
    || !ts.isBinaryExpression(failure.expression)
    || failure.expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    || !ts.isIdentifier(failure.expression.left)
    || failure.expression.left.text !== message.text
    || !ts.isThrowStatement(failure.thenStatement)
    || failure.thenStatement.expression === undefined
    || !ts.isCallExpression(failure.thenStatement.expression)
    || !ts.isIdentifier(failure.thenStatement.expression.expression)
    || failure.thenStatement.expression.expression.text !== "Error"
    || failure.thenStatement.expression.arguments.length !== 1
    || !ts.isStringLiteral(failure.thenStatement.expression.arguments[0]!)
    || !isCounterActorStatements(counter, context.text, message.text)
  ) return undefined;
  return closedIntegerLiteral(failure.expression.right);
}

function isCounterActorStatements(
  statements: readonly ts.Statement[],
  context: string,
  message: string,
): boolean {
  const [update, returned] = statements;
  if (
    statements.length !== 2
    || update === undefined
    || !ts.isExpressionStatement(update)
    || !ts.isBinaryExpression(update.expression)
    || update.expression.operatorToken.kind !== ts.SyntaxKind.PlusEqualsToken
    || !isActorStateAccess(update.expression.left, context)
    || !ts.isIdentifier(update.expression.right)
    || update.expression.right.text !== message
    || returned === undefined
    || !ts.isReturnStatement(returned)
    || returned.expression === undefined
  ) return false;
  const result = returned.expression;
  return ts.isCallExpression(result)
    && ts.isIdentifier(result.expression)
    && result.expression.text === "String"
    && result.arguments.length === 1
    && isActorStateAccess(result.arguments[0]!, context);
}

function closedIntegerLiteral(expression: ts.Expression): number | undefined {
  const value = ts.isNumericLiteral(expression)
    ? Number(expression.text)
    : ts.isPrefixUnaryExpression(expression)
      && expression.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(expression.operand)
      ? -Number(expression.operand.text)
      : undefined;
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function isJsonMailboxActorBehavior(value: Value & {kind: "closure"}): boolean {
  const expression = value.expression;
  const body = expression.body;
  if (expression.parameters.length !== 2 || body === undefined || !ts.isBlock(body)) return false;
  const context = expression.parameters[0]?.name;
  const message = expression.parameters[1]?.name;
  if (!context || !message || !ts.isIdentifier(context) || !ts.isIdentifier(message)) return false;
  const [assignment, returned] = body.statements;
  if (
    body.statements.length !== 2
    || assignment === undefined
    || !ts.isExpressionStatement(assignment)
    || !ts.isBinaryExpression(assignment.expression)
    || assignment.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    || !isActorStateAccess(assignment.expression.left, context.text)
    || !ts.isIdentifier(assignment.expression.right)
    || assignment.expression.right.text !== message.text
    || returned === undefined
    || !ts.isReturnStatement(returned)
    || returned.expression === undefined
  ) return false;
  const result = returned.expression;
  return ts.isCallExpression(result)
    && ts.isPropertyAccessExpression(result.expression)
    && ts.isIdentifier(result.expression.expression)
    && result.expression.expression.text === "JSON"
    && result.expression.name.text === "stringify"
    && result.arguments.length === 1
    && isActorStateAccess(result.arguments[0]!, context.text);
}

function boundedActorJson(value: Value | undefined, depth = 0): string | undefined {
  if (value === undefined || depth > 8) return undefined;
  if (value.kind === "array") {
    if (value.items.length > 64 || value.items.some(item => boundedActorJsonShape(item, depth + 1) === false)) {
      return undefined;
    }
  } else if (value.kind === "record") {
    if (value.fields.size > 32 || [...value.fields].some(([name, field]) =>
      Buffer.byteLength(name, "utf8") > 128 || !boundedActorJsonShape(field, depth + 1)
    )) return undefined;
  } else if (!boundedActorJsonShape(value, depth)) {
    return undefined;
  }
  const json = stringifyJson(value);
  return json !== undefined && Buffer.byteLength(json, "utf8") <= 4_096 ? json : undefined;
}

function boundedActorJsonShape(value: Value, depth: number): boolean {
  if (depth > 8) return false;
  if (value.kind === "array") {
    return value.items.length <= 64 && value.items.every(item => boundedActorJsonShape(item, depth + 1));
  }
  if (value.kind === "record") {
    return value.fields.size <= 32 && [...value.fields].every(([name, field]) =>
      Buffer.byteLength(name, "utf8") <= 128 && boundedActorJsonShape(field, depth + 1)
    );
  }
  return value.kind === "null"
    || value.kind === "boolean"
    || value.kind === "string" && Buffer.byteLength(value.value, "utf8") <= 1_024
    || value.kind === "number" && Number.isFinite(value.value) && Number.isSafeInteger(value.value);
}

function isActorStateAccess(expression: ts.Expression, context: string): boolean {
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === context
    && expression.name.text === "state";
}

function appendActorAction(
  evaluator: Evaluator,
  instance: Value & {kind: "instance"},
  action: EvaluatedActorAction,
): void {
  const actions = evaluator.actorActions.get(instance) ?? [];
  actions.push(action);
  evaluator.actorActions.set(instance, actions);
}

function appendDatabaseAction(
  evaluator: Evaluator,
  instance: Value & {kind: "instance"},
  action: EvaluatedDatabaseAction,
): number {
  const actions = evaluator.databaseActions.get(instance) ?? [];
  const result = actions.length;
  actions.push(action);
  evaluator.databaseActions.set(instance, actions);
  return result;
}

function sqliteParameters(arguments_: Value[]): SqliteParameter[] | undefined {
  if (arguments_.length === 0) return [];
  const parameters = arguments_[0];
  if (arguments_.length !== 1 || parameters?.kind !== "array" || parameters.items.length > 16) {
    return undefined;
  }
  const output: SqliteParameter[] = [];
  for (const parameter of parameters.items) {
    if (parameter.kind === "routeParameter") {
      output.push({kind: "routeParameter", name: parameter.name});
    } else if (parameter.kind === "requestJsonField") {
      output.push({kind: "requestJsonField", name: parameter.name});
    } else if (parameter.kind === "randomUuid") {
      output.push({kind: "randomUuid"});
    } else if (parameter.kind === "string" && Buffer.byteLength(parameter.value, "utf8") <= 65_536) {
      output.push({kind: "staticString", value: parameter.value});
    } else if (parameter.kind === "number" && Number.isSafeInteger(parameter.value)) {
      output.push({kind: "staticInteger", value: parameter.value});
    } else if (parameter.kind === "number" && Number.isFinite(parameter.value)) {
      output.push({kind: "staticReal", value: parameter.value});
    } else if (parameter.kind === "boolean") {
      output.push({kind: "staticBoolean", value: parameter.value});
    } else if (parameter.kind === "null") {
      output.push({kind: "null"});
    } else {
      return undefined;
    }
  }
  return output;
}

function sameSqliteParameters(left: SqliteParameter[], right: SqliteParameter[]): boolean {
  return left.length === right.length && left.every((parameter, index) => {
    const candidate = right[index];
    if (candidate?.kind !== parameter.kind) return false;
    switch (parameter.kind) {
      case "randomUuid":
      case "null":
        return true;
      case "routeParameter":
      case "requestJsonField":
        return candidate.kind === parameter.kind && candidate.name === parameter.name;
      case "staticString":
      case "staticInteger":
      case "staticReal":
      case "staticBoolean":
        return candidate.kind === parameter.kind && candidate.value === parameter.value;
    }
  });
}

function environmentBuiltinOperation(
  value: Value & {kind: "reference"},
): "get" | "require" | undefined {
  const declaration = value.callable?.declaration;
  if (declaration === undefined || !ts.isFunctionDeclaration(declaration)) return undefined;
  const name = declaration.name?.text;
  return name === "get" || name === "require" ? name : undefined;
}

function isPinnedCreateOpenAiCompatible(value: Value & {kind: "reference"}): boolean {
  return value.name === "createOpenAICompatible"
    && value.callable?.module.path.replaceAll("\\", "/")
      .endsWith("/packages/openai-compatible/src/openai-compatible-provider.ts") === true;
}

function evaluatePinnedCreateOpenAiCompatible(arguments_: Value[]): Value {
  const options = arguments_[0];
  if (arguments_.length !== 1 || options?.kind !== "record") {
    return unknown("OpenAI-compatible provider requires one closed options record");
  }
  if ([...options.fields.keys()].some(name => !["name", "baseURL", "apiKey"].includes(name))) {
    return unknown("OpenAI-compatible provider options are outside the native transport slice");
  }
  const name = options.fields.get("name");
  const baseUrl = options.fields.get("baseURL");
  const apiKey = options.fields.get("apiKey");
  if (name?.kind !== "string" || baseUrl?.kind !== "string" || apiKey?.kind !== "string") {
    return unknown("OpenAI-compatible provider name, baseURL, and apiKey must be closed strings");
  }
  return {
    kind: "openAiProvider",
    baseUrl: baseUrl.value.replace(/\/$/, ""),
    authorization: `Bearer ${apiKey.value}`,
  };
}

function isPinnedGenerateText(value: Value & {kind: "reference"}): boolean {
  return value.name === "generateText"
    && value.callable?.module.path.replaceAll("\\", "/")
      .endsWith("/packages/ai/src/generate-text/generate-text.ts") === true;
}

function evaluatePinnedProviderGenerateText(arguments_: Value[]): Value | undefined {
  const options = arguments_[0];
  if (arguments_.length !== 1 || options?.kind !== "record") return undefined;
  const model = options.fields.get("model");
  if (model?.kind !== "openAiModel") return undefined;
  if ([...options.fields.keys()].some(name => !["model", "prompt"].includes(name))) {
    return unknown("native OpenAI-compatible generateText only supports model and prompt");
  }
  const prompt = options.fields.get("prompt");
  if (prompt?.kind !== "string") {
    return unknown("native OpenAI-compatible generateText requires a closed string prompt");
  }
  const text: Value = {
    kind: "openAiChatText",
    url: `${model.baseUrl}/chat/completions`,
    authorization: model.authorization,
    body: JSON.stringify({
      model: model.model,
      messages: [{role: "user", content: prompt.value}],
    }),
  };
  return {kind: "record", fields: new Map([["text", text]])};
}

function isPinnedGetCookie(value: Value & {kind: "reference"}): boolean {
  return value.name === "getCookie"
    && value.callable?.module.path.replaceAll("\\", "/")
      .endsWith("/helper/cookie/index.ts") === true;
}

function isPinnedStreamText(value: Value & {kind: "reference"}): boolean {
  return value.name === "streamText"
    && value.callable?.module.path.replaceAll("\\", "/")
      .endsWith("/packages/ai/src/generate-text/stream-text.ts") === true;
}

function evaluatePinnedStreamText(
  evaluator: Evaluator,
  arguments_: Value[],
  instance: Value & {kind: "instance"},
): Value {
  const options = arguments_[0];
  if (arguments_.length !== 1 || options?.kind !== "record") {
    return unknown("pinned streamText tracer requires one closed options record");
  }
  if ([...options.fields.keys()].some(name => !["model", "prompt"].includes(name))) {
    return unknown("pinned streamText tracer only supports model and prompt options");
  }
  const model = options.fields.get("model");
  const prompt = options.fields.get("prompt");
  const doStream = model?.kind === "instance" ? model.fields.get("doStream") : undefined;
  if (model?.kind !== "instance" || prompt?.kind !== "string" || doStream?.kind !== "closure") {
    return unknown("pinned streamText tracer requires a closed model and string prompt");
  }
  const callOptions: Value = {
    kind: "record",
    fields: new Map([["prompt", {
      kind: "array",
      items: [{
        kind: "record",
        fields: new Map([
          ["role", {kind: "string", value: "user"}],
          ["content", {
            kind: "array",
            items: [{
              kind: "record",
              fields: new Map([
                ["type", {kind: "string", value: "text"}],
                ["text", prompt],
              ]),
            }],
          }],
          ["providerOptions", UNDEFINED],
        ]),
      }],
    }]]),
  };
  const modelResult = invokeClosure(evaluator, doStream, [callOptions], model);
  if (modelResult.kind === "thrown") return modelResult;
  const source = modelResult.kind === "record" ? modelResult.fields.get("stream") : undefined;
  if (source?.kind !== "readableStream" || source.state.closed !== true) {
    return unknown("pinned streamText model must return a closed readable stream");
  }

  const chunks: string[] = [];
  const activeTextIds = new Set<string>();
  let finished = false;
  for (const part of source.state.values ?? []) {
    if (part.kind !== "record") {
      return unknown("pinned streamText model emitted a non-record part");
    }
    const type = closedRecordString(part, "type");
    const id = closedRecordString(part, "id");
    if (type === "text-start" && id !== undefined) {
      activeTextIds.add(id);
    } else if (type === "text-delta" && id !== undefined && activeTextIds.has(id)) {
      const delta = closedRecordString(part, "delta");
      if (delta === undefined) return unknown("pinned streamText delta is not a closed string");
      if (delta.length > 0) chunks.push(delta);
    } else if (type === "text-end" && id !== undefined && activeTextIds.delete(id)) {
      // The matching text part is complete.
    } else if (type === "finish") {
      finished = true;
    } else {
      return unknown(`pinned streamText part is unsupported: ${type ?? part.kind}`);
    }
  }
  if (!finished || activeTextIds.size > 0 || chunks.length === 0 || chunks.length > 16) {
    return unknown("pinned streamText model did not produce one finite completed text stream");
  }
  return {
    kind: "record",
    fields: new Map<string, Value>([
      ["#sourceStream", source],
      ["#textStreamResponse", {
        kind: "response",
        body: {kind: "stream", chunks},
        status: 200,
        contentType: "text/plain; charset=utf-8",
        headers: new Map(),
      }],
    ]),
  };
}

function closedRecordString(value: Value & {kind: "record"}, name: string): string | undefined {
  const field = value.fields.get(name);
  return field?.kind === "string" ? field.value : undefined;
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

function numericValue(value: Value): number | undefined {
  switch (value.kind) {
    case "undefined": return Number.NaN;
    case "null": return 0;
    case "boolean": return value.value ? 1 : 0;
    case "number": return value.value;
    case "string": return Number(value.value);
    default: return undefined;
  }
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
  const value = evaluateExpression(evaluator, original, module, environment, instance);
  trackEvaluatedValue(evaluator.memory, original, module, value);
  return value;
}

function evaluateExpression(
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
    return environment.get("#this") ?? instance;
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
    const runtimeValue = resolveRuntimeValue(evaluator.modules, module, expression.text);
    if (
      runtimeValue?.declaration.initializer !== undefined
      && !ts.isArrowFunction(runtimeValue.declaration.initializer)
      && !ts.isFunctionExpression(runtimeValue.declaration.initializer)
    ) {
      const key = `${runtimeValue.module.path}\0${runtimeValue.declaration.name.getText()}`;
      const cached = evaluator.runtimeValues.get(key);
      if (cached !== undefined) return cached;
      if (!evaluator.activeRuntimeValues.has(key)) {
        evaluator.activeRuntimeValues.add(key);
        const value = evaluate(
          evaluator,
          runtimeValue.declaration.initializer,
          runtimeValue.module,
          new Map(),
          instance,
        );
        evaluator.activeRuntimeValues.delete(key);
        evaluator.runtimeValues.set(key, value);
        return value;
      }
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
          return unknown(`array spread is not closed (${spread.kind}${
            spread.kind === "unknown" ? `: ${spread.reason}` : ""
          })`);
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
        const name = evaluatedPropertyName(
          evaluator,
          property.name,
          module,
          environment,
          instance,
        );
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
      } else if (ts.isGetAccessorDeclaration(property)) {
        const name = evaluatedPropertyName(
          evaluator,
          property.name,
          module,
          environment,
          instance,
        );
        if (name === undefined) return unknown("object getter name is not closed");
        fields.set(name, UNDEFINED);
      } else if (ts.isMethodDeclaration(property)) {
        const name = evaluatedPropertyName(
          evaluator,
          property.name,
          module,
          environment,
          instance,
        );
        if (name === undefined) return unknown("object method name is not closed");
        fields.set(name, {
          kind: "closure",
          span: spanOf(property, module.sourceFile),
          expression: property,
          module,
          environment: new Map(environment),
        });
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
      ...(ts.isArrowFunction(expression) ? {lexicalThis: instance} : {}),
    };
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = evaluate(evaluator, expression.expression, module, environment, instance);
    const direct = readProperty(receiver, expression.name.text);
    if (direct.kind !== "undefined") {
      return direct;
    }
    if (receiver.kind === "instance") {
      const getter = findInstanceGetter(evaluator, expression.name.text, receiver);
      if (getter !== undefined) {
        return invokeFunctionLike(
          evaluator,
          getter.declaration,
          getter.module,
          new Map(),
          [],
          receiver,
        );
      }
    }
    return direct;
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
      if (left.kind === "string" && right.kind === "schema") {
        return {kind: "boolean", value: left.value === "~standard" || left.value === "_zod"};
      }
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
    if (operator === ts.SyntaxKind.PlusEqualsToken) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      const joined = joinRuntimeStrings([left, right]);
      const value = joined ?? (left.kind === "number" && right.kind === "number"
        ? {kind: "number" as const, value: left.value + right.value}
        : undefined);
      if (value === undefined) {
        return unknown(`addition assignment operands are not closed (${left.kind}, ${right.kind})`);
      }
      assign(evaluator, expression.left, value, module, environment, instance);
      return value;
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
      if (left.kind === "environmentVariable" && !left.required) {
        const fallback = evaluate(evaluator, expression.right, module, environment, instance);
        return fallback.kind === "string"
          ? {...left, fallback: fallback.value}
          : unknown("environment variable fallback is not a closed string");
      }
      if (left.kind === "requestCookie") {
        const fallback = evaluate(evaluator, expression.right, module, environment, instance);
        return fallback.kind === "string"
          ? {...left, fallback: fallback.value}
          : unknown("cookie fallback is not a closed string");
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
      const leftNumber = numericValue(left);
      const rightNumber = numericValue(right);
      if (leftNumber !== undefined && rightNumber !== undefined) {
        return {
          kind: "boolean",
          value: operator === ts.SyntaxKind.LessThanToken
            ? leftNumber < rightNumber
            : operator === ts.SyntaxKind.LessThanEqualsToken
              ? leftNumber <= rightNumber
              : operator === ts.SyntaxKind.GreaterThanToken
                ? leftNumber > rightNumber
                : leftNumber >= rightNumber,
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
    if (
      operator === ts.SyntaxKind.AsteriskToken
      || operator === ts.SyntaxKind.SlashToken
      || operator === ts.SyntaxKind.PercentToken
    ) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (left.kind === "number" && right.kind === "number") {
        return {
          kind: "number",
          value: operator === ts.SyntaxKind.AsteriskToken
            ? left.value * right.value
            : operator === ts.SyntaxKind.SlashToken
              ? left.value / right.value
              : left.value % right.value,
        };
      }
    }
    if (operator === ts.SyntaxKind.BarToken) {
      const right = evaluate(evaluator, expression.right, module, environment, instance);
      if (left.kind === "number" && right.kind === "number") {
        return {kind: "number", value: left.value | right.value};
      }
    }
    const right = evaluate(evaluator, expression.right, module, environment, instance);
    return unknown(`binary operator ${ts.SyntaxKind[operator]} is not closed (${left.kind}, ${right.kind})`);
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
    const sqliteClass = resolveRuntimeClass(module, expression.expression.text, evaluator.modules);
    if (sqliteClass !== undefined && isSqliteDatabaseBuiltin(sqliteClass)) {
      const arguments_ = expression.arguments ?? [];
      const databasePath = arguments_[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, arguments_[0], module, environment, instance);
      if (arguments_.length !== 1 || databasePath.kind !== "string") {
        return unknown("Database requires one static path string");
      }
      const key = `${module.path}:${expression.getStart(module.sourceFile)}`;
      let state = evaluator.databases.get(key);
      if (state === undefined) {
        state = {id: evaluator.databases.size, key, path: databasePath.value};
        evaluator.databases.set(key, state);
      }
      return {kind: "database", state};
    }
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
    if (expression.expression.text === "Array") {
      const arguments_ = expression.arguments ?? [];
      if (arguments_.length === 1) {
        const length = evaluate(evaluator, arguments_[0]!, module, environment, instance);
        return length.kind === "number" && Number.isInteger(length.value) && length.value >= 0
          ? {kind: "array", items: Array.from({length: length.value}, () => UNDEFINED)}
          : unknown("Array length is not a closed non-negative integer");
      }
      return {
        kind: "array",
        items: arguments_.map(argument => evaluate(evaluator, argument, module, environment, instance)),
      };
    }
    if (expression.expression.text === "Set") {
      const source = expression.arguments?.[0] === undefined
        ? {kind: "array", items: []} as const
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      if (source.kind !== "array") return unknown("Set initializer is not a closed array");
      const items = source.items.filter((value, index, values) =>
        values.findIndex(candidate => valuesEqual(candidate, value)) === index
      );
      return {kind: "array", items};
    }
    if (expression.expression.text === "Map") {
      return {
        kind: "record",
        fields: new Map([["size", {kind: "number", value: 0}]]),
      };
    }
    if (expression.expression.text === "Response") {
      const body = expression.arguments?.[0] === undefined
        ? UNDEFINED
        : evaluate(evaluator, expression.arguments[0], module, environment, instance);
      markValueEscape(evaluator.memory, body, "response");
      if (
        body.kind !== "string"
        && body.kind !== "html"
        && body.kind !== "runtimeString"
        && body.kind !== "runtimeHtml"
        && body.kind !== "readableStream"
        && body.kind !== "workerCall"
        && body.kind !== "openAiChatText"
        && body.kind !== "environmentVariable"
        && body.kind !== "fileText"
        && body.kind !== "actorCall"
        && body.kind !== "sqliteQuery"
        && body.kind !== "routeParameter"
        && body.kind !== "requestId"
        && body.kind !== "requestCookie"
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
        : body.kind === "workerCall" || body.kind === "openAiChatText" || body.kind === "environmentVariable" || body.kind === "fileText" || body.kind === "actorCall" || body.kind === "sqliteQuery" || body.kind === "requestCookie" || body.kind === "requestId"
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
      const state: StreamState = streamStateFromInitializer(initializer)
        ?? (writer?.kind === "streamWriter"
          ? writer.state
          : {chunks: [], values: [], closed: false});
      const start = initializer.kind === "record" ? initializer.fields.get("start") : undefined;
      if (start?.kind === "closure") {
        const started = invokeClosure(
          evaluator,
          start,
          [{kind: "streamWriter", state}],
          instance,
        );
        if (started.kind === "thrown" || started.kind === "unknown") return started;
      }
      return {
        kind: "readableStream",
        state,
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
  if (ts.isVoidExpression(expression)) {
    evaluate(evaluator, expression.expression, module, environment, instance);
    return UNDEFINED;
  }
  if (
    ts.isPostfixUnaryExpression(expression)
    && (expression.operator === ts.SyntaxKind.PlusPlusToken
      || expression.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    const operand = evaluate(evaluator, expression.operand, module, environment, instance);
    if (operand.kind !== "number") return unknown("postfix operand is not a closed number");
    assign(
      evaluator,
      expression.operand,
      {
        kind: "number",
        value: operand.value + (expression.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1),
      },
      module,
      environment,
      instance,
    );
    return operand;
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = evaluate(evaluator, expression.operand, module, environment, instance);
    if (operand.kind === "routeChoice") {
      return mapRouteChoice(operand, negateValue);
    }
    if (operand.kind === "sqliteQuery" && operand.mode === "first") {
      return {kind: "sqlitePredicate", query: operand, test: "missing"};
    }
    if (operand.kind === "sqlitePredicate") {
      return {
        kind: "sqlitePredicate",
        query: operand.query,
        test: operand.test === "missing" ? "present" : "missing",
      };
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
          || part.kind === "requestId"
          || part.kind === "requestCookie"
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

function expandOptionalRoutePaths(pattern: string): string[] {
  if (!pattern.endsWith("?")) return [pattern];
  const segments = pattern.split("/").filter(Boolean);
  const firstOptional = segments.findIndex(segment => segment.endsWith("?"));
  if (firstOptional < 0) return [pattern];
  const optional = segments.slice(firstOptional);
  if (!optional.every(segment => /^:[A-Za-z0-9_]+(?:\{.*\})?\?$/.test(segment))) {
    return [pattern];
  }
  const prefix = segments.slice(0, firstOptional);
  return Array.from({length: optional.length + 1}, (_, count) => {
    const selected = [
      ...prefix,
      ...optional.slice(0, count).map(segment => segment.slice(0, -1)),
    ];
    return selected.length === 0 ? "/" : `/${selected.join("/")}`;
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

function stringifyRuntimeJson(value: Value): RuntimeStringPart[] | undefined {
  const parts: RuntimeStringPart[] = [];
  return appendRuntimeJsonValue(parts, value, false) ? parts : undefined;
}

function evaluateOpenApiDocument(
  application: Value & {kind: "instance"},
  config: Value | undefined,
): Value | undefined {
  if (config?.kind !== "record") return undefined;
  const registry = application.fields.get("openAPIRegistry");
  const definitions = registry?.kind === "instance"
    ? registry.fields.get("_definitions")
    : undefined;
  if (definitions?.kind !== "array") return undefined;

  const base = jsonValue(config, false);
  if (base === UNSUPPORTED_JSON || base === undefined || typeof base !== "object" || base === null) {
    return undefined;
  }
  const components: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};
  for (const definition of definitions.items) {
    if (definition.kind !== "record") continue;
    const type = definition.fields.get("type");
    const route = definition.fields.get("route");
    if (type?.kind !== "string" || type.value !== "route" || route?.kind !== "record") continue;
    const method = route.fields.get("method");
    const routePath = route.fields.get("path");
    const responses = route.fields.get("responses");
    if (method?.kind !== "string" || routePath?.kind !== "string" || responses?.kind !== "record") {
      continue;
    }
    const operation: Record<string, unknown> = {};
    const request = route.fields.get("request");
    const params = request?.kind === "record" ? request.fields.get("params") : undefined;
    if (params?.kind === "schema" && params.schemaType === "object" && params.fields !== undefined) {
      operation.parameters = [...params.fields].flatMap(([fieldName, field]) => {
        if (field.kind !== "schema") return [];
        const metadata = field.metadata?.kind === "record" ? field.metadata : undefined;
        const param = metadata?.fields.get("param");
        const parameter = param?.kind === "record" ? param : undefined;
        const name = parameter?.fields.get("name");
        const location = parameter?.fields.get("in");
        return [{
          schema: openApiSchema(field, components, false),
          required: field.optional !== true,
          name: name?.kind === "string" ? name.value : fieldName,
          in: location?.kind === "string" ? location.value : "path",
        }];
      });
    }
    operation.responses = Object.fromEntries([...responses.fields].flatMap(([status, response]) => {
      if (response.kind !== "record") return [];
      const converted = jsonValue(response, false);
      if (converted === UNSUPPORTED_JSON || typeof converted !== "object" || converted === null) {
        const description = response.fields.get("description");
        const output: Record<string, unknown> = {
          description: description?.kind === "string" ? description.value : "",
        };
        const content = response.fields.get("content");
        if (content?.kind === "record") {
          output.content = Object.fromEntries([...content.fields].flatMap(([mediaType, media]) => {
            if (media.kind !== "record") return [];
            const schema = media.fields.get("schema");
            return schema?.kind === "schema"
              ? [[mediaType, {schema: openApiSchema(schema, components, true)}]]
              : [];
          }));
        }
        return [[status, output]];
      }
      return [[status, converted]];
    }));
    (paths[routePath.value] ??= {})[method.value.toLowerCase()] = operation;
  }

  return fromJsonValue({
    ...(base as Record<string, unknown>),
    components: {schemas: components, parameters: {}},
    paths,
  });
}

function openApiSchema(
  schema: Extract<Value, {kind: "schema"}>,
  components: Record<string, unknown>,
  useReference: boolean,
): Record<string, unknown> {
  if (schema.refId !== undefined && useReference) {
    components[schema.refId] ??= openApiSchema(schema, components, false);
    return {$ref: `#/components/schemas/${schema.refId}`};
  }
  const output: Record<string, unknown> = {};
  if (schema.schemaType === "object") {
    output.type = "object";
    output.properties = Object.fromEntries([...(schema.fields ?? new Map())].flatMap(([name, field]) =>
      field.kind === "schema" ? [[name, openApiSchema(field, components, true)]] : []
    ));
    const required = [...(schema.fields ?? new Map())].flatMap(([name, field]) =>
      field.kind === "schema" && field.optional !== true ? [name] : []
    );
    if (required.length > 0) output.required = required;
  } else if (schema.schemaType === "array") {
    output.type = "array";
    if (schema.item?.kind === "schema") output.items = openApiSchema(schema.item, components, true);
  } else if (schema.schemaType !== undefined) {
    output.type = schema.schemaType;
  }
  if (schema.minLength !== undefined) output.minLength = schema.minLength;
  if (schema.minimum !== undefined) output.minimum = schema.minimum;
  if (schema.metadata?.kind === "record") {
    const example = schema.metadata.fields.get("example");
    if (example !== undefined) {
      const converted = jsonValue(example, false);
      if (converted !== UNSUPPORTED_JSON && converted !== undefined) output.example = converted;
    }
  }
  if (schema.refId !== undefined && !useReference) components[schema.refId] = output;
  return output;
}

function appendRuntimeJsonValue(
  parts: RuntimeStringPart[],
  value: Value,
  arrayElement: boolean,
): boolean {
  if (value.kind === "sqliteQuery") {
    appendRuntimePart(parts, {
      kind: "sqliteQuery",
      statement: value.statement,
      mode: value.mode,
      parameters: value.parameters,
    });
    return true;
  }
  if (value.kind === "sqliteRunChanges") {
    appendRuntimePart(parts, {kind: value.kind, result: value.result});
    return true;
  }
  if (value.kind === "sqliteRunLastInsertRowId") {
    appendRuntimePart(parts, {kind: value.kind, result: value.result, json: true});
    return true;
  }
  if (value.kind === "routeParameter") {
    appendRuntimePart(parts, {kind: "literal", value: "\""});
    appendRuntimePart(parts, {kind: "routeParameter", name: value.name});
    appendRuntimePart(parts, {kind: "literal", value: "\""});
    return true;
  }
  if (value.kind === "requestJsonField") {
    appendRuntimePart(parts, {kind: "requestJsonField", name: value.name});
    return true;
  }
  if (value.kind === "undefined") {
    if (!arrayElement) return false;
    appendRuntimePart(parts, {kind: "literal", value: "null"});
    return true;
  }
  if (value.kind === "null" || value.kind === "boolean" || value.kind === "string") {
    appendRuntimePart(parts, {kind: "literal", value: JSON.stringify(
      value.kind === "null" ? null : value.value,
    )});
    return true;
  }
  if (value.kind === "number") {
    appendRuntimePart(parts, {
      kind: "literal",
      value: JSON.stringify(Number.isFinite(value.value) ? value.value : null),
    });
    return true;
  }
  if (value.kind === "array") {
    appendRuntimePart(parts, {kind: "literal", value: "["});
    for (const [index, item] of value.items.entries()) {
      if (index > 0) appendRuntimePart(parts, {kind: "literal", value: ","});
      if (!appendRuntimeJsonValue(parts, item, true)) return false;
    }
    appendRuntimePart(parts, {kind: "literal", value: "]"});
    return true;
  }
  if (value.kind === "record") {
    appendRuntimePart(parts, {kind: "literal", value: "{"});
    let emitted = 0;
    for (const [name, field] of value.fields) {
      if (field.kind === "undefined") continue;
      if (emitted++ > 0) appendRuntimePart(parts, {kind: "literal", value: ","});
      appendRuntimePart(parts, {kind: "literal", value: `${JSON.stringify(name)}:`});
      if (!appendRuntimeJsonValue(parts, field, false)) return false;
    }
    appendRuntimePart(parts, {kind: "literal", value: "}"});
    return true;
  }
  return false;
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
    default: return UNSUPPORTED_JSON;
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
    if (receiver.kind === "array" && key.kind === "number") {
      receiver.items[key.value] = value;
      return;
    }
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

function evaluatedPropertyName(
  evaluator: Evaluator,
  name: ts.PropertyName,
  module: SourceModule,
  environment: Map<string, Value>,
  instance: Value & {kind: "instance"},
): string | undefined {
  const closed = propertyName(name);
  if (closed !== undefined) return closed;
  if (!ts.isComputedPropertyName(name)) return undefined;
  const value = evaluate(evaluator, name.expression, module, environment, instance);
  return value.kind === "string"
    ? value.value
    : value.kind === "number"
      ? String(value.value)
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

function trackEvaluatedValue(
  tracker: MemoryTracker,
  original: ts.Expression,
  module: SourceModule,
  value: Value,
): void {
  const object = value as object;
  const existing = tracker.values.get(object);
  if (existing !== undefined) {
    existing.references++;
    existing.site.maxReferences = Math.max(existing.site.maxReferences, existing.references);
    return;
  }
  if (!isTrackedAllocation(original, value)) return;
  const expression = unwrap(original);
  const location = module.sourceFile.getLineAndCharacterOfPosition(expression.getStart(module.sourceFile));
  const key = `${module.path}\0${expression.getStart(module.sourceFile)}\0${value.kind}`;
  let site = tracker.sites.get(key);
  if (site === undefined) {
    site = {
      module: module.path,
      line: location.line + 1,
      column: location.character + 1,
      valueKind: value.kind,
      instances: 0,
      maxReferences: 0,
      escape: value.kind === "worker" || value.kind === "actor" ? "worker" : "none",
    };
    tracker.sites.set(key, site);
  }
  site.instances++;
  site.maxReferences = Math.max(site.maxReferences, 1);
  tracker.values.set(object, {site, references: 1});
}

function isTrackedAllocation(expression: ts.Expression, value: Value): boolean {
  if (
    value.kind === "undefined"
    || value.kind === "null"
    || value.kind === "boolean"
    || value.kind === "number"
    || value.kind === "bigint"
    || value.kind === "reference"
    || value.kind === "unknown"
    || value.kind === "request"
    || value.kind === "routeParameter"
    || value.kind === "requestHeader"
    || value.kind === "requestId"
    || value.kind === "requestCookie"
    || value.kind === "environmentVariable"
    || value.kind === "fileText"
    || value.kind === "actorCall"
    || value.kind === "queryParameter"
    || value.kind === "queryPredicate"
    || value.kind === "fetchStatus"
    || value.kind === "clockNow"
    || value.kind === "elapsedMilliseconds"
  ) return false;
  if (value.kind !== "string" && value.kind !== "html") return true;
  const node = unwrap(expression);
  return !ts.isIdentifier(node)
    && !ts.isPropertyAccessExpression(node)
    && !ts.isElementAccessExpression(node);
}

function markValueEscape(
  tracker: MemoryTracker,
  value: Value,
  target: Exclude<EvaluatedEscapeTarget, "none">,
  visited: WeakSet<object> = new WeakSet(),
): void {
  const object = value as object;
  if (visited.has(object)) return;
  visited.add(object);
  const state = tracker.values.get(object);
  if (state !== undefined && escapeRank(target) > escapeRank(state.site.escape)) {
    state.site.escape = target;
  }
  if (value.kind === "array") {
    for (const item of value.items) markValueEscape(tracker, item, target, visited);
  } else if (value.kind === "record" || value.kind === "instance") {
    for (const field of value.fields.values()) markValueEscape(tracker, field, target, visited);
  } else if (value.kind === "closure") {
    for (const capture of value.environment.values()) markValueEscape(tracker, capture, target, visited);
  } else if (value.kind === "routeChoice") {
    for (const selected of value.cases.values()) markValueEscape(tracker, selected, target, visited);
    markValueEscape(tracker, value.fallback, target, visited);
  } else if (value.kind === "thrown") {
    markValueEscape(tracker, value.value, target, visited);
  } else if (value.kind === "readableStream" || value.kind === "writableStream") {
    for (const streamed of value.state.values ?? []) {
      markValueEscape(tracker, streamed, target, visited);
    }
  }
}

function escapeRank(target: EvaluatedEscapeTarget): number {
  return ["none", "response", "message", "worker", "process"].indexOf(target);
}

function summarizeMemory(tracker: MemoryTracker): EvaluatedMemoryReport {
  const sites = [...tracker.sites.values()].map(site => ({
    ...site,
    lifetime: lifetimeFor(site),
  })).sort((left, right) =>
    left.module.localeCompare(right.module)
    || left.line - right.line
    || left.column - right.column
    || left.valueKind.localeCompare(right.valueKind)
  );
  const summary: EvaluatedMemoryReport["summary"] = {
    compileTime: 0,
    static: 0,
    request: 0,
    worker: 0,
    message: 0,
    managed: 0,
    aliasedSites: 0,
    responseEscapes: 0,
  };
  for (const site of sites) {
    summary[site.lifetime]++;
    if (site.maxReferences > 1) summary.aliasedSites++;
    if (site.escape === "response") summary.responseEscapes++;
  }
  return {
    policy: "arena",
    managedHeapRequired: summary.managed > 0,
    sites,
    summary,
  };
}

function lifetimeFor(site: MemorySiteState): EvaluatedLifetime {
  if (site.escape === "worker") return "worker";
  if (site.escape === "message") return "message";
  if (site.escape === "process") return "managed";
  if (site.escape === "response") {
    return site.valueKind === "string" || site.valueKind === "html" ? "static" : "request";
  }
  return "compileTime";
}

function issue(evaluator: Evaluator, node: ts.Node, module: SourceModule, reason: string): void {
  evaluator.issues.push({reason, span: spanOf(node, module.sourceFile)});
}

function memberName(name: ts.MemberName | ts.PropertyName): string {
  if (ts.isComputedPropertyName(name)) return name.getText();
  return ts.isPrivateIdentifier(name) && !name.text.startsWith("#") ? `#${name.text}` : name.text;
}
