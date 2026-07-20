import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {analyzeApplicationEntry} from "./application-entry.js";
import {validateBuiltinOperations} from "./builtin-validation.js";
import {
  evaluateApplicationConstructor,
  evaluateApplicationInitialization,
  type EvaluatedBasicAuthorization,
  type EvaluatedSessionAuthorization,
  type EvaluatedEntityTag,
  type EvaluatedSqliteExistence,
  type EvaluatedResponse,
  type ApplicationInitializationEvaluation,
} from "./constructor-evaluator.js";
import {lowerStagedConstants} from "./constant-lowering.js";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import {FunctionLowerer} from "./function-lowering.js";
import type {
  Component,
  BasicAuthorization,
  SessionAuthorization,
  ElapsedHeader,
  EntityTag,
  SqliteExistence,
  Handler,
  HirProgram,
  SourceSpan,
  StaticHeader,
  ValueExpression,
  WorkerModule,
  MemoryReport,
} from "./hir.js";
import {StringTable} from "./hir.js";
import {lowerComponentBody} from "./jsx-lowering.js";
import {loadModuleGraph} from "./module-graph.js";
import {displayRuntimeClassPlan, resolveRuntimeClassPlan} from "./runtime-class-plan.js";
import {analyzeStaging} from "./staging.js";
import {validateForbiddenSyntax} from "./subset-validator.js";
import type {
  ResponseBody,
  ResponseHeaderValue,
  RuntimeStringPart,
  SqliteParameter,
  WorkerMessage,
} from "./symbolic-value.js";

export interface CompileOptions {
  sdkPath: string;
  aliases?: Readonly<Record<string, string>>;
  apiAliases?: Readonly<Record<string, string>>;
  allowedEnvironment?: ReadonlySet<string>;
  allowedReadRoots?: readonly string[];
  allowedWriteRoots?: readonly string[];
  sqliteKvBindings?: Readonly<Record<string, string>>;
  sqliteReadonlyBindings?: ReadonlySet<string>;
  assetBindings?: ReadonlySet<string>;
}

export interface CompileSession {
  program?: ts.Program;
}

