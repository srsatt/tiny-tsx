import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {SourceSpan} from "./hir.js";

export interface MapProgramAssertion {
  kind: "mapProgram";
  capacity: 16;
  maps: number;
  operations: MapOperation[];
  span: SourceSpan;
}

export type MapPrimitive =
  | {kind: "undefined"}
  | {kind: "null"}
  | {kind: "boolean"; value: boolean}
  | {kind: "number"; value: number}
  | {kind: "numberSpecial"; value: "negativeZero" | "nan" | "positiveInfinity" | "negativeInfinity"}
  | {kind: "string"; value: string}
  | {kind: "symbol"; id: number; description?: string};

export type MapOperation =
  | {kind: "reset"; map: number; span: SourceSpan}
  | {kind: "set"; map: number; key: MapPrimitive; value: MapPrimitive; span: SourceSpan}
  | {kind: "delete"; map: number; key: MapPrimitive; span: SourceSpan}
  | {kind: "clear"; map: number; span: SourceSpan}
  | {kind: "assertSize"; map: number; expected: number; span: SourceSpan}
  | {kind: "assertGet"; map: number; key: MapPrimitive; expected: MapPrimitive; span: SourceSpan}
  | {kind: "assertHas"; map: number; key: MapPrimitive; expected: boolean; span: SourceSpan}
  | {kind: "assertDelete"; map: number; key: MapPrimitive; expected: boolean; span: SourceSpan};

export function isMapProgram(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(declaration =>
        declaration.initializer !== undefined && isEmptyMapConstruction(declaration.initializer)
      );
    }
    return ts.isExpressionStatement(statement)
      && ts.isBinaryExpression(statement.expression)
      && isEmptyMapConstruction(statement.expression.right);
  });
}

