import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {Constant, HirFunction, ValueExpression} from "./hir.js";
import {StringTable} from "./hir.js";

export class FunctionLowerer {
  readonly #functions: Array<HirFunction | undefined> = [];
  readonly #ids = new Map<ts.FunctionDeclaration, number>();
  readonly #active = new Set<ts.FunctionDeclaration>();
  readonly #constants: ReadonlyMap<string, Constant>;

  constructor(
    readonly checker: ts.TypeChecker,
    constants: readonly Constant[],
    readonly strings: StringTable,
  ) {
    this.#constants = new Map(constants.map(constant => [
      bindingKey(constant.module, constant.name),
      constant,
    ]));
  }

  lower(expression: ts.Expression): ValueExpression {
    const value = unwrap(expression);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return {
        kind: "stringLiteral",
        string: this.strings.intern(value.text),
        span: spanOf(value, value.getSourceFile()),
      };
    }
    if (ts.isIdentifier(value)) {
      return this.lowerConstant(value);
    }
    if (ts.isCallExpression(value)) {
      if (value.arguments.length !== 0 || !ts.isIdentifier(value.expression)) {
        throw tinyError(
          "TINY1301",
          "the first function slice supports only zero-argument direct calls",
          value,
        );
      }
      const declaration = this.resolveDeclaration(value.expression);
      if (declaration === undefined || !ts.isFunctionDeclaration(declaration)) {
        throw tinyError("TINY1302", "call target must be a named function declaration", value.expression);
      }
      return {
        kind: "directCall",
        function: this.lowerFunction(declaration),
        arguments: [],
        span: spanOf(value, value.getSourceFile()),
      };
    }
    throw tinyError(
      "TINY1303",
      "string expressions support literals, closed string constants, and direct calls",
      value,
    );
  }

  finish(): HirFunction[] {
    return this.#functions.map((func, id) => {
      if (func === undefined) {
        throw new Error(`function ${id} was not completely lowered`);
      }
      return func;
    });
  }

  private lowerConstant(identifier: ts.Identifier): ValueExpression {
    const declaration = this.resolveDeclaration(identifier);
    if (
      declaration === undefined
      || !ts.isVariableDeclaration(declaration)
      || !ts.isIdentifier(declaration.name)
    ) {
      throw tinyError("TINY1304", "identifier must resolve to a closed string constant", identifier);
    }
    const constant = this.#constants.get(bindingKey(
      declaration.getSourceFile().fileName,
      declaration.name.text,
    ));
    if (constant?.value.kind !== "string") {
      throw tinyError("TINY1304", "identifier must resolve to a closed string constant", identifier);
    }
    return {
      kind: "constant",
      constant: constant.id,
      span: spanOf(identifier, identifier.getSourceFile()),
    };
  }

  private lowerFunction(declaration: ts.FunctionDeclaration): number {
    if (this.#active.has(declaration)) {
      throw tinyError("TINY1305", "recursive functions are not supported yet", declaration);
    }
    const existing = this.#ids.get(declaration);
    if (existing !== undefined) {
      return existing;
    }
    if (declaration.name === undefined || declaration.parameters.length !== 0) {
      throw tinyError("TINY1306", "lowered functions must be named and accept no parameters", declaration);
    }
    if (declaration.body?.statements.length !== 1) {
      throw tinyError("TINY1307", "a lowered function must contain one return statement", declaration);
    }
    const statement = declaration.body.statements[0]!;
    if (!ts.isReturnStatement(statement) || statement.expression === undefined) {
      throw tinyError("TINY1307", "a lowered function must contain one return statement", statement);
    }

    const id = this.#functions.length;
    this.#ids.set(declaration, id);
    this.#functions.push(undefined);
    this.#active.add(declaration);
    const body = this.lower(statement.expression);
    this.#active.delete(declaration);
    this.#functions[id] = {
      id,
      module: declaration.getSourceFile().fileName,
      name: declaration.name.text,
      parameters: [],
      result: "string",
      body,
      span: spanOf(declaration, declaration.getSourceFile()),
    };
    return id;
  }

  private resolveDeclaration(identifier: ts.Identifier): ts.Declaration | undefined {
    let symbol = this.checker.getSymbolAtLocation(identifier);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = this.checker.getAliasedSymbol(symbol);
    }
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }
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

function bindingKey(module: string, name: string): string {
  return `${module}\0${name}`;
}