export function compileEntry(
  entryPath: string,
  options: CompileOptions,
  session?: CompileSession,
): HirProgram {
  const entry = path.resolve(entryPath);
  const sdk = path.resolve(options.sdkPath);
  const builtins = builtinRuntimeAliases(sdk);
  const graph = loadModuleGraph(entry, {
    ...(options.aliases === undefined ? {} : {aliases: options.aliases}),
    builtins,
  });
  if (graph.diagnostics.length > 0) {
    throw new CompileFailure(graph.diagnostics);
  }
  const staging = analyzeStaging(graph);
  const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    allowJs: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  };
  const apiRuntimeRoots = apiBackedRuntimeRoots(options);
  const apiTypeRoots = apiDependencyTypeRoots(options.apiAliases);
  if (apiTypeRoots.length > 0) {
    compilerOptions.typeRoots = apiTypeRoots;
  }
  const typeAliases = {...options.aliases, ...options.apiAliases, ...builtins};
  if (Object.keys(typeAliases).length > 0) {
    compilerOptions.paths = Object.fromEntries(Object.entries(typeAliases).map(([specifier, target]) => [
      specifier,
      [path.resolve(target)],
    ]));
  }
  const program = ts.createProgram({
    rootNames: [entry, sdk, ...graph.modules.map(module => module.path)],
    options: compilerOptions,
    ...(session?.program === undefined ? {} : {oldProgram: session.program}),
  });
  if (session !== undefined) session.program = program;

  const sourceFile = program.getSourceFile(entry);
  if (sourceFile === undefined) {
    throw new CompileFailure([{
      code: "TINY0001",
      message: `could not load entry module: ${entry}`,
    }]);
  }

  const sourceFiles = graph.modules.map(module => {
    const loaded = program.getSourceFile(module.path);
    if (loaded === undefined) {
      throw new CompileFailure([{
        code: "TINY0001",
        message: `TypeScript did not load runtime module: ${module.path}`,
      }]);
    }
    return loaded;
  });
  const application = analyzeApplicationEntry(sourceFile);
  validateForbiddenSyntax(sourceFile, staging.computedAccesses, application !== undefined);
  validateBuiltinOperations(
    graph,
    options.allowedEnvironment ?? new Set(),
    options.allowedReadRoots ?? [],
    options.allowedWriteRoots ?? [],
    options.sqliteReadonlyBindings ?? new Set(),
    options.assetBindings ?? new Set(),
  );
  const entryDiagnostics = ts.getPreEmitDiagnostics(program, sourceFile)
    .filter(diagnostic => !isResponseIntrinsicDiagnostic(diagnostic));
  if (entryDiagnostics.length > 0) {
    throw new CompileFailure(entryDiagnostics.map(fromTypeScript));
  }
  const typeScriptDiagnostics = ts.getPreEmitDiagnostics(program)
    .filter(diagnostic => !isResponseIntrinsicDiagnostic(diagnostic))
    .filter(diagnostic => diagnostic.file === undefined
      || !apiRuntimeRoots.some(root => isWithin(root, diagnostic.file!.fileName)));
  if (typeScriptDiagnostics.length > 0) {
    throw new CompileFailure(typeScriptDiagnostics.map(fromTypeScript));
  }
  const getDeclarations = sourceFile.statements.filter(isGetDeclaration);
  if (getDeclarations.length === 0) {
    if (application !== undefined) {
      const calls = application.calls.map(call => call.method).join(", ") || "none";
      const classPlan = resolveRuntimeClassPlan(graph, application);
      const chain = classPlan === undefined
        ? application.constructorName
        : displayRuntimeClassPlan(classPlan, process.cwd());
      const initialization = evaluateApplicationInitialization(
        graph,
        application,
        options.sqliteKvBindings,
        options.sqliteReadonlyBindings,
        options.assetBindings,
      );
      if (initialization !== undefined && initialization.issues.length === 0) {
        const lowered = lowerApplicationInitialization(
          graph,
          sourceFile,
          initialization,
          application.server,
        );
        if (lowered !== undefined) {
          validateLoweredRequestJsonPaths(lowered, sourceFile);
          validateLoweredEnvironmentCapabilities(
            lowered,
            options.allowedEnvironment ?? new Set(),
            sourceFile,
          );
          validateLoweredSqliteCapabilities(
            lowered,
            options.allowedReadRoots ?? [],
            options.allowedWriteRoots ?? [],
            sourceFile,
          );
          return lowered;
        }
        throw tinyError(
          "TINY1402",
          `default application \`${application.binding}\` executed calls [${calls}] into ${initialization.routes.length} closed routes and ${initialization.routerInsertions} router insertions; native dispatch is not lowered yet`,
          sourceFile.statements.find(statement => ts.isExportAssignment(statement)) ?? sourceFile,
        );
      }
      if (initialization !== undefined && initialization.issues.length > 0) {
        throw new CompileFailure(initialization.issues.map(issue => ({
          code: "TINY1403",
          message: issue.reason,
          span: issue.span,
        })));
      }
      const evaluation = evaluateApplicationConstructor(graph, application);
      if (evaluation !== undefined && evaluation.issues.length === 0) {
        throw tinyError(
          "TINY1401",
          `default application \`${application.binding}\` executed constructor chain [${chain}] into ${evaluation.fields.length} closed fields; registration calls [${calls}] are not lowered yet`,
          sourceFile.statements.find(statement => ts.isExportAssignment(statement)) ?? sourceFile,
        );
      }
      throw tinyError(
        "TINY1400",
        `default application \`${application.binding}\` resolves constructor chain [${chain}] and registers calls [${calls}]; native application initialization is not lowered yet`,
        sourceFile.statements.find(statement => ts.isExportAssignment(statement)) ?? sourceFile,
      );
    }
  }
  if (getDeclarations.length !== 1) {
    throw tinyError(
      "TINY1103",
      "entry module must export exactly one GET handler or one constructed default application",
      getDeclarations[0] ?? sourceFile,
    );
  }
  for (const module of sourceFiles) {
    if (module !== sourceFile) {
      validateForbiddenSyntax(module, staging.computedAccesses);
    }
  }
  const componentDeclarations = sourceFiles.flatMap(module =>
    module.statements.filter(isComponentDeclaration)
  );
  const componentIds = new Map<string, number>();
  componentDeclarations.forEach((declaration, id) => {
    const name = declaration.name?.text;
    if (name === undefined) {
      throw tinyError("TINY1101", "components must have a name", declaration);
    }
    componentIds.set(name, id);
  });

  const strings = new StringTable();
  const components: Component[] = componentDeclarations.map((declaration, id) => {
    const name = declaration.name!.text;
    const componentSource = declaration.getSourceFile();
    if (declaration.parameters.length !== 0) {
      throw tinyError(
        "TINY1102",
        "component props are not supported by the first static slice",
        declaration.parameters[0]!,
      );
    }
    const expression = componentReturnExpression(declaration);
    return {
      id,
      name,
      span: spanOf(declaration, componentSource),
      html: lowerComponentBody(expression, componentSource, componentIds, strings),
    };
  });

  const constants = lowerStagedConstants(staging.bindings);
  const functionLowerer = new FunctionLowerer(program.getTypeChecker(), constants, strings);
  const handler = lowerGetHandler(getDeclarations[0]!, componentIds, functionLowerer, sourceFile);
  const functions = functionLowerer.finish();

  const staticHtmlBytes = strings.values.reduce(
    (total, value) => total + Buffer.byteLength(value.value, "utf8"),
    0,
  );
  return {
    version: 2,
    target: "aarch64-apple-darwin",
    entry,
    modules: graph.modules.map(module => ({path: module.path})),
    functions,
    components,
    workers: [],
    supervisors: [],
    actors: [],
    sqliteDatabases: [],
    assetStores: [],
    handlers: [handler],
    staticStrings: strings.values,
    constants,
    memory: emptyMemoryReport(),
    statistics: {
      modules: graph.modules.length,
      functions: functions.length,
      components: components.length,
      constants: constants.length,
      staticHtmlBytes,
      dynamicHtmlExpressions: 0,
    },
  };
}

function builtinRuntimeAliases(sdk: string): Record<string, string> {
  const builtins = path.join(path.dirname(sdk), "builtins");
  const serve = path.join(builtins, "serve.ts");
  return {
    "tinytsx:serve": serve,
    "@hono/node-server": serve,
    "tinytsx:env": path.join(builtins, "env.ts"),
    "tinytsx:fs": path.join(builtins, "fs.ts"),
    "tinytsx:sqlite": path.join(builtins, "sqlite.ts"),
    "tinytsx:actors": path.join(builtins, "actors.ts"),
    "tinytsx:assets": path.join(builtins, "assets.ts"),
  };
}

function apiBackedRuntimeRoots(options: CompileOptions): string[] {
  return Object.keys(options.apiAliases ?? {}).flatMap(specifier => {
    const runtime = options.aliases?.[specifier];
    if (runtime === undefined) return [];
    const packageRoot = nearestPackageRoot(path.resolve(runtime));
    return packageRoot === undefined ? [] : [packageRoot];
  });
}

