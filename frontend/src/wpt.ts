import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface WptProgram {
  version: 3;
  target: "aarch64-apple-darwin";
  entry: string;
  tests: WptTest[];
}

export interface WptTest {
  name: string;
  slots: number;
  urlSlots: number;
  operations: WptOperation[];
  span: SourceSpan;
}

export type WptOperation =
  | UrlSearchParamsConstructOperation
  | UrlSearchParamsAppendOperation
  | UrlSearchParamsDeleteOperation
  | UrlSearchParamsAssertConstructedOperation
  | UrlSearchParamsAssertGetOperation
  | UrlSearchParamsAssertHasOperation
  | UrlSearchParamsAssertStringifiedOperation
  | UrlConstructOperation
  | UrlAssertStringifiedOperation;

interface ParamsOperationBase {
  slot: number;
  span: SourceSpan;
}

export interface UrlSearchParamsConstructOperation extends ParamsOperationBase {
  kind: "urlSearchParamsConstruct";
  input: string;
}

export interface UrlSearchParamsAppendOperation extends ParamsOperationBase {
  kind: "urlSearchParamsAppend";
  name: string;
  value: string;
}

export interface UrlSearchParamsDeleteOperation extends ParamsOperationBase {
  kind: "urlSearchParamsDelete";
  name: string;
  value?: string;
}

export interface UrlSearchParamsAssertConstructedOperation extends ParamsOperationBase {
  kind: "urlSearchParamsAssertConstructed";
  message?: string;
}

export interface UrlSearchParamsAssertGetOperation extends ParamsOperationBase {
  kind: "urlSearchParamsAssertGet";
  name: string;
  expected: string | null;
  message?: string;
}

export interface UrlSearchParamsAssertHasOperation extends ParamsOperationBase {
  kind: "urlSearchParamsAssertHas";
  name: string;
  value?: string;
  expected: boolean;
  message?: string;
}

export interface UrlSearchParamsAssertStringifiedOperation extends ParamsOperationBase {
  kind: "urlSearchParamsAssertStringified";
  expected: string;
  message?: string;
}

export interface UrlConstructOperation {
  kind: "urlConstruct";
  urlSlot: number;
  paramsSlot: number;
  input: string;
  span: SourceSpan;
}

export interface UrlAssertStringifiedOperation {
  kind: "urlAssertStringified";
  urlSlot: number;
  expected: string;
  message?: string;
  span: SourceSpan;
}

type WptVariable = ParamsVariable | UrlVariable;

interface ParamsVariable {
  kind: "params";
  slot: number;
}

interface UrlVariable {
  kind: "url";
  slot: number;
  paramsSlot: number;
}

interface LoweringState {
  variables: Map<string, WptVariable>;
  nextParamsSlot: number;
  nextUrlSlot: number;
  operations: WptOperation[];
}

interface MemberCall {
  receiver: WptVariable;
  method: string;
  arguments: readonly ts.Expression[];
}

export function compileWptEntry(entryPath: string): WptProgram {
  const entry = path.resolve(entryPath);
  let source: string;
  try {
    source = readFileSync(entry, "utf8");
  } catch (error) {
    throw new CompileFailure([{
      code: "TINYWPT0",
      message: `could not load WPT case ${entry}: ${String(error)}`,
    }]);
  }
  const sourceFile = ts.createSourceFile(entry, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {parseDiagnostics?: readonly ts.Diagnostic[]}
  ).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    throw new CompileFailure(parseDiagnostics.map(fromTypeScript));
  }

  const tests = sourceFile.statements.map(statement => lowerTest(statement, sourceFile));
  if (tests.length === 0 || tests.every(test => test.operations.length === 0)) {
    throw tinyError("TINYWPT1", "WPT case must contain an assertion", sourceFile, undefined, sourceFile);
  }
  return {version: 3, target: "aarch64-apple-darwin", entry, tests};
}

