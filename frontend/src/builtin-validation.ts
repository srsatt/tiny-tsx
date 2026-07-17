import ts from "typescript";
import path from "node:path";
import {CompileFailure, spanOf, type Diagnostic} from "./diagnostics.js";
import type {ModuleGraph} from "./module-graph.js";

const unavailableBuiltins = new Set<string>();

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENVIRONMENT_NAME_BYTES = 128;

interface ImportedOperation {
  specifier: string;
  operation: string;
}

type BuiltinResource = "actor" | "database" | "statement";

/** Validates protected built-ins before symbolic application execution. */
export function validateBuiltinOperations(
  graph: ModuleGraph,
  allowedEnvironment: ReadonlySet<string>,
  allowedReadRoots: readonly string[],
  allowedWriteRoots: readonly string[],
): void {
  const diagnostics: Diagnostic[] = [];
  for (const module of graph.modules) {
    const named = new Map<string, ImportedOperation>();
    const namespaces = new Map<string, string>();
    for (const statement of module.sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || (!["tinytsx:env", "tinytsx:fs", "tinytsx:sqlite", "tinytsx:actors"].includes(statement.moduleSpecifier.text)
          && !unavailableBuiltins.has(statement.moduleSpecifier.text))
      ) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) {
        namespaces.set(bindings.name.text, statement.moduleSpecifier.text);
      } else {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          named.set(element.name.text, {
            specifier: statement.moduleSpecifier.text,
            operation: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    }
    const resources = collectResourceBindings(module.sourceFile, named, namespaces);
    const visit = (node: ts.Node): void => {
      const imported = ts.isCallExpression(node) || ts.isNewExpression(node)
        ? importedInvocation(node, named, namespaces)
        : undefined;
      if (imported !== undefined) {
        const invocation = ts.isCallExpression(node) || ts.isNewExpression(node) ? node : undefined;
        if (unavailableBuiltins.has(imported.specifier)) {
          diagnostics.push({
            code: "TINY1500",
            message: `built-in operation \`${imported.specifier}.${imported.operation}\` is declared but has no native implementation yet`,
            span: spanOf(node, module.sourceFile),
            help: "run `tinytsx --list-builtins` and require status `native` before using an operation",
          });
        } else if (imported.specifier === "tinytsx:env") {
          const argument = invocation?.arguments?.[0];
          const name = argument !== undefined && ts.isStringLiteral(argument)
            ? argument.text
            : undefined;
          if (
            !["get", "require"].includes(imported.operation)
            || invocation?.arguments?.length !== 1
            || name === undefined
            || !ENVIRONMENT_NAME.test(name)
            || Buffer.byteLength(name, "utf8") > MAX_ENVIRONMENT_NAME_BYTES
          ) {
            diagnostics.push({
              code: "TINY1504",
              message: `built-in operation \`tinytsx:env.${imported.operation}\` requires one static portable environment name`,
              span: spanOf(node, module.sourceFile),
              help: "use get(\"NAME\") or require(\"NAME\") with an ASCII name up to 128 bytes",
            });
          } else if (!allowedEnvironment.has(name)) {
            diagnostics.push({
              code: "TINY1501",
              message: `environment variable \`${name}\` requires an explicit capability`,
              span: spanOf(node, module.sourceFile),
              help: `re-run with \`--allow-env ${name}\``,
            });
          }
        } else if (imported.specifier === "tinytsx:fs") {
          validateFilesystemCall(
            diagnostics,
            imported,
            invocation,
            node,
            module.sourceFile,
            allowedReadRoots,
          );
        } else if (imported.specifier === "tinytsx:sqlite" && imported.operation === "Database") {
          validateSqliteDatabase(
            diagnostics,
            invocation,
            node,
            module.sourceFile,
            allowedReadRoots,
            allowedWriteRoots,
          );
        } else if (imported.specifier === "tinytsx:actors" && imported.operation === "spawn") {
          validateActorSpawn(diagnostics, invocation, node, module.sourceFile, resources);
        } else if (imported.specifier === "tinytsx:sqlite") {
          addDiagnostic(
            diagnostics,
            "TINY1512",
            `SQLite operation \`tinytsx:sqlite.${imported.operation}\` is outside the alpha surface`,
            node,
            module.sourceFile,
            "use Database and its declared methods from `tinytsx --list-builtins`",
          );
        } else if (imported.specifier === "tinytsx:actors") {
          addDiagnostic(
            diagnostics,
            "TINY1520",
            `actor operation \`tinytsx:actors.${imported.operation}\` is outside the alpha surface`,
            node,
            module.sourceFile,
            "use spawn and CounterActorRef from `tinytsx --list-builtins`",
          );
        }
      } else if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
      ) {
        const resource = resources.get(node.expression.expression.text);
        if (resource !== undefined) {
          validateResourceCall(diagnostics, resource, node, module.sourceFile, resources);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  if (diagnostics.length > 0) throw new CompileFailure(diagnostics);
}

function importedInvocation(
  invocation: ts.CallExpression | ts.NewExpression,
  named: ReadonlyMap<string, ImportedOperation>,
  namespaces: ReadonlyMap<string, string>,
): ImportedOperation | undefined {
  if (ts.isIdentifier(invocation.expression)) {
    return named.get(invocation.expression.text);
  }
  if (
    ts.isPropertyAccessExpression(invocation.expression)
    && ts.isIdentifier(invocation.expression.expression)
  ) {
    const specifier = namespaces.get(invocation.expression.expression.text);
    if (specifier !== undefined) {
      return {specifier, operation: invocation.expression.name.text};
    }
  }
  return undefined;
}

function collectResourceBindings(
  sourceFile: ts.SourceFile,
  named: ReadonlyMap<string, ImportedOperation>,
  namespaces: ReadonlyMap<string, string>,
): Map<string, BuiltinResource> {
  const declarations: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const resources = new Map<string, BuiltinResource>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const name = declaration.name.text;
      if (resources.has(name)) continue;
      const initializer = declaration.initializer;
      if (ts.isCallExpression(initializer) || ts.isNewExpression(initializer)) {
        const imported = importedInvocation(initializer, named, namespaces);
        if (imported?.specifier === "tinytsx:sqlite" && imported.operation === "Database") {
          resources.set(name, "database");
          changed = true;
          continue;
        }
        if (imported?.specifier === "tinytsx:actors" && imported.operation === "spawn") {
          resources.set(name, "actor");
          changed = true;
          continue;
        }
      }
      if (
        ts.isCallExpression(initializer)
        && ts.isPropertyAccessExpression(initializer.expression)
        && ts.isIdentifier(initializer.expression.expression)
        && resources.get(initializer.expression.expression.text) === "database"
        && initializer.expression.name.text === "prepare"
      ) {
        resources.set(name, "statement");
        changed = true;
      }
    }
  }
  return resources;
}

function validateResourceCall(
  diagnostics: Diagnostic[],
  resource: BuiltinResource,
  invocation: ts.CallExpression,
  sourceFile: ts.SourceFile,
  resources: ReadonlyMap<string, BuiltinResource>,
): void {
  const member = invocation.expression;
  if (!ts.isPropertyAccessExpression(member)) return;
  const operation = member.name.text;
  if (resource === "database") {
    if (["exec", "prepare"].includes(operation)) {
      const sql = invocation.arguments[0];
      const value = sql === undefined ? undefined : staticString(sql);
      if (
        invocation.arguments.length !== 1
        || value === undefined
        || Buffer.byteLength(value, "utf8") > 65_536
      ) {
        addDiagnostic(
          diagnostics,
          "TINY1512",
          `Database.${operation} requires one static SQL string up to 65536 bytes`,
          invocation,
          sourceFile,
        );
      }
      return;
    }
    if (operation === "transaction") {
      const argument = invocation.arguments[0];
      const sql = argument === undefined ? undefined : staticString(argument);
      if (
        invocation.arguments.length !== 1
        || (
          (sql === undefined || Buffer.byteLength(sql, "utf8") > 65_536)
          && !validSqliteTransactionCallback(
            argument,
            resources,
            ts.isIdentifier(member.expression) ? member.expression.text : undefined,
            sourceFile,
          )
        )
      ) {
        addDiagnostic(
          diagnostics,
          "TINY1512",
          "Database.transaction requires one static SQL string or a bounded async Statement.run callback",
          invocation,
          sourceFile,
        );
      }
      return;
    }
    if (["close", "dispose"].includes(operation)) {
      if (invocation.arguments.length !== 0) {
        addDiagnostic(diagnostics, "TINY1512", `Database.${operation} does not accept arguments`, invocation, sourceFile);
      }
      return;
    }
    addDiagnostic(
      diagnostics,
      "TINY1512",
      `SQLite operation \`Database.${operation}\` is outside the alpha surface`,
      invocation,
      sourceFile,
      "use prepare, exec, transaction, close, or dispose from `tinytsx --list-builtins`",
    );
    return;
  }

  if (resource === "statement") {
    if (["all", "get", "run"].includes(operation)) {
      if (!validSqliteParameters(invocation.arguments)) {
        addDiagnostic(
          diagnostics,
          "TINY1512",
          `Statement.${operation} accepts one static array of at most 16 alpha parameters`,
          invocation,
          sourceFile,
        );
      }
      return;
    }
    if (["close", "dispose"].includes(operation)) {
      if (invocation.arguments.length !== 0) {
        addDiagnostic(diagnostics, "TINY1512", `Statement.${operation} does not accept arguments`, invocation, sourceFile);
      }
      return;
    }
    addDiagnostic(
      diagnostics,
      "TINY1512",
      `SQLite operation \`Statement.${operation}\` is outside the alpha surface`,
      invocation,
      sourceFile,
    );
    return;
  }

  if (["ask", "tell"].includes(operation)) {
    const message = invocation.arguments[0];
    if (
      invocation.arguments.length < 1
      || invocation.arguments.length > (operation === "ask" ? 2 : 1)
      || message === undefined
      || !isStaticActorValue(message)
      || operation === "ask" && !validActorAskOptions(invocation.arguments[1])
    ) {
      addDiagnostic(
        diagnostics,
        "TINY1521",
        operation === "ask"
          ? "ActorRef.ask requires one bounded static message and optional timeoutMs from 1 through 60000"
          : "ActorRef.tell requires one bounded static message",
        invocation,
        sourceFile,
      );
    }
    return;
  }
  if (["stop", "dispose"].includes(operation)) {
    if (invocation.arguments.length !== 0) {
      addDiagnostic(diagnostics, "TINY1521", `CounterActorRef.${operation} does not accept arguments`, invocation, sourceFile);
    }
    return;
  }
  addDiagnostic(
    diagnostics,
    "TINY1521",
    `actor operation \`CounterActorRef.${operation}\` is outside the alpha surface`,
    invocation,
    sourceFile,
    "use ask, tell, stop, or dispose from `tinytsx --list-builtins`",
  );
}

function validActorAskOptions(options: ts.Expression | undefined): boolean {
  if (options === undefined) return true;
  if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 1) return false;
  const property = options.properties[0];
  if (
    property === undefined
    || !ts.isPropertyAssignment(property)
    || property.name.getText() !== "timeoutMs"
  ) return false;
  const timeout = staticInteger(property.initializer);
  return timeout !== undefined && timeout >= 1 && timeout <= 60_000;
}

function validateActorSpawn(
  diagnostics: Diagnostic[],
  invocation: ts.CallExpression | ts.NewExpression | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  resources: ReadonlyMap<string, BuiltinResource>,
): void {
  const arguments_ = invocation?.arguments;
  const behavior = arguments_?.[0];
  const initialState = arguments_?.[1];
  const options = arguments_?.[2];
  const fallibleBehavior = behavior !== undefined && isFallibleCounterBehavior(behavior);
  const restartConfigured = hasActorOption(options, "restart");
  const persistenceConfigured = hasActorOption(options, "persistence");
  const validBehavior = behavior !== undefined
    && (ts.isIdentifier(behavior)
      || isCounterBehavior(behavior)
      || isFallibleCounterBehavior(behavior)
      || isJsonMailboxBehavior(behavior));
  if (
    arguments_ === undefined
    || arguments_.length < 2
    || arguments_.length > 3
    || !validBehavior
    || initialState === undefined
    || !isStaticActorValue(initialState)
    || !validActorOptions(options, resources)
    || behavior !== undefined
      && !ts.isIdentifier(behavior)
      && (fallibleBehavior !== restartConfigured || fallibleBehavior && persistenceConfigured)
  ) {
    addDiagnostic(
      diagnostics,
      "TINY1520",
      "actor spawn requires a bounded counter or JSON-mailbox behavior, static state, and mailbox capacity 1..64",
      node,
      sourceFile,
      "use spawn((context, delta) => { context.state += delta; return String(context.state) }, initialState, options)",
    );
  }
}

function hasActorOption(options: ts.Expression | undefined, name: string): boolean {
  return options !== undefined
    && ts.isObjectLiteralExpression(options)
    && options.properties.some(property => ts.isPropertyAssignment(property)
      && ts.isIdentifier(property.name)
      && property.name.text === name);
}

function isJsonMailboxBehavior(expression: ts.Expression): boolean {
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return false;
  if (expression.parameters.length !== 2 || !ts.isBlock(expression.body)) return false;
  const context = expression.parameters[0]?.name;
  const message = expression.parameters[1]?.name;
  if (!context || !message || !ts.isIdentifier(context) || !ts.isIdentifier(message)) return false;
  const [assignment, returned] = expression.body.statements;
  return expression.body.statements.length === 2
    && assignment !== undefined
    && ts.isExpressionStatement(assignment)
    && ts.isBinaryExpression(assignment.expression)
    && assignment.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && isStateAccess(assignment.expression.left, context.text)
    && ts.isIdentifier(assignment.expression.right)
    && assignment.expression.right.text === message.text
    && returned !== undefined
    && ts.isReturnStatement(returned)
    && returned.expression !== undefined
    && ts.isCallExpression(returned.expression)
    && ts.isPropertyAccessExpression(returned.expression.expression)
    && ts.isIdentifier(returned.expression.expression.expression)
    && returned.expression.expression.expression.text === "JSON"
    && returned.expression.expression.name.text === "stringify"
    && returned.expression.arguments.length === 1
    && isStateAccess(returned.expression.arguments[0]!, context.text);
}

function isStaticActorValue(expression: ts.Expression, depth = 0): boolean {
  const json = staticActorJson(expression, depth);
  return json !== undefined && Buffer.byteLength(json, "utf8") <= 4_096;
}

function staticActorJson(expression: ts.Expression, depth: number): string | undefined {
  if (depth > 8) return undefined;
  const value = ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
    ? expression.expression
    : expression;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return Buffer.byteLength(value.text, "utf8") <= 1_024
      ? JSON.stringify(value.text)
      : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (value.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (value.kind === ts.SyntaxKind.NullKeyword) return "null";
  const integer = staticInteger(value);
  if (integer !== undefined) return JSON.stringify(integer);
  if (ts.isArrayLiteralExpression(value)) {
    if (value.elements.length > 64 || value.elements.some(ts.isSpreadElement)) return undefined;
    const items = value.elements.map(element => staticActorJson(element, depth + 1));
    return items.some(item => item === undefined) ? undefined : `[${items.join(",")}]`;
  }
  if (!ts.isObjectLiteralExpression(value) || value.properties.length > 32) return undefined;
  const fields: string[] = [];
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = staticActorFieldName(property.name);
    const field = staticActorJson(property.initializer, depth + 1);
    if (name === undefined || Buffer.byteLength(name, "utf8") > 128 || field === undefined) {
      return undefined;
    }
    fields.push(`${JSON.stringify(name)}:${field}`);
  }
  return `{${fields.join(",")}}`;
}

function staticActorFieldName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function validActorOptions(
  options: ts.Expression | undefined,
  resources: ReadonlyMap<string, BuiltinResource>,
): boolean {
  if (options === undefined) return true;
  if (!ts.isObjectLiteralExpression(options)) return false;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return false;
    if (property.name.text === "mailboxCapacity") {
      const capacity = staticInteger(property.initializer);
      if (capacity === undefined || capacity < 1 || capacity > 64) return false;
    } else if (property.name.text === "persistence") {
      if (!validActorPersistence(property.initializer, resources)) return false;
    } else if (property.name.text === "restart") {
      if (!validActorRestart(property.initializer)) return false;
    } else {
      return false;
    }
  }
  return true;
}