export function lowerMapProgram(sourceFile: ts.SourceFile): MapProgramAssertion {
  const maps = new Map<string, number>();
  const operations: MapOperation[] = [];
  let nextSymbol = 0;

  const primitive = (expression: ts.Expression): MapPrimitive => {
    const value = unwrap(expression);
    if (value.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(value) && value.text === "undefined")) {
      return {kind: "undefined"};
    }
    if (value.kind === ts.SyntaxKind.NullKeyword) return {kind: "null"};
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
      return {kind: "boolean", value: value.kind === ts.SyntaxKind.TrueKeyword};
    }
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      if (Buffer.byteLength(value.text, "utf8") > 256) {
        throw unsupported(value, sourceFile, "Map strings must be at most 256 UTF-8 bytes");
      }
      return {kind: "string", value: value.text};
    }
    if (ts.isNumericLiteral(value)) {
      const number = Number(value.text);
      if (!Number.isSafeInteger(number)) {
        throw unsupported(value, sourceFile, "Map finite numbers must be safe integers");
      }
      return {kind: "number", value: number};
    }
    if (
      ts.isPrefixUnaryExpression(value)
      && value.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(value.operand)
    ) {
      const number = -Number(value.operand.text);
      if (Object.is(number, -0)) return {kind: "numberSpecial", value: "negativeZero"};
      if (!Number.isSafeInteger(number)) {
        throw unsupported(value, sourceFile, "Map finite numbers must be safe integers");
      }
      return {kind: "number", value: number};
    }
    if (
      ts.isPrefixUnaryExpression(value)
      && value.operator === ts.SyntaxKind.PlusToken
      && ts.isNumericLiteral(value.operand)
    ) {
      const number = Number(value.operand.text);
      if (!Number.isSafeInteger(number)) {
        throw unsupported(value, sourceFile, "Map finite numbers must be safe integers");
      }
      return {kind: "number", value: number};
    }
    if (ts.isIdentifier(value) && value.text === "NaN") {
      return {kind: "numberSpecial", value: "nan"};
    }
    if (ts.isIdentifier(value) && value.text === "Infinity") {
      return {kind: "numberSpecial", value: "positiveInfinity"};
    }
    if (
      ts.isPrefixUnaryExpression(value)
      && value.operator === ts.SyntaxKind.MinusToken
      && ts.isIdentifier(value.operand)
      && value.operand.text === "Infinity"
    ) {
      return {kind: "numberSpecial", value: "negativeInfinity"};
    }
    if (
      ts.isCallExpression(value)
      && ts.isIdentifier(value.expression)
      && value.expression.text === "Symbol"
      && value.arguments.length <= 1
    ) {
      const description = value.arguments[0] === undefined
        ? undefined
        : primitive(value.arguments[0]);
      if (description !== undefined && description.kind !== "string") {
        throw unsupported(value, sourceFile, "Map Symbol descriptions must be closed strings");
      }
      if (nextSymbol >= 16) {
        throw unsupported(value, sourceFile, "Map programs support at most sixteen symbols");
      }
      return {
        kind: "symbol",
        id: nextSymbol++,
        ...(description === undefined ? {} : {description: description.value}),
      };
    }
    throw unsupported(value, sourceFile, "Map keys and values must be bounded primitives");
  };

  const mapId = (expression: ts.Expression): number => {
    const value = unwrap(expression);
    if (!ts.isIdentifier(value)) {
      throw unsupported(value, sourceFile, "Map receiver must be a local identifier");
    }
    const id = maps.get(value.text);
    if (id === undefined) throw unsupported(value, sourceFile, "Map receiver is not initialized");
    return id;
  };

  const reset = (name: ts.BindingName | ts.Expression, node: ts.Node): void => {
    if (!ts.isIdentifier(name)) {
      throw unsupported(node, sourceFile, "Map binding must be an identifier");
    }
    let id = maps.get(name.text);
    if (id === undefined) {
      if (maps.size >= 4) throw unsupported(node, sourceFile, "Map programs support at most four maps");
      id = maps.size;
      maps.set(name.text, id);
    }
    operations.push({kind: "reset", map: id, span: spanOf(node, sourceFile)});
  };

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.length !== 1) {
        throw unsupported(statement, sourceFile);
      }
      const declaration = statement.declarationList.declarations[0]!;
      if (declaration.initializer === undefined || !isEmptyMapConstruction(declaration.initializer)) {
        throw unsupported(statement, sourceFile);
      }
      reset(declaration.name, statement);
      continue;
    }
    if (ts.isExpressionStatement(statement)) {
      const expression = unwrap(statement.expression);
      if (
        ts.isBinaryExpression(expression)
        && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && isEmptyMapConstruction(expression.right)
      ) {
        reset(expression.left, statement);
        continue;
      }
      if (ts.isCallExpression(expression) && isAssertSameValue(expression)) {
        lowerAssertion(expression, statement);
        continue;
      }
      if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
        const map = mapId(expression.expression.expression);
        const method = expression.expression.name.text;
        if (method === "set" && expression.arguments.length === 2) {
          operations.push({
            kind: "set",
            map,
            key: primitive(expression.arguments[0]!),
            value: primitive(expression.arguments[1]!),
            span: spanOf(statement, sourceFile),
          });
          continue;
        }
        if (method === "delete" && expression.arguments.length === 1) {
          operations.push({
            kind: "delete",
            map,
            key: primitive(expression.arguments[0]!),
            span: spanOf(statement, sourceFile),
          });
          continue;
        }
        if (method === "clear" && expression.arguments.length === 0) {
          operations.push({kind: "clear", map, span: spanOf(statement, sourceFile)});
          continue;
        }
      }
    }
    throw unsupported(statement, sourceFile);
  }

  function lowerAssertion(call: ts.CallExpression, statement: ts.Statement): void {
    if (call.arguments.length < 2 || call.arguments.length > 3) {
      throw unsupported(call, sourceFile, "Map assertions require actual and expected values");
    }
    const actual = unwrap(call.arguments[0]!);
    const expected = primitive(call.arguments[1]!);
    if (ts.isPropertyAccessExpression(actual) && actual.name.text === "size") {
      if (expected.kind !== "number" || expected.value < 0 || expected.value > 16) {
        throw unsupported(call.arguments[1]!, sourceFile, "Map size expectation must be within 0..=16");
      }
      operations.push({
        kind: "assertSize",
        map: mapId(actual.expression),
        expected: expected.value,
        span: spanOf(statement, sourceFile),
      });
      return;
    }
    if (!ts.isCallExpression(actual) || !ts.isPropertyAccessExpression(actual.expression)) {
      throw unsupported(actual, sourceFile, "Map assertion must read a supported method or size");
    }
    const map = mapId(actual.expression.expression);
    const method = actual.expression.name.text;
    if (method === "get" && actual.arguments.length === 1) {
      operations.push({
        kind: "assertGet",
        map,
        key: primitive(actual.arguments[0]!),
        expected,
        span: spanOf(statement, sourceFile),
      });
      return;
    }
    if ((method === "has" || method === "delete") && actual.arguments.length === 1) {
      if (expected.kind !== "boolean") {
        throw unsupported(call.arguments[1]!, sourceFile, `Map ${method} expectation must be boolean`);
      }
      operations.push({
        kind: method === "has" ? "assertHas" : "assertDelete",
        map,
        key: primitive(actual.arguments[0]!),
        expected: expected.value,
        span: spanOf(statement, sourceFile),
      });
      return;
    }
    throw unsupported(actual, sourceFile, "unsupported Map assertion method");
  }

  if (maps.size === 0 || operations.every(operation => !operation.kind.startsWith("assert"))) {
    throw unsupported(sourceFile, sourceFile, "Map program must contain a complete assertion");
  }
  return {
    kind: "mapProgram",
    capacity: 16,
    maps: maps.size,
    operations,
    span: spanOf(sourceFile, sourceFile),
  };
}

function isEmptyMapConstruction(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  return ts.isNewExpression(value)
    && ts.isIdentifier(value.expression)
    && value.expression.text === "Map"
    && (value.arguments?.length ?? 0) === 0;
}

function isAssertSameValue(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression)
    && call.expression.expression.text === "assert"
    && call.expression.name.text === "sameValue";
}

function unwrap<T extends ts.Expression>(expression: T): ts.Expression {
  let value: ts.Expression = expression;
  while (ts.isParenthesizedExpression(value)) value = value.expression;
  return value;
}

function unsupported(node: ts.Node, sourceFile: ts.SourceFile, detail?: string): Error {
  return tinyError(
    "TINY2614",
    detail ?? "native Test262 Map supports empty construction and bounded primitive set/get/has/delete/clear/size",
    node,
    undefined,
    sourceFile,
  );
}