function lowerTest(statement: ts.Statement, sourceFile: ts.SourceFile): WptTest {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
    throw unsupported(statement, "top-level WPT test(...) calls", sourceFile);
  }
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "test" || call.arguments.length !== 2) {
    throw unsupported(call, "top-level WPT test(callback, name) calls", sourceFile);
  }
  const [callback, nameExpression] = call.arguments;
  const name = stringLiteral(nameExpression!, "WPT test name", sourceFile);
  if ((!ts.isFunctionExpression(callback!) && !ts.isArrowFunction(callback!)) || !ts.isBlock(callback!.body)) {
    throw unsupported(callback!, "WPT test callbacks with block bodies", sourceFile);
  }

  const state: LoweringState = {
    variables: new Map(),
    nextParamsSlot: 0,
    nextUrlSlot: 0,
    operations: [],
  };
  for (const callbackStatement of callback!.body.statements) {
    if (ts.isVariableStatement(callbackStatement)) {
      lowerVariable(callbackStatement, state, sourceFile);
    } else if (isAssignment(callbackStatement)) {
      lowerAssignment(callbackStatement.expression, state, sourceFile);
    } else if (ts.isExpressionStatement(callbackStatement) && ts.isCallExpression(callbackStatement.expression)) {
      const expression = callbackStatement.expression;
      state.operations.push(isAssertionCall(expression)
        ? lowerAssertion(expression, state.variables, sourceFile)
        : lowerMutation(expression, state.variables, sourceFile));
    } else {
      throw unsupported(callbackStatement, "URL/URLSearchParams declarations, assignments, mutations, and assertions", sourceFile);
    }
  }
  if (!state.operations.some(operation => operation.kind.includes("Assert"))) {
    throw tinyError("TINYWPT1", "WPT test must contain an assertion", call, undefined, sourceFile);
  }
  return {
    name,
    slots: state.nextParamsSlot,
    urlSlots: state.nextUrlSlot,
    operations: state.operations,
    span: spanOf(call, sourceFile),
  };
}