function validActorRestart(expression: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expression) || expression.properties.length !== 2) return false;
  let maxRestarts: number | undefined;
  let withinMs: number | undefined;
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return false;
    if (property.name.text === "maxRestarts") {
      maxRestarts = staticInteger(property.initializer);
    } else if (property.name.text === "withinMs") {
      withinMs = staticInteger(property.initializer);
    } else {
      return false;
    }
  }
  return maxRestarts !== undefined
    && maxRestarts >= 1
    && maxRestarts <= 16
    && withinMs !== undefined
    && withinMs >= 1
    && withinMs <= 60_000;
}

function validActorPersistence(
  expression: ts.Expression,
  resources: ReadonlyMap<string, BuiltinResource>,
): boolean {
  if (!ts.isObjectLiteralExpression(expression) || expression.properties.length !== 2) return false;
  let database = false;
  let key = false;
  for (const property of expression.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text !== "database") return false;
      database = resources.get(property.name.text) === "database";
      continue;
    }
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return false;
    if (property.name.text === "database") {
      database = ts.isIdentifier(property.initializer)
        && resources.get(property.initializer.text) === "database";
    } else if (property.name.text === "key") {
      const value = staticString(property.initializer);
      key = value !== undefined && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128;
    } else {
      return false;
    }
  }
  return database && key;
}

