import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {Constant, HirFunction, ValueExpression} from "./hir.js";
import {StringTable} from "./hir.js";

export class FunctionLowerer {
  readonly #functions: Array<HirFunction | undefined> = [];
  readonly #ids = new Map<ts.FunctionDeclaration | ts.MethodDeclaration, number>();
  readonly #active = new Set<ts.FunctionDeclaration | ts.MethodDeclaration>();
  readonly #parameters = new Map<ts.ParameterDeclaration, {function: number; parameter: number}>();
  readonly #fields = new Map<number, ReadonlyMap<string, number>>();
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
    if (
      ts.isPropertyAccessExpression(value)
      && value.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const parameter = currentFunction === undefined
        ? undefined
        : this.#fields.get(currentFunction)?.get(value.name.text);
      if (parameter === undefined) {
        throw tinyError("TINY1312", "`this` property is not a closed constructor field", value);
      }
      return {
        kind: "parameter",
        parameter,
        span: spanOf(value, value.getSourceFile()),
      };
    }
    if (ts.isCallExpression(value)) {
      if (
        ts.isPropertyAccessExpression(value.expression)
        && ts.isNewExpression(value.expression.expression)
      ) {
        return this.lowerImmediateMethodCall(value, value.expression, currentFunction);
      }
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

  private lowerImmediateMethodCall(
    call: ts.CallExpression,
    access: ts.PropertyAccessExpression,
    currentFunction?: number,
  ): ValueExpression {
    const creation = access.expression as ts.NewExpression;
    if (!ts.isIdentifier(creation.expression)) {
      throw tinyError("TINY1313", "constructed class must be a named declaration", creation.expression);
    }
    const declaration = this.resolveDeclaration(creation.expression);
    if (declaration === undefined || !ts.isClassDeclaration(declaration) || declaration.name === undefined) {
      throw tinyError("TINY1313", "constructed class must be a named declaration", creation.expression);
    }
    if (declaration.heritageClauses !== undefined) {
      throw tinyError("TINY1314", "class inheritance is not supported in the closed class slice", declaration);
    }
    const constructor = declaration.members.find(ts.isConstructorDeclaration);
    if (constructor !== undefined && constructor.body?.statements.length !== 0) {
      throw tinyError("TINY1315", "closed class constructors must use parameter properties only", constructor);
    }
    const fields = constructor?.parameters ?? [];
    for (const field of fields) {
      if (!isRequiredStringParameter(this.checker, field) || ts.getModifiers(field)?.length === 0) {
        throw tinyError("TINY1315", "constructor fields must be required string parameter properties", field);
      }
    }
    const creationArguments = creation.arguments ?? [];
    if (creationArguments.length !== fields.length) {
      throw tinyError("TINY1316", "constructor argument count does not match its fields", creation);
    }
    const method = declaration.members.find(member =>
      ts.isMethodDeclaration(member)
      && ts.isIdentifier(member.name)
      && member.name.text === access.name.text
    );
    if (method === undefined || !ts.isMethodDeclaration(method)) {
      throw tinyError("TINY1317", `class has no method \`${access.name.text}\``, access.name);
    }
    if (call.arguments.length !== method.parameters.length) {
      throw tinyError("TINY1318", "method argument count does not match its parameters", call);
    }
    const functionId = this.lowerMethod(declaration, fields, method);
    return {
      kind: "directCall",
      function: functionId,
      arguments: [...creationArguments, ...call.arguments].map(argument =>
        this.lower(argument, currentFunction)
      ),
      span: spanOf(call, call.getSourceFile()),
    };
  }

  private lowerMethod(
    classDeclaration: ts.ClassDeclaration,
    fields: readonly ts.ParameterDeclaration[],
    method: ts.MethodDeclaration,
  ): number {
    if (this.#active.has(method)) {
      throw tinyError("TINY1305", "recursive methods are not supported yet", method);
    }
    const existing = this.#ids.get(method);
    if (existing !== undefined) {
      return existing;
    }
    if (!ts.isIdentifier(method.name) || fields.length + method.parameters.length > 4) {
      throw tinyError("TINY1319", "closed methods must be named and use at most four string values", method);
    }
    const statement = method.body?.statements.length === 1 ? method.body.statements[0] : undefined;
    if (statement === undefined || !ts.isReturnStatement(statement) || statement.expression === undefined) {
      throw tinyError("TINY1320", "closed methods must contain one return statement", method);
    }

    const id = this.#functions.length;
    this.#ids.set(method, id);
    this.#functions.push(undefined);
    const parameters = [...fields, ...method.parameters].map((parameter, index) => {
      if (!isRequiredStringParameter(this.checker, parameter) || !ts.isIdentifier(parameter.name)) {
        throw tinyError("TINY1311", "native method values must be required strings", parameter);
      }
      if (index >= fields.length) {
        this.#parameters.set(parameter, {function: id, parameter: index});
      }
      return {
        name: index < fields.length ? `this.${parameter.name.text}` : parameter.name.text,
        type: "string" as const,
        span: spanOf(parameter, parameter.getSourceFile()),
      };
    });
    this.#fields.set(id, new Map(fields.map((field, index) => [
      (field.name as ts.Identifier).text,
      index,
    ])));
    this.#active.add(method);
    const body = this.lower(statement.expression, id);
    this.#active.delete(method);
    this.#functions[id] = {
      id,
      module: method.getSourceFile().fileName,
      name: `${classDeclaration.name!.text}.${method.name.text}`,
      parameters,
      result: "string",
      body,
      span: spanOf(method, method.getSourceFile()),
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

function isRequiredStringParameter(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
): boolean {
  return ts.isIdentifier(parameter.name)
    && parameter.dotDotDotToken === undefined
    && parameter.questionToken === undefined
    && parameter.initializer === undefined
    && (checker.getTypeAtLocation(parameter).flags & ts.TypeFlags.StringLike) !== 0;
}