function lowerVariable(
  statement: ts.VariableStatement,
  state: LoweringState,
  sourceFile: ts.SourceFile,
): void {
  if (statement.declarationList.declarations.length !== 1) {
    throw unsupported(statement, "one URL or URLSearchParams declaration per statement", sourceFile);
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (!ts.isIdentifier(declaration.name)) {
    throw unsupported(declaration, "identifier bindings", sourceFile);
  }
  if (state.variables.has(declaration.name.text)) {
    throw tinyError("TINYWPT4", `duplicate WPT variable \`${declaration.name.text}\``, declaration.name, undefined, sourceFile);
  }

  const initializer = declaration.initializer;
  if (initializer === undefined) {
    state.variables.set(declaration.name.text, allocateParams(state));
    return;
  }
  if (isUrlSearchParamsConstruction(initializer)) {
    const variable = allocateParams(state);
    state.variables.set(declaration.name.text, variable);
    state.operations.push(constructParams(variable.slot, initializer, sourceFile));
    return;
  }
  if (isUrlConstruction(initializer)) {
    const variable = allocateUrl(state);
    state.variables.set(declaration.name.text, variable);
    state.operations.push(constructUrl(variable, initializer, sourceFile));
    return;
  }
  if (
    ts.isPropertyAccessExpression(initializer)
    && ts.isIdentifier(initializer.expression)
    && initializer.name.text === "searchParams"
  ) {
    const url = urlVariable(initializer.expression, state.variables, sourceFile);
    state.variables.set(declaration.name.text, {kind: "params", slot: url.paramsSlot});
    return;
  }
  throw unsupported(initializer, "URL/URLSearchParams construction or url.searchParams aliases", sourceFile);
}

function allocateParams(state: LoweringState): ParamsVariable {
  return {kind: "params", slot: state.nextParamsSlot++};
}

function allocateUrl(state: LoweringState): UrlVariable {
  return {
    kind: "url",
    slot: state.nextUrlSlot++,
    paramsSlot: state.nextParamsSlot++,
  };
}

function isAssignment(
  statement: ts.Statement,
): statement is ts.ExpressionStatement & {expression: ts.BinaryExpression} {
  return ts.isExpressionStatement(statement)
    && ts.isBinaryExpression(statement.expression)
    && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(statement.expression.left);
}

function lowerAssignment(
  assignment: ts.BinaryExpression,
  state: LoweringState,
  sourceFile: ts.SourceFile,
): void {
  const variable = paramsVariable(assignment.left as ts.Identifier, state.variables, sourceFile);
  state.operations.push(constructParams(variable.slot, assignment.right, sourceFile));
}

function isUrlSearchParamsConstruction(expression: ts.Expression): expression is ts.NewExpression {
  return ts.isNewExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "URLSearchParams";
}

function constructParams(
  slot: number,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): UrlSearchParamsConstructOperation {
  if (!isUrlSearchParamsConstruction(expression) || (expression.arguments?.length ?? 0) > 1) {
    throw unsupported(expression, "new URLSearchParams() or new URLSearchParams(string)", sourceFile);
  }
  const argument = expression.arguments?.[0];
  return {
    kind: "urlSearchParamsConstruct",
    slot,
    input: argument === undefined ? "" : stringLiteral(argument, "URLSearchParams input", sourceFile),
    span: spanOf(expression, sourceFile),
  };
}

function isUrlConstruction(expression: ts.Expression): expression is ts.NewExpression {
  return ts.isNewExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "URL";
}

function constructUrl(
  variable: UrlVariable,
  expression: ts.NewExpression,
  sourceFile: ts.SourceFile,
): UrlConstructOperation {
  if (expression.arguments?.length !== 1) {
    throw unsupported(expression, "new URL(string)", sourceFile);
  }
  return {
    kind: "urlConstruct",
    urlSlot: variable.slot,
    paramsSlot: variable.paramsSlot,
    input: stringLiteral(expression.arguments[0]!, "URL input", sourceFile),
    span: spanOf(expression, sourceFile),
  };
}

function isAssertionCall(call: ts.CallExpression): boolean {
  return ts.isIdentifier(call.expression)
    && ["assert_equals", "assert_true", "assert_false"].includes(call.expression.text);
}

function lowerMutation(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): UrlSearchParamsAppendOperation | UrlSearchParamsDeleteOperation {
  const operation = memberCall(call, variables, sourceFile);
  if (operation.receiver.kind !== "params") {
    throw unsupported(call, "URLSearchParams mutation", sourceFile);
  }
  if (operation.method === "append" && operation.arguments.length === 2) {
    return {
      kind: "urlSearchParamsAppend",
      slot: operation.receiver.slot,
      name: webIdlString(operation.arguments[0]!, sourceFile),
      value: webIdlString(operation.arguments[1]!, sourceFile),
      span: spanOf(call, sourceFile),
    };
  }
  if (operation.method === "delete" && operation.arguments.length >= 1 && operation.arguments.length <= 2) {
    const value = optionalWebIdlString(operation.arguments[1], sourceFile);
    return {
      kind: "urlSearchParamsDelete",
      slot: operation.receiver.slot,
      name: webIdlString(operation.arguments[0]!, sourceFile),
      ...(value === undefined ? {} : {value}),
      span: spanOf(call, sourceFile),
    };
  }
  throw unsupported(call, "URLSearchParams.append(name, value) or delete(name[, value])", sourceFile);
}

function lowerAssertion(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): WptOperation {
  if (!ts.isIdentifier(call.expression)) {
    throw unsupported(call, "assert_equals(...), assert_true(...), or assert_false(...)", sourceFile);
  }
  if (call.expression.text === "assert_equals" && call.arguments.length >= 2 && call.arguments.length <= 3) {
    return lowerEqualsAssertion(call, variables, sourceFile);
  }
  if (
    (call.expression.text === "assert_true" || call.expression.text === "assert_false")
    && call.arguments.length >= 1
    && call.arguments.length <= 2
  ) {
    return lowerBooleanAssertion(call, variables, sourceFile);
  }
  throw unsupported(call, "assert_equals(...), assert_true(...), or assert_false(...)", sourceFile);
}

function lowerEqualsAssertion(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): WptOperation {
  const message = optionalMessage(call.arguments[2], sourceFile);
  const actual = call.arguments[0]!;
  const expectedExpression = call.arguments[1]!;
  const operation = stringifierOperation(actual, variables, sourceFile);
  if (operation !== undefined) {
    const expected = stringLiteral(expectedExpression, "assert_equals expected value", sourceFile);
    if (operation.kind === "params") {
      return {
        kind: "urlSearchParamsAssertStringified",
        slot: operation.slot,
        expected,
        ...(message === undefined ? {} : {message}),
        span: spanOf(call, sourceFile),
      };
    }
    return {
      kind: "urlAssertStringified",
      urlSlot: operation.slot,
      expected,
      ...(message === undefined ? {} : {message}),
      span: spanOf(call, sourceFile),
    };
  }

  const member = memberCallExpression(actual, variables, sourceFile);
  if (member.receiver.kind !== "params" || member.method !== "get" || member.arguments.length !== 1) {
    throw unsupported(actual, "URLSearchParams.get(name) or URL/URLSearchParams stringification", sourceFile);
  }
  const expected = expectedExpression.kind === ts.SyntaxKind.NullKeyword
    ? null
    : stringLiteral(expectedExpression, "assert_equals expected value", sourceFile);
  return {
    kind: "urlSearchParamsAssertGet",
    slot: member.receiver.slot,
    name: webIdlString(member.arguments[0]!, sourceFile),
    expected,
    ...(message === undefined ? {} : {message}),
    span: spanOf(call, sourceFile),
  };
}

function stringifierOperation(
  expression: ts.Expression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): WptVariable | undefined {
  if (
    ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    && ts.isIdentifier(expression.left)
    && isEmptyString(expression.right)
  ) {
    const variable = variableOf(expression.left, variables, sourceFile);
    return variable.kind === "params" ? variable : undefined;
  }
  if (
    ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === "toString"
    && expression.arguments.length === 0
    && ts.isIdentifier(expression.expression.expression)
  ) {
    return variableOf(expression.expression.expression, variables, sourceFile);
  }
  return undefined;
}

function isEmptyString(expression: ts.Expression): boolean {
  return (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    && expression.text === "";
}

function lowerBooleanAssertion(
  call: ts.CallExpression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): WptOperation {
  const message = optionalMessage(call.arguments[1], sourceFile);
  const actual = call.arguments[0]!;
  if (
    call.expression.getText(sourceFile) === "assert_true"
    && ts.isBinaryExpression(actual)
    && actual.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    && ts.isIdentifier(actual.left)
    && actual.right.kind === ts.SyntaxKind.NullKeyword
  ) {
    const variable = paramsVariable(actual.left, variables, sourceFile);
    return {
      kind: "urlSearchParamsAssertConstructed",
      slot: variable.slot,
      ...(message === undefined ? {} : {message}),
      span: spanOf(call, sourceFile),
    };
  }
  const operation = memberCallExpression(actual, variables, sourceFile);
  if (operation.receiver.kind !== "params" || operation.method !== "has"
    || operation.arguments.length < 1 || operation.arguments.length > 2) {
    throw unsupported(actual, "URLSearchParams.has(name[, value]) assertions", sourceFile);
  }
  const value = optionalWebIdlString(operation.arguments[1], sourceFile);
  return {
    kind: "urlSearchParamsAssertHas",
    slot: operation.receiver.slot,
    name: webIdlString(operation.arguments[0]!, sourceFile),
    ...(value === undefined ? {} : {value}),
    expected: call.expression.getText(sourceFile) === "assert_true",
    ...(message === undefined ? {} : {message}),
    span: spanOf(call, sourceFile),
  };
}

function memberCallExpression(
  expression: ts.Expression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): MemberCall {
  if (ts.isCallExpression(expression)) {
    return memberCall(expression, variables, sourceFile);
  }
  throw unsupported(expression, "URLSearchParams method calls", sourceFile);
}

function memberCall(
  expression: ts.CallExpression,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): MemberCall {
  if (ts.isPropertyAccessExpression(expression.expression) && ts.isIdentifier(expression.expression.expression)) {
    return {
      receiver: variableOf(expression.expression.expression, variables, sourceFile),
      method: expression.expression.name.text,
      arguments: expression.arguments,
    };
  }
  throw unsupported(expression, "URLSearchParams method calls", sourceFile);
}

function variableOf(
  identifier: ts.Identifier,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): WptVariable {
  const variable = variables.get(identifier.text);
  if (variable === undefined) {
    throw tinyError("TINYWPT3", `unknown WPT variable \`${identifier.text}\``, identifier, undefined, sourceFile);
  }
  return variable;
}

function paramsVariable(
  identifier: ts.Identifier,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): ParamsVariable {
  const variable = variableOf(identifier, variables, sourceFile);
  if (variable.kind !== "params") {
    throw unsupported(identifier, "URLSearchParams variables", sourceFile);
  }
  return variable;
}

function urlVariable(
  identifier: ts.Identifier,
  variables: ReadonlyMap<string, WptVariable>,
  sourceFile: ts.SourceFile,
): UrlVariable {
  const variable = variableOf(identifier, variables, sourceFile);
  if (variable.kind !== "url") {
    throw unsupported(identifier, "URL variables", sourceFile);
  }
  return variable;
}

function optionalWebIdlString(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (expression === undefined || (ts.isIdentifier(expression) && expression.text === "undefined")) {
    return undefined;
  }
  return webIdlString(expression, sourceFile);
}

function webIdlString(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return String(Number(expression.text));
  if (ts.isBigIntLiteral(expression)) return expression.text.slice(0, -1);
  if (expression.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isIdentifier(expression) && expression.text === "undefined") return "undefined";
  throw unsupported(expression, "closed primitive Web IDL string conversion", sourceFile);
}

function optionalMessage(expression: ts.Expression | undefined, sourceFile: ts.SourceFile): string | undefined {
  return expression === undefined ? undefined : stringLiteral(expression, "assertion message", sourceFile);
}

function stringLiteral(expression: ts.Expression, role: string, sourceFile: ts.SourceFile): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  throw unsupported(expression, `${role} as a closed string`, sourceFile);
}

function unsupported(node: ts.Node, expected: string, sourceFile: ts.SourceFile): CompileFailure {
  return tinyError("TINYWPT2", `native WPT cases currently support only ${expected}`, node, undefined, sourceFile);
}