function apiDependencyTypeRoots(
  apiAliases: Readonly<Record<string, string>> | undefined,
): string[] {
  const roots = new Set<string>();
  for (const target of Object.values(apiAliases ?? {})) {
    let current = path.dirname(path.resolve(target));
    while (true) {
      if (path.basename(current) === "node_modules") {
        const types = path.join(current, "@types");
        if (fs.existsSync(types)) roots.add(types);
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...roots];
}

function nearestPackageRoot(file: string): string | undefined {
  let current = path.dirname(file);
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function lowerApplicationInitialization(
  graph: ReturnType<typeof loadModuleGraph>,
  sourceFile: ts.SourceFile,
  initialization: ApplicationInitializationEvaluation,
  server: {port?: number} | undefined,
): HirProgram | undefined {
  const routes = initialization.routes.filter(route => isSupportedHttpMethod(route.method));
  const fallbackRoutes = initialization.notFoundResponse === undefined
    ? []
    : (["GET", "POST"] as const).flatMap(method =>
      routes.some(route => route.method === method && route.path === "/*")
        ? []
        : [{
          method,
          path: "/*",
          response: initialization.notFoundResponse!,
          parameterValidations: undefined,
        }]
    );
  const constrainedFallbackRoutes = routes.flatMap(route =>
    route.path.includes("{")
    && route.response?.status === 404
    && !routes.some(candidate => candidate.method === route.method && candidate.path === "/*")
      ? [{
        method: route.method,
        path: "/*",
        response: route.response,
        parameterValidations: undefined,
      }]
      : []
  );
  const emittedRoutes = [...routes, ...fallbackRoutes, ...constrainedFallbackRoutes];
  const loweredHeaders = emittedRoutes.map(route =>
    lowerResponseHeaders(route.response?.headers)
  );
  if (
    routes.length === 0
    || initialization.routes.some(route =>
      route.method !== "ALL" && !isSupportedHttpMethod(route.method)
    )
  ) {
    return undefined;
  }
  if (emittedRoutes.some(route =>
    route.response === undefined
    || !isLowerableEvaluatedResponse(route.response)
    || route.parameterValidations?.some(validation =>
      !isLowerableEvaluatedResponse(validation.rejected)
    ) === true
  ) || loweredHeaders.some(headers => headers === undefined)) {
    return undefined;
  }
  const exportNode = sourceFile.statements.find(statement => ts.isExportAssignment(statement)) ?? sourceFile;
  const span = spanOf(exportNode, sourceFile);
  const strings = new StringTable();
  const workers = new WorkerTable(graph);
  const handlers = emittedRoutes.map((route, index) => {
    const response = route.response!;
    const streamBody = typeof response.body !== "string"
      && !Array.isArray(response.body)
      && response.body.kind === "stream"
      ? response.body
      : undefined;
    const assetBody = typeof response.body !== "string"
      && !Array.isArray(response.body)
      && response.body.kind === "asset"
      ? response.body
      : undefined;
    const loweredResponse = assetBody !== undefined
      ? {kind: "asset" as const, store: assetBody.store.id}
      : streamBody !== undefined
      ? {
        kind: "stream" as const,
        chunks: streamBody.chunks.map(chunk => typeof chunk === "string"
          ? {kind: "stringLiteral" as const, string: strings.intern(chunk), span}
          : lowerRuntimeString(chunk, route.path, strings, workers, span)),
        ...(response.status === 200 ? {} : {status: response.status}),
        contentType: response.contentType as
          | ""
          | "text/plain; charset=UTF-8"
          | "text/plain; charset=utf-8"
          | "text/plain;charset=UTF-8"
          | "text/html; charset=UTF-8"
          | "application/json",
      }
      : {
        kind: "text" as const,
        value: lowerResponseBody(response.body, route.path, strings, workers, span),
        ...(response.status === 200 ? {} : {status: response.status}),
        contentType: response.contentType as
          | ""
          | "text/plain; charset=UTF-8"
          | "text/plain; charset=utf-8"
          | "text/plain;charset=UTF-8"
          | "text/html; charset=UTF-8"
          | "application/json",
      };
    const responseHeaders = loweredHeaders[index]!;
    const basicAuthorization = response.basicAuthorization === undefined
      ? undefined
      : lowerBasicAuthorization(response.basicAuthorization, route.path, strings, workers, span);
    const sessionAuthorization = response.sessionAuthorization === undefined
      ? undefined
      : lowerSessionAuthorization(response.sessionAuthorization, route.path, strings, workers, span);
    const bodyLimit = response.bodyLimit === undefined
      ? undefined
      : {
        maxBytes: response.bodyLimit.maxBytes,
        rejected: lowerGuardedResponse(
          response.bodyLimit.rejected,
          route.path,
          strings,
          workers,
          span,
        ),
      };
    const entityTag = response.entityTag === undefined
      ? undefined
      : lowerEntityTag(response.entityTag, route.path, strings, workers, span);
    const sqliteExistence = response.sqliteExistence === undefined
      ? undefined
      : lowerSqliteExistence(response.sqliteExistence, route.path, strings, workers, span);
    const parameterValidations = route.parameterValidations?.map(validation => ({
      name: validation.name,
      segment: routeParameterSegment(route.path, validation.name),
      minLength: validation.minLength,
      rejected: lowerGuardedResponse(validation.rejected, route.path, strings, workers, span),
    }));
    return {
      method: route.method as "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS",
      path: route.path,
      ...responseHeaders,
      ...(basicAuthorization === undefined ? {} : {basicAuthorization}),
      ...(sessionAuthorization === undefined ? {} : {sessionAuthorization}),
      ...(response.requestId === undefined
        ? {}
        : {requestId: {
          header: strings.intern(response.requestId.headerName),
          maxLength: response.requestId.maxLength,
        }}),
      ...(bodyLimit === undefined ? {} : {bodyLimit}),
      ...(entityTag === undefined ? {} : {entityTag}),
      ...(sqliteExistence === undefined ? {} : {sqliteExistence}),
      ...(parameterValidations === undefined || parameterValidations.length === 0
        ? {}
        : {parameterValidations}),
      ...(response.actorActions === undefined || response.actorActions.length === 0
        ? {}
        : {actorActions: response.actorActions.map(action => action.kind === "tell"
          ? {
            kind: "tell" as const,
            actor: action.actor.id,
            ...(typeof action.message === "number"
              ? {message: action.message}
              : {jsonMessage: strings.intern(action.message!)}),
          }
          : {kind: "stop" as const, actor: action.actor.id})}),
      ...(response.databaseActions === undefined || response.databaseActions.length === 0
        ? {}
        : {sqliteActions: response.databaseActions.map(action => action.kind === "exec"
          ? {
            kind: "exec" as const,
            database: action.database.id,
            sql: strings.intern(action.sql!),
            ...(action.parameters === undefined
              ? {}
              : {parameters: lowerSqliteParameters(action.parameters, route.path, strings)}),
            ...(action.result === undefined ? {} : {result: action.result}),
          }
          : action.kind === "transaction"
            ? {kind: "transaction" as const, database: action.database.id, sql: strings.intern(action.sql!)}
            : action.kind === "transactionSteps"
              ? {
                kind: "transactionSteps" as const,
                database: action.database.id,
                steps: action.steps!.map(step => ({
                  sql: strings.intern(step.sql),
                  parameters: lowerSqliteParameters(step.parameters, route.path, strings),
                })),
              }
              : {kind: "close" as const, database: action.database.id})}),
      ...(response.stderr === undefined
        ? {}
        : {stderr: response.stderr.map(line => strings.intern(line))}),
      response: loweredResponse,
      span,
    };
  });
  return {
    version: 2,
    target: "aarch64-apple-darwin",
    ...(server === undefined ? {} : {server}),
    entry: graph.entry,
    modules: graph.modules.map(module => ({path: module.path})),
    functions: [],
    components: [],
    workers: workers.values,
    supervisors: initialization.supervisors.map(supervisor => ({
      id: supervisor.id,
      strategy: supervisor.strategy,
      maxRestarts: supervisor.maxRestarts,
      withinMs: supervisor.withinMs,
    })),
    actors: initialization.actors.map(actor => ({
      id: actor.id,
      operation: actor.operation,
      initialState: actor.initialState,
      ...(actor.initialJson === undefined ? {} : {initialJson: strings.intern(actor.initialJson)}),
      mailboxCapacity: actor.mailboxCapacity,
      ...(actor.failureMessage === undefined ? {} : {failureMessage: actor.failureMessage}),
      ...(actor.restart === undefined ? {} : {restart: actor.restart}),
      ...(actor.supervisor === undefined ? {} : {supervisor: actor.supervisor.id}),
      ...(actor.persistence === undefined
        ? {}
        : {persistence: {database: actor.persistence.database.id, key: actor.persistence.key}}),
    })),
    sqliteDatabases: initialization.databases.map(database => ({
      id: database.id,
      ...(database.path === undefined ? {} : {path: database.path}),
      ...(database.binding === undefined ? {} : {binding: database.binding}),
      ...(database.readonly === true ? {readonly: true} : {}),
    })),
    assetStores: initialization.assetStores.map(store => ({
      id: store.id,
      name: store.name,
      index: store.index,
      spaFallback: store.spaFallback,
    })),
    handlers,
    staticStrings: strings.values,
    constants: [],
    memory: initialization.memory,
    statistics: {
      modules: graph.modules.length,
      functions: 0,
      components: 0,
      constants: 0,
      staticHtmlBytes: strings.values.reduce(
        (total, value) => total + Buffer.byteLength(value.value, "utf8"),
        0,
      ),
      dynamicHtmlExpressions: emittedRoutes.reduce((total, route) =>
        total + (route.response === undefined ? 0 : dynamicResponseExpressions(route.response.body)),
      0),
    },
  };
}

function isSupportedHttpMethod(
  method: string,
): method is "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS" {
  return ["GET", "POST", "PUT", "DELETE", "OPTIONS"].includes(method);
}

function emptyMemoryReport(): MemoryReport {
  return {
    policy: "arena",
    managedHeapRequired: false,
    sites: [],
    summary: {
      compileTime: 0,
      static: 0,
      request: 0,
      worker: 0,
      message: 0,
      managed: 0,
      aliasedSites: 0,
      responseEscapes: 0,
    },
  };
}

function lowerBasicAuthorization(
  authorization: EvaluatedBasicAuthorization,
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
): BasicAuthorization {
  return {
    credentials: authorization.credentials,
    rejected: lowerGuardedResponse(authorization.rejected, routePath, strings, workers, span),
  };
}

function lowerSessionAuthorization(
  authorization: EvaluatedSessionAuthorization,
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
): SessionAuthorization {
  return {
    mode: authorization.mode,
    cookie: strings.intern(authorization.cookieName),
    rejected: lowerGuardedResponse(authorization.rejected, routePath, strings, workers, span),
  };
}

function lowerEntityTag(
  entityTag: EvaluatedEntityTag,
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
): EntityTag {
  return {
    value: entityTag.value,
    notModified: lowerGuardedResponse(entityTag.notModified, routePath, strings, workers, span),
  };
}

function lowerSqliteExistence(
  existence: EvaluatedSqliteExistence,
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
): SqliteExistence {
  return {
    database: existence.query.statement.database.id,
    sql: strings.intern(existence.query.statement.sql),
    parameters: lowerSqliteParameters(existence.query.parameters, routePath, strings),
    missing: lowerGuardedResponse(existence.missing, routePath, strings, workers, span),
  };
}

function lowerSqliteParameters(
  parameters: SqliteParameter[],
  routePath: string,
  strings: StringTable,
) {
  return parameters.map(parameter => {
    switch (parameter.kind) {
      case "routeParameter":
        return {kind: "routeParameter" as const, segment: routeParameterSegment(routePath, parameter.name)};
      case "queryParameter": {
        const queryLength = Buffer.byteLength(parameter.name, "utf8");
        const fallbackLength = Buffer.byteLength(parameter.fallback, "utf8");
        return {
          kind: "queryParameter" as const,
          string: strings.intern(parameter.name + parameter.fallback),
          queryLength,
          fallbackLength,
        };
      }
      case "queryInteger":
        return {
          kind: "queryInteger" as const,
          query: strings.intern(parameter.name),
          fallback: parameter.fallback,
        };
      case "requestJsonField":
        return {kind: "requestJsonField" as const, field: strings.intern(encodeRequestJsonPath(parameter.path))};
      case "requestHeader":
        return {kind: "requestHeader" as const, header: strings.intern(parameter.name)};
      case "randomUuid":
        return {kind: "randomUuid" as const};
      case "staticString":
        return {kind: "staticString" as const, string: strings.intern(parameter.value)};
      case "staticInteger":
        return {kind: "staticInteger" as const, value: parameter.value};
      case "staticReal":
        return {kind: "staticReal" as const, value: parameter.value};
      case "staticBoolean":
        return {kind: "staticBoolean" as const, value: parameter.value};
      case "null":
        return {kind: "null" as const};
    }
  });
}

function lowerGuardedResponse(
  response: EvaluatedResponse,
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
) {
  const headers = lowerResponseHeaders(response.headers);
  if (headers === undefined) {
    throw new Error("validated guarded response headers did not lower");
  }
  return {
    ...headers,
    ...(response.stderr === undefined
      ? {}
      : {stderr: response.stderr.map(line => strings.intern(line))}),
    response: {
      kind: "text" as const,
      value: lowerResponseBody(response.body, routePath, strings, workers, span),
      ...(response.status === 200 ? {} : {status: response.status}),
      contentType: response.contentType as
        | ""
        | "text/plain; charset=UTF-8"
        | "text/plain; charset=utf-8"
        | "text/plain;charset=UTF-8"
        | "text/html; charset=UTF-8"
        | "application/json",
    },
  };
}

function isLowerableEvaluatedResponse(response: EvaluatedResponse): boolean {
  const contentType = [
    "",
    "text/plain; charset=UTF-8",
    "text/plain; charset=utf-8",
    "text/plain;charset=UTF-8",
    "text/html; charset=UTF-8",
    "application/json",
  ].includes(response.contentType);
  if (
    response.kind !== "text"
    || !contentType
    || !isLowerableResponseBody(response.body)
    || lowerResponseHeaders(response.headers) === undefined
  ) {
    return false;
  }
  const authorization = response.basicAuthorization;
  const authorizationLowerable = authorization === undefined
    || (authorization.credentials.length > 0
      && authorization.rejected.basicAuthorization === undefined
      && authorization.rejected.entityTag === undefined
      && isLowerableEvaluatedResponse(authorization.rejected));
  const entityTag = response.entityTag;
  const entityTagLowerable = entityTag === undefined
    || (entityTag.notModified.basicAuthorization === undefined
      && entityTag.notModified.entityTag === undefined
      && isLowerableEvaluatedResponse(entityTag.notModified));
  const sqliteExistence = response.sqliteExistence;
  const sqliteExistenceLowerable = sqliteExistence === undefined
    || (sqliteExistence.query.mode === "first"
      && sqliteExistence.missing.sqliteExistence === undefined
      && sqliteExistence.missing.databaseActions === undefined
      && sqliteExistence.missing.actorActions === undefined
      && isLowerableEvaluatedResponse(sqliteExistence.missing));
  return authorizationLowerable && entityTagLowerable && sqliteExistenceLowerable;
}

function lowerResponseHeaders(
  headers: Array<{name: string; value: ResponseHeaderValue}> | undefined,
): {headers?: StaticHeader[]; elapsedHeaders?: ElapsedHeader[]} | undefined {
  if (headers === undefined) return {};
  const staticHeaders: StaticHeader[] = [];
  const elapsedHeaders: ElapsedHeader[] = [];
  for (const header of headers) {
    if (typeof header.value === "string") {
      staticHeaders.push({name: header.name, value: header.value});
      continue;
    }
    const suffix = elapsedHeaderSuffix(header.value);
    if (suffix === undefined) return undefined;
    elapsedHeaders.push({name: header.name, suffix});
  }
  return {
    ...(staticHeaders.length === 0 ? {} : {headers: staticHeaders}),
    ...(elapsedHeaders.length === 0 ? {} : {elapsedHeaders}),
  };
}

function elapsedHeaderSuffix(parts: RuntimeStringPart[]): string | undefined {
  if (parts[0]?.kind !== "elapsedMilliseconds") return undefined;
  const suffix = parts.slice(1);
  return suffix.every(part => part.kind === "literal")
    ? suffix.map(part => part.kind === "literal" ? part.value : "").join("")
    : undefined;
}

function isLowerableResponseBody(body: ResponseBody): boolean {
  if (typeof body === "string") return true;
  if (Array.isArray(body)) {
    return body.every(part => part.kind !== "elapsedMilliseconds");
  }
  if (body.kind === "stream") {
    return body.chunks.every(chunk => typeof chunk === "string"
      || chunk.every(part => part.kind !== "elapsedMilliseconds"));
  }
  if (body.kind === "asset") return true;
  return isLowerableResponseBody(body.whenPresent) && isLowerableResponseBody(body.whenAbsent);
}

function lowerResponseBody(
  body: ResponseBody,
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
): ValueExpression {
  if (typeof body === "string") {
    return {kind: "stringLiteral", string: strings.intern(body), span};
  }
  if (Array.isArray(body)) {
    return lowerRuntimeString(body, routePath, strings, workers, span);
  }
  if (body.kind === "stream") {
    throw new Error("stream body must lower through a stream response");
  }
  if (body.kind === "asset") {
    throw new Error("asset body must lower through an asset response");
  }
  return {
    kind: "queryConditional",
    query: strings.intern(body.query),
    whenPresent: typeof body.whenPresent === "string"
      ? {kind: "stringLiteral", string: strings.intern(body.whenPresent), span}
      : lowerRuntimeString(body.whenPresent, routePath, strings, workers, span),
    whenAbsent: typeof body.whenAbsent === "string"
      ? {kind: "stringLiteral", string: strings.intern(body.whenAbsent), span}
      : lowerRuntimeString(body.whenAbsent, routePath, strings, workers, span),
    span,
  };
}

function lowerRuntimeString(
  parts: RuntimeStringPart[],
  routePath: string,
  strings: StringTable,
  workers: WorkerTable,
  span: SourceSpan,
): ValueExpression {
  return {
    kind: "concat",
    values: parts.map(part => {
      if (part.kind === "literal") {
        return {kind: "stringLiteral" as const, string: strings.intern(part.value), span};
      }
      if (part.kind === "requestHeader") {
        return {kind: "requestHeader" as const, header: strings.intern(part.name), span};
      }
      if (part.kind === "requestJsonField") {
        return {
          kind: "requestJsonField" as const,
          field: strings.intern(encodeRequestJsonPath(part.path)),
          span,
        };
      }
      if (part.kind === "requestId") {
        return {kind: "requestId" as const, header: strings.intern(part.headerName), span};
      }
      if (part.kind === "sqliteRunChanges") {
        return {kind: "sqliteRunChanges" as const, result: part.result, span};
      }
      if (part.kind === "sqliteRunLastInsertRowId") {
        return {
          kind: "sqliteRunLastInsertRowId" as const,
          result: part.result,
          json: part.json,
          span,
        };
      }
      if (part.kind === "requestCookie") {
        return {
          kind: "requestCookie" as const,
          cookie: strings.intern(part.name),
          ...(part.fallback === undefined ? {} : {fallback: strings.intern(part.fallback)}),
          span,
        };
      }
      if (part.kind === "environmentVariable") {
        return {
          kind: "environmentVariable" as const,
          name: strings.intern(part.name),
          required: part.required,
          ...(part.fallback === undefined ? {} : {fallback: strings.intern(part.fallback)}),
          span,
        };
      }
      if (part.kind === "fileText") {
        return {
          kind: "fileText" as const,
          path: strings.intern(part.path),
          maxBytes: part.maxBytes,
          span,
        };
      }
      if (part.kind === "actorCall") {
        return {
          kind: "actorCall" as const,
          actor: part.actor.id,
          ...(typeof part.message === "number"
            ? {message: part.message}
            : {jsonMessage: strings.intern(part.message)}),
          ...(part.timeoutMs === undefined ? {} : {timeoutMs: part.timeoutMs}),
          span,
        };
      }
      if (part.kind === "sqliteQuery") {
        return {
          kind: "sqliteQuery" as const,
          database: part.statement.database.id,
          sql: strings.intern(part.statement.sql),
          mode: part.mode,
          parameters: lowerSqliteParameters(part.parameters, routePath, strings),
          span,
        };
      }
      if (part.kind === "todoOperation") {
        return {
          kind: "todoStore" as const,
          database: part.database.id,
          operation: part.operation,
          user: part.user.kind === "staticString"
            ? {kind: "staticString" as const, string: strings.intern(part.user.value)}
            : {kind: "requestCookie" as const, cookie: strings.intern(part.user.name)},
          ...(part.argument === undefined
            ? {}
            : part.argument.kind === "requestJsonField"
              ? {
                  argument: {
                    kind: "requestJsonField" as const,
                    field: strings.intern(encodeRequestJsonPath(part.argument.path)),
                  },
                }
              : {
                  argument: {
                    kind: "routeParameter" as const,
                    segment: routeParameterSegment(routePath, part.argument.name),
                  },
                }),
          span,
        };
      }
      if (part.kind === "fetchStatus") {
        return {kind: "fetchStatus" as const, url: strings.intern(part.url), span};
      }
      if (part.kind === "queryParameter") {
        return {
          kind: "queryParameter" as const,
          query: strings.intern(part.name),
          ...(part.fallback === undefined ? {} : {fallback: strings.intern(part.fallback)}),
          escapeHtml: part.escapeHtml,
          span,
        };
      }
      if (part.kind === "elapsedMilliseconds") {
        throw new Error("elapsed milliseconds are only lowerable in response headers");
      }
      if (part.kind === "workerCall") {
        return {
          kind: "workerCall",
          worker: workers.intern(part.module),
          input: lowerWorkerMessage(part.input, strings, span),
          span,
        };
      }
      if (part.kind === "openAiChatText") {
        return {
          kind: "openAiChatText",
          url: strings.intern(part.url),
          authorization: strings.intern(part.authorization),
          body: strings.intern(part.body),
          span,
        };
      }
      return {
        kind: "routeParameter",
        name: part.name,
        ...routeParameterLocation(routePath, part.name),
        span,
      };
    }),
    span,
  };
}

function encodeRequestJsonPath(path: readonly string[]): string {
  return path.join("\0");
}

function dynamicResponseExpressions(body: ResponseBody): number {
  if (typeof body === "string") return 0;
  if (Array.isArray(body)) {
    return body.filter(part =>
      part.kind === "routeParameter"
      || part.kind === "requestJsonField"
      || part.kind === "requestHeader"
      || part.kind === "requestCookie"
      || part.kind === "environmentVariable"
      || part.kind === "fileText"
      || part.kind === "actorCall"
      || part.kind === "sqliteQuery"
      || part.kind === "todoOperation"
      || part.kind === "fetchStatus"
      || part.kind === "queryParameter"
      || part.kind === "workerCall"
      || part.kind === "openAiChatText"
    ).length;
  }
  if (body.kind === "stream") {
    return body.chunks.reduce((total, chunk) =>
      total + (typeof chunk === "string" ? 0 : dynamicResponseExpressions(chunk)), 0);
  }
  if (body.kind === "asset") return 0;
  return 1
    + dynamicResponseExpressions(body.whenPresent)
    + dynamicResponseExpressions(body.whenAbsent);
}

function validateLoweredRequestJsonPaths(program: HirProgram, sourceFile: ts.SourceFile): void {
  for (const handler of program.handlers) {
    const fields = new Set<number>();
    collectRequestJsonFieldIds(handler, fields);
    const paths = new Set([...fields].flatMap(field => {
      const path = program.staticStrings[field]?.value;
      return path === undefined ? [] : [path];
    }));
    if (paths.size > 16) {
      throw tinyError(
        "TINY1403",
        `handler ${handler.method} ${handler.path} selects more than sixteen request JSON leaf paths`,
        sourceFile,
        "select at most sixteen distinct primitive request JSON leaves in one handler",
      );
    }
  }
}

function collectRequestJsonFieldIds(value: unknown, output: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRequestJsonFieldIds(item, output);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (record.kind === "requestJsonField" && typeof record.field === "number") {
    output.add(record.field);
  }
  for (const field of Object.values(record)) collectRequestJsonFieldIds(field, output);
}

function validateLoweredEnvironmentCapabilities(
  program: HirProgram,
  allowed: ReadonlySet<string>,
  sourceFile: ts.SourceFile,
): void {
  const ids = new Set<number>();
  for (const handler of program.handlers) {
    if (handler.response.kind === "text") {
      collectEnvironmentIds(handler.response.value, ids);
    } else if (handler.response.kind === "stream") {
      for (const chunk of handler.response.chunks) collectEnvironmentIds(chunk, ids);
    }
  }
  const denied = [...ids]
    .map(id => program.staticStrings[id]?.value)
    .filter((name): name is string => name !== undefined && !allowed.has(name));
  if (denied.length === 0) return;
  throw new CompileFailure([...new Set(denied)].sort().map(name => ({
    code: "TINY1501",
    message: `environment variable \`${name}\` requires an explicit capability`,
    span: spanOf(sourceFile, sourceFile),
    help: `re-run with \`--allow-env ${name}\``,
  })));
}

function validateLoweredSqliteCapabilities(
  program: HirProgram,
  readRoots: readonly string[],
  writeRoots: readonly string[],
  sourceFile: ts.SourceFile,
): void {
  for (const database of program.sqliteDatabases) {
    if (database.readonly === true) {
      if (database.binding === undefined || database.path !== undefined) {
        throw tinyError(
          "TINY1513",
          "read-only SQLite databases require one deploy-time binding",
          sourceFile,
        );
      }
      continue;
    }
    if (database.path === undefined) {
      throw tinyError("TINY1510", "SQLite database path is missing", sourceFile);
    }
    if (database.path === ":memory:") continue;
    const portable = database.path.length > 0
      && database.path.length <= 4096
      && !database.path.includes("\0")
      && !path.isAbsolute(database.path)
      && database.path.split(/[\\/]/).every(component =>
        component !== "" && component !== "." && component !== ".."
      );
    if (!portable) {
      throw tinyError(
        "TINY1510",
        `SQLite path \`${database.path}\` must be a static normalized relative path`,
        sourceFile,
        "use a path such as `state/application.db` without empty, dot, or parent segments",
      );
    }
    const roots = readRoots.filter(root => writeRoots.includes(root));
    if (roots.length !== 1) {
      throw tinyError(
        "TINY1511",
        `SQLite path \`${database.path}\` requires exactly one shared read/write root`,
        sourceFile,
        "re-run with matching `--allow-read <root>` and `--allow-write <root>` capabilities",
      );
    }
    database.path = path.join(roots[0]!, database.path);
  }
}

function collectEnvironmentIds(expression: ValueExpression, output: Set<number>): void {
  if (expression.kind === "environmentVariable") {
    output.add(expression.name);
    return;
  }
  if (expression.kind === "concat") {
    for (const value of expression.values) collectEnvironmentIds(value, output);
    return;
  }
  if (expression.kind === "directCall") {
    for (const argument of expression.arguments) collectEnvironmentIds(argument, output);
    return;
  }
  if (expression.kind === "queryConditional") {
    collectEnvironmentIds(expression.whenPresent, output);
    collectEnvironmentIds(expression.whenAbsent, output);
  }
}

function lowerWorkerMessage(
  input: WorkerMessage,
  strings: StringTable,
  span: SourceSpan,
): ValueExpression {
  if (input.kind === "literal") {
    return {kind: "stringLiteral", string: strings.intern(input.value), span};
  }
  return {
    kind: "queryParameter",
    query: strings.intern(input.name),
    ...(input.fallback === undefined ? {} : {fallback: strings.intern(input.fallback)}),
    escapeHtml: false,
    span,
  };
}

class WorkerTable {
  readonly values: WorkerModule[] = [];
  readonly #ids = new Map<string, number>();
  readonly #modules: ReadonlyMap<string, ReturnType<typeof loadModuleGraph>["modules"][number]>;

  constructor(graph: ReturnType<typeof loadModuleGraph>) {
    this.#modules = new Map(graph.modules.map(module => [module.path, module]));
  }

  intern(modulePath: string): number {
    const existing = this.#ids.get(modulePath);
    if (existing !== undefined) return existing;
    const module = this.#modules.get(modulePath);
    if (module === undefined) {
      throw new Error(`worker module is absent from the runtime graph: ${modulePath}`);
    }
    validateAsciiUppercaseWorker(module.sourceFile);
    const id = this.values.length;
    this.values.push({id, module: modulePath, operation: "asciiUppercase"});
    this.#ids.set(modulePath, id);
    return id;
  }
}

function validateAsciiUppercaseWorker(sourceFile: ts.SourceFile): void {
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement)
    && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
  );
  const parameter = declaration?.parameters[0];
  const returned = declaration?.body?.statements.length === 1
    && ts.isReturnStatement(declaration.body.statements[0]!)
    ? declaration.body.statements[0]!.expression
    : undefined;
  if (
    declaration === undefined
    || declaration.parameters.length !== 1
    || parameter === undefined
    || !ts.isIdentifier(parameter.name)
    || returned === undefined
    || !ts.isCallExpression(returned)
    || returned.arguments.length !== 0
    || !ts.isPropertyAccessExpression(returned.expression)
    || returned.expression.name.text !== "toUpperCase"
    || !ts.isIdentifier(returned.expression.expression)
    || returned.expression.expression.text !== parameter.name.text
  ) {
    throw tinyError(
      "TINY1600",
      "worker module must default-export one (input: string) => input.toUpperCase() function",
      declaration ?? sourceFile,
    );
  }
}

function routeParameterSegment(pattern: string, name: string): number {
  return routeParameterLocation(pattern, name).segment;
}

function routeParameterLocation(pattern: string, name: string): {segment: number; tail?: true} {
  const segments = pattern.split("/").filter(Boolean);
  const index = segments.findIndex(segment =>
    segment === `:${name}` || segment.startsWith(`:${name}{`)
  );
  if (index < 0) {
    throw new Error(`route parameter \`${name}\` is absent from pattern \`${pattern}\``);
  }
  return {
    segment: index,
    ...(segments[index]!.endsWith("{.*}") ? {tail: true as const} : {}),
  };
}

function isResponseIntrinsicDiagnostic(diagnostic: ts.Diagnostic): boolean {
  if (diagnostic.code !== 2339 || diagnostic.file === undefined || diagnostic.start === undefined) {
    return false;
  }
  const token = tokenAtPosition(diagnostic.file, diagnostic.start);
  return ts.isIdentifier(token)
    && (token.text === "html" || token.text === "text")
    && ts.isPropertyAccessExpression(token.parent)
    && ts.isIdentifier(token.parent.expression)
    && token.parent.expression.text === "Response";
}

function tokenAtPosition(node: ts.Node, position: number): ts.Node {
  for (const child of node.getChildren(node.getSourceFile())) {
    if (child.getStart(node.getSourceFile()) <= position && position < child.getEnd()) {
      return tokenAtPosition(child, position);
    }
  }
  return node;
}

function isComponentDeclaration(statement: ts.Statement): statement is ts.FunctionDeclaration {
  if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) {
    return false;
  }
  if (statement.name.text === "GET") {
    return false;
  }
  return statement.type?.getText(statement.getSourceFile()) === "JSX.Element";
}