function isCounterBehavior(expression: ts.Expression): boolean {
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return false;
  if (expression.parameters.length !== 2 || !ts.isBlock(expression.body)) return false;
  const context = expression.parameters[0]?.name;
  const message = expression.parameters[1]?.name;
  if (!context || !message || !ts.isIdentifier(context) || !ts.isIdentifier(message)) return false;
  return isCounterStatements(expression.body.statements, context.text, message.text);
}

function isFallibleCounterBehavior(expression: ts.Expression): boolean {
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) return false;
  if (expression.parameters.length !== 2 || !ts.isBlock(expression.body)) return false;
  const context = expression.parameters[0]?.name;
  const message = expression.parameters[1]?.name;
  if (!context || !message || !ts.isIdentifier(context) || !ts.isIdentifier(message)) return false;
  const [failure, ...counter] = expression.body.statements;
  return failure !== undefined
    && ts.isIfStatement(failure)
    && failure.elseStatement === undefined
    && ts.isBinaryExpression(failure.expression)
    && failure.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isIdentifier(failure.expression.left)
    && failure.expression.left.text === message.text
    && staticInteger(failure.expression.right) !== undefined
    && ts.isThrowStatement(failure.thenStatement)
    && failure.thenStatement.expression !== undefined
    && ts.isCallExpression(failure.thenStatement.expression)
    && ts.isIdentifier(failure.thenStatement.expression.expression)
    && failure.thenStatement.expression.expression.text === "Error"
    && failure.thenStatement.expression.arguments.length === 1
    && ts.isStringLiteral(failure.thenStatement.expression.arguments[0]!)
    && isCounterStatements(counter, context.text, message.text);
}

