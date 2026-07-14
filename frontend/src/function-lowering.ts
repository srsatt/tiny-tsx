import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {Constant, HirFunction, ValueExpression} from "./hir.js";
import {StringTable} from "./hir.js";

export class FunctionLowerer {
  readonly #functions: Array<HirFunction | undefined> = [];
  readonly #ids = new Map<ts.FunctionDeclaration, number>();
  readonly #active = new Set<ts.FunctionDeclaration>();
  readonly #parameters = new Map<ts.ParameterDeclaration, {function: number; parameter: number}>();
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

  lower(expression: ts.Expression, currentFunction?: number): ValueExpression {
    const value = unwrap(expression);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return {
        kind: "stringLiteral",
        string: this.strings.intern(value.text),
        span: spanOf(value, value.getSourceFile()),
      };
    }
    if (ts.isIdentifier(value)) {
      const declaration = this.resolveDeclaration(value);
      if (declaration !== undefined && ts.isParameter(declaration)) {
        const parameter = this.#parameters.get(declaration);
        if (parameter === undefined || parameter.function !== currentFunction) {
          throw tinyError("TINY1308", "captured parameters require closure lowering", value);
        }
        return {
          kind: "parameter",
          parameter: parameter.parameter,
          span: spanOf(value, value.getSourceFile()),
        };
      }
      return this.lowerConstant(value);
    }
    if (ts.isCallExpression(value)) {
      if (!ts.isIdentifier(value.expression)) {
        throw tinyError(
          "TINY1301",
          "the function slice supports only direct calls to named declarations",
          value,
        );
      }
      const declaration = this.resolveDeclaration(value.expression);
      if (declaration === undefined || !ts.isFunctionDeclaration(declaration)) {
        throw tinyError("TINY1302", "call target must be a named function declaration", value.expression);
      }
      if (declaration.parameters.length > 4) {
        throw tinyError("TINY1309", "native string functions support at most four parameters", declaration);
      }
      if (value.arguments.length !== declaration.parameters.length) {
        throw tinyError(
          "TINY1310",
          `function \`${declaration.name?.text ?? "<anonymous>"}\` expects ${declaration.parameters.length} arguments`,
          value,
        );
      }
      const functionId = this.lowerFunction(declaration);
      return {
        kind: "directCall",
        function: functionId,
        arguments: value.arguments.map(argument => this.lower(argument, currentFunction)),
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
    if (declaration.name === undefined || declaration.parameters.length > 4) {
      throw tinyError("TINY1306", "lowered functions must be named and accept at most four parameters", declaration);
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
    const parameters = declaration.parameters.map((parameter, index) => {
      if (
        !ts.isIdentifier(parameter.name)
        || parameter.dotDotDotToken !== undefined
        || parameter.questionToken !== undefined
        || parameter.initializer !== undefined
        || (this.checker.getTypeAtLocation(parameter).flags & ts.TypeFlags.StringLike) === 0
      ) {
        throw tinyError("TINY1311", "native function parameters must be required strings", parameter);
      }
      this.#parameters.set(parameter, {function: id, parameter: index});
      return {
        name: parameter.name.text,
        type: "string" as const,
        span: spanOf(parameter, parameter.getSourceFile()),
      };
    });
    this.#active.add(declaration);
    const body = this.lower(statement.expression, id);
    this.#active.delete(declaration);
    this.#functions[id] = {
      id,
      module: declaration.getSourceFile().fileName,
      name: declaration.name.text,
      parameters,
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