function isGetDeclaration(statement: ts.Statement): statement is ts.FunctionDeclaration {
  return ts.isFunctionDeclaration(statement)
    && statement.name?.text === "GET"
    && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function componentReturnExpression(
  declaration: ts.FunctionDeclaration,
): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  if (declaration.body === undefined || declaration.body.statements.length !== 1) {
    throw tinyError(
      "TINY1104",
      "a static component body must contain exactly one return statement",
      declaration,
    );
  }
  const statement = declaration.body.statements[0]!;
  const expression = ts.isReturnStatement(statement) && statement.expression !== undefined
    ? unwrapParentheses(statement.expression)
    : undefined;
  if (
    !ts.isReturnStatement(statement)
    || expression === undefined
    || !isJsxRoot(expression)
  ) {
    throw tinyError("TINY1105", "a static component must return TSX directly", statement);
  }
  return expression;
}

function lowerGetHandler(
  declaration: ts.FunctionDeclaration,
  componentIds: ReadonlyMap<string, number>,
  functions: FunctionLowerer,
  sourceFile: ts.SourceFile,
): Handler {
  if (declaration.parameters.length !== 1 || declaration.body?.statements.length !== 1) {
    throw tinyError(
      "TINY1110",
      "GET must accept one Request and contain one return statement in the static slice",
      declaration,
    );
  }
  const statement = declaration.body.statements[0]!;
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) {
    throw tinyError("TINY1111", "GET must return `Response.html(...)` or `Response.text(...)`", statement);
  }
  const call = statement.expression;
  if (
    !ts.isCallExpression(call)
    || !ts.isPropertyAccessExpression(call.expression)
    || call.expression.expression.getText(sourceFile) !== "Response"
    || call.arguments.length !== 1
  ) {
    throw tinyError("TINY1111", "GET must return `Response.html(...)` or `Response.text(...)`", call);
  }
  const responseKind = call.expression.name.text;
  if (responseKind === "text") {
    return {
      method: "GET",
      path: "/",
      response: {kind: "text", value: functions.lower(call.arguments[0]!)},
      span: spanOf(declaration, sourceFile),
    };
  }
  if (responseKind !== "html") {
    throw tinyError("TINY1111", "GET must return `Response.html(...)` or `Response.text(...)`", call);
  }
  const componentName = getInvokedComponent(call.arguments[0]!);
  const component = componentIds.get(componentName);
  if (component === undefined) {
    throw tinyError("TINY1200", `unknown component \`${componentName}\``, call.arguments[0]!);
  }
  return {
    method: "GET",
    path: "/",
    response: {kind: "html", component},
    span: spanOf(declaration, sourceFile),
  };
}

function getInvokedComponent(expression: ts.Expression): string {
  if (!ts.isJsxSelfClosingElement(expression) || !ts.isIdentifier(expression.tagName)) {
    throw tinyError(
      "TINY1112",
      "Response.html must receive one self-closing component invocation",
      expression,
    );
  }
  if (expression.attributes.properties.length > 0) {
    throw tinyError(
      "TINY1203",
      "component props are not supported by the first static slice",
      expression.attributes,
    );
  }
  return expression.tagName.text;
}

function isJsxRoot(expression: ts.Expression): expression is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  return ts.isJsxElement(expression)
    || ts.isJsxSelfClosingElement(expression)
    || ts.isJsxFragment(expression);
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}