function isCounterStatements(
  statements: readonly ts.Statement[],
  context: string,
  message: string,
): boolean {
  const [update, returned] = statements;
  return statements.length === 2
    && update !== undefined
    && ts.isExpressionStatement(update)
    && ts.isBinaryExpression(update.expression)
    && update.expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
    && isStateAccess(update.expression.left, context)
    && ts.isIdentifier(update.expression.right)
    && update.expression.right.text === message
    && returned !== undefined
    && ts.isReturnStatement(returned)
    && returned.expression !== undefined
    && ts.isCallExpression(returned.expression)
    && ts.isIdentifier(returned.expression.expression)
    && returned.expression.expression.text === "String"
    && returned.expression.arguments.length === 1
    && isStateAccess(returned.expression.arguments[0]!, context);
}

function isStateAccess(expression: ts.Expression, context: string): boolean {
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === context
    && expression.name.text === "state";
}

function validSqliteTransactionCallback(
  expression: ts.Expression | undefined,
  resources: ReadonlyMap<string, BuiltinResource>,
  database: string | undefined,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    expression === undefined
    || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))
    || expression.parameters.length !== 0
    || !expression.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    || !ts.isBlock(expression.body)
    || expression.body.statements.length === 0
    || expression.body.statements.length > 16
  ) {
    return false;
  }
  let parameterCount = 0;
  for (const statement of expression.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) {
      return false;
    }
    const invocation = statement.expression.expression;
    if (
      !ts.isCallExpression(invocation)
      || !ts.isPropertyAccessExpression(invocation.expression)
      || invocation.expression.name.text !== "run"
      || !ts.isIdentifier(invocation.expression.expression)
      || resources.get(invocation.expression.expression.text) !== "statement"
      || statementDatabase(invocation.expression.expression.text, sourceFile) !== database
      || !validSqliteParameters(invocation.arguments)
    ) {
      return false;
    }
    const parameters = invocation.arguments[0];
    parameterCount += parameters !== undefined && ts.isArrayLiteralExpression(parameters)
      ? parameters.elements.length
      : 0;
  }
  return parameterCount <= 64;
}

function statementDatabase(statement: string, sourceFile: ts.SourceFile): string | undefined {
  let database: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      database === undefined
      && ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === statement
      && node.initializer !== undefined
      && ts.isCallExpression(node.initializer)
      && ts.isPropertyAccessExpression(node.initializer.expression)
      && node.initializer.expression.name.text === "prepare"
      && ts.isIdentifier(node.initializer.expression.expression)
    ) {
      database = node.initializer.expression.expression.text;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return database;
}

function validSqliteParameters(arguments_: ts.NodeArray<ts.Expression>): boolean {
  if (arguments_.length === 0) return true;
  if (arguments_.length !== 1 || !ts.isArrayLiteralExpression(arguments_[0]!)) return false;
  const elements = arguments_[0]!.elements;
  return elements.length <= 16 && elements.every(element => !ts.isSpreadElement(element));
}

function staticString(expression: ts.Expression): string | undefined {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined;
}

function staticInteger(expression: ts.Expression): number | undefined {
  let value: number;
  if (ts.isNumericLiteral(expression)) {
    value = Number(expression.text);
  } else if (
    ts.isPrefixUnaryExpression(expression)
    && (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken)
    && ts.isNumericLiteral(expression.operand)
  ) {
    value = Number(expression.operand.text) * (expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
  } else {
    return undefined;
  }
  return Number.isSafeInteger(value) ? value : undefined;
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  code: string,
  message: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  help?: string,
): void {
  diagnostics.push({
    code,
    message,
    span: spanOf(node, sourceFile),
    ...(help === undefined ? {} : {help}),
  });
}

function validateSqliteDatabase(
  diagnostics: Diagnostic[],
  invocation: ts.CallExpression | ts.NewExpression | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  allowedReadRoots: readonly string[],
  allowedWriteRoots: readonly string[],
): void {
  const argument = invocation?.arguments?.[0];
  const database = argument !== undefined && ts.isStringLiteral(argument) ? argument.text : undefined;
  if (invocation?.arguments?.length !== 1 || database === undefined) {
    diagnostics.push({
      code: "TINY1510",
      message: "`tinytsx:sqlite.Database` requires one static path string",
      span: spanOf(node, sourceFile),
    });
    return;
  }
  if (database === ":memory:") return;
  const portable = database.length > 0
    && Buffer.byteLength(database, "utf8") <= 4096
    && !database.includes("\0")
    && !path.isAbsolute(database)
    && database.split(/[\\/]/).every(component =>
      component !== "" && component !== "." && component !== ".."
    );
  if (!portable) {
    diagnostics.push({
      code: "TINY1510",
      message: `SQLite path \`${database}\` must be a static normalized relative path`,
      span: spanOf(argument ?? node, sourceFile),
    });
  } else if (allowedReadRoots.length === 0 || allowedWriteRoots.length === 0) {
    diagnostics.push({
      code: "TINY1511",
      message: `SQLite path \`${database}\` requires explicit read and write capabilities`,
      span: spanOf(argument ?? node, sourceFile),
      help: "re-run with matching `--allow-read <root>` and `--allow-write <root>`",
    });
  }
}

function validateFilesystemCall(
  diagnostics: Diagnostic[],
  imported: ImportedOperation,
  invocation: ts.CallExpression | ts.NewExpression | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  allowedReadRoots: readonly string[],
): void {
  const argument = invocation?.arguments?.[0];
  const file = argument !== undefined && ts.isStringLiteral(argument) ? argument.text : undefined;
  const portable = file !== undefined
    && file.length > 0
    && Buffer.byteLength(file, "utf8") <= 4096
    && !file.includes("\0")
    && !path.isAbsolute(file)
    && file.split(/[\\/]/).every(component => component !== "" && component !== "." && component !== "..");
  const options = invocation?.arguments?.[1];
  const maxBytes = options === undefined ? 1_048_576 : staticMaxBytes(options);
  if (
    imported.operation !== "readTextFile"
    || invocation?.arguments === undefined
    || invocation.arguments.length < 1
    || invocation.arguments.length > 2
    || !portable
    || maxBytes === undefined
  ) {
    diagnostics.push({
      code: "TINY1504",
      message: "`tinytsx:fs.readTextFile` requires a static normalized relative path and optional bounded maxBytes",
      span: spanOf(node, sourceFile),
      help: "use readTextFile(\"path/file.txt\", {maxBytes: 1048576}) without empty, dot, or parent segments",
    });
  } else if (allowedReadRoots.length === 0) {
    diagnostics.push({
      code: "TINY1502",
      message: `filesystem path \`${file}\` requires an explicit read capability`,
      span: spanOf(node, sourceFile),
      help: "re-run with `--allow-read <root>`",
    });
  }
}

function staticMaxBytes(expression: ts.Expression): number | undefined {
  if (!ts.isObjectLiteralExpression(expression)) return undefined;
  if (expression.properties.length === 0) return 1_048_576;
  if (expression.properties.length !== 1) return undefined;
  const property = expression.properties[0];
  if (
    property === undefined
    || !ts.isPropertyAssignment(property)
    || property.name.getText() !== "maxBytes"
    || !ts.isNumericLiteral(property.initializer)
  ) return undefined;
  const value = Number(property.initializer.text);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_048_576 ? value : undefined;
}
