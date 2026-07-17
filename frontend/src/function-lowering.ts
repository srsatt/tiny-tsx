import ts from "typescript";
import {spanOf, tinyError} from "./diagnostics.js";
import type {Constant, FunctionParameter, HirFunction, ValueExpression} from "./hir.js";
import {StringTable} from "./hir.js";

type LoweredFunction =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

type NativeValueType = FunctionParameter["type"];

interface ClosureBinding {
  owner: number;
  declaration: ts.VariableDeclaration;
  function: ts.ArrowFunction | ts.FunctionExpression;
}

interface Capture {
  declaration: ts.Declaration;
  argument: ValueExpression;
  parameter: number;
}

interface FunctionContext {
  name: string;
  parent?: number;
  parameters: FunctionParameter[];
  captures: Capture[];
}

type FunctionCompletion =
  | {kind: "return"; expression: ts.Expression}
  | {kind: "throw"; expression: ts.Expression};

export class FunctionLowerer {
  readonly #functions: Array<HirFunction | undefined> = [];
  readonly #ids = new Map<LoweredFunction, number>();
  readonly #active = new Set<LoweredFunction>();
  readonly #parameters = new Map<ts.ParameterDeclaration, {function: number; parameter: number}>();
  readonly #locals = new Map<ts.VariableDeclaration, {function: number; value: ValueExpression}>();
  readonly #closures = new Map<ts.VariableDeclaration, ClosureBinding>();
  readonly #contexts = new Map<number, FunctionContext>();
  readonly #caught = new Map<ts.VariableDeclaration, number>();
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
    if (ts.isNumericLiteral(value)) {
      const number = Number(value.text);
      if (!Number.isSafeInteger(number)) {
        throw tinyError("TINY1327", "native numeric literals must be safe integers", value);
      }
      return {
        kind: "numericLiteral",
        value: number,
        span: spanOf(value, value.getSourceFile()),
      };
    }
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        kind: "booleanLiteral",
        value: value.kind === ts.SyntaxKind.TrueKeyword,
        span: spanOf(value, value.getSourceFile()),
      };
    }
    if (
      ts.isBinaryExpression(value)
      && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(value.operatorToken.kind)
    ) {
      if (
        nativeTypeAt(this.checker, value.left) !== "number"
        || nativeTypeAt(this.checker, value.right) !== "number"
      ) {
        throw tinyError("TINY1327", "native arithmetic requires number operands", value);
      }
      return {
        kind: "numericBinary",
        operator: value.operatorToken.kind === ts.SyntaxKind.PlusToken ? "add" : "subtract",
        left: this.lower(value.left, currentFunction),
        right: this.lower(value.right, currentFunction),
        span: spanOf(value, value.getSourceFile()),
      };
    }
    if (ts.isIdentifier(value)) {
      const declaration = this.resolveDeclaration(value);
      if (declaration !== undefined && ts.isVariableDeclaration(declaration)) {
        const caughtIn = this.#caught.get(declaration);
        if (caughtIn !== undefined) {
          if (caughtIn !== currentFunction) {
            throw tinyError("TINY1325", "caught values cannot escape their native catch block", value);
          }
          return {
            kind: "caughtException",
            span: spanOf(value, value.getSourceFile()),
          };
        }
        const local = this.#locals.get(declaration);
        if (local !== undefined) {
          if (local.function !== currentFunction) {
            const localType = nativeTypeAt(this.checker, declaration.name);
            if (localType === undefined) {
              throw tinyError("TINY1308", "captured local is not a native scalar", value);
            }
            return this.capture(
              declaration,
              local.function,
              currentFunction,
              local.value,
              declaration.name.getText(),
              value,
              localType,
            );
          }
          return local.value;
        }
      }
      if (declaration !== undefined && ts.isParameter(declaration)) {
        const parameter = this.#parameters.get(declaration);
        if (parameter === undefined) {
          throw tinyError("TINY1308", "parameter is outside the active native function", value);
        }
        if (parameter.function !== currentFunction) {
          return this.capture(
            declaration,
            parameter.function,
            currentFunction,
            {
              kind: "parameter",
              parameter: parameter.parameter,
              span: spanOf(value, value.getSourceFile()),
            },
            declaration.name.getText(),
            value,
            this.#contexts.get(parameter.function)?.parameters[parameter.parameter]?.type ?? "string",
          );
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
      if (declaration !== undefined && ts.isVariableDeclaration(declaration)) {
        const closure = this.#closures.get(declaration);
        if (closure !== undefined) {
          return this.lowerClosureCall(value, closure, currentFunction);
        }
      }
      if (declaration === undefined || !ts.isFunctionDeclaration(declaration)) {
        throw tinyError("TINY1302", "call target must be a named function declaration", value.expression);
      }
      if (declaration.parameters.length > 4) {
        throw tinyError("TINY1309", "native functions support at most four parameters", declaration);
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
      "native value expressions support bounded literals, constants, arithmetic, and direct calls",
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
    if (constant?.value.kind === "number") {
      if (!Number.isSafeInteger(constant.value.value)) {
        throw tinyError("TINY1327", "native numeric constants must be safe integers", identifier);
      }
      return {
        kind: "numericLiteral",
        value: constant.value.value,
        span: spanOf(identifier, identifier.getSourceFile()),
      };
    }
    if (constant?.value.kind === "boolean") {
      return {
        kind: "booleanLiteral",
        value: constant.value.value,
        span: spanOf(identifier, identifier.getSourceFile()),
      };
    }
    if (constant?.value.kind !== "string") {
      throw tinyError("TINY1304", "identifier must resolve to a closed scalar constant", identifier);
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
    if (declaration.body === undefined) {
      throw tinyError("TINY1307", "a lowered function must have a body", declaration);
    }

    const id = this.#functions.length;
    this.#ids.set(declaration, id);
    this.#functions.push(undefined);
    const parameters = this.lowerNativeParameters(declaration.parameters, id);
    const result = functionResultType(this.checker, declaration);
    this.#contexts.set(id, {
      name: declaration.name.text,
      parameters,
      captures: [],
    });
    this.#active.add(declaration);
    const body = this.lowerFunctionBody(declaration.body.statements, id, declaration);
    this.#active.delete(declaration);
    this.#functions[id] = {
      id,
      module: declaration.getSourceFile().fileName,
      name: declaration.name.text,
      parameters,
      result,
      body,
      span: spanOf(declaration, declaration.getSourceFile()),
    };
    return id;
  }

  private lowerFunctionBody(
    statements: readonly ts.Statement[],
    currentFunction: number,
    owner: ts.Node,
  ): ValueExpression {
    const locals: ts.VariableDeclaration[] = [];
    const closures: ts.VariableDeclaration[] = [];
    let index = 0;
    while (index < statements.length && ts.isVariableStatement(statements[index]!)) {
      const statement = statements[index] as ts.VariableStatement;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
        throw tinyError("TINY1321", "native function locals must be immutable `const` bindings", statement);
      }
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer === undefined
          ? undefined
          : unwrap(declaration.initializer);
        if (
          ts.isIdentifier(declaration.name)
          && initializer !== undefined
          && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          this.#closures.set(declaration, {
            owner: currentFunction,
            declaration,
            function: initializer,
          });
          closures.push(declaration);
          continue;
        }
        if (
          !ts.isIdentifier(declaration.name)
          || declaration.initializer === undefined
          || nativeTypeAt(this.checker, declaration.name) === undefined
        ) {
          throw tinyError("TINY1321", "native function locals must be initialized scalars", declaration);
        }
        const value = this.lower(declaration.initializer, currentFunction);
        this.#locals.set(declaration, {function: currentFunction, value});
        locals.push(declaration);
      }
      index += 1;
    }

    try {
      const remaining = statements.slice(index);
      if (remaining.length === 1) {
        const completion = functionCompletion(remaining[0]!);
        if (completion !== undefined) return this.lowerCompletion(completion, currentFunction);
        if (ts.isIfStatement(remaining[0]!)) {
          return this.lowerConditional(remaining[0] as ts.IfStatement, undefined, currentFunction);
        }
        if (ts.isTryStatement(remaining[0]!)) {
          return this.lowerTryCatch(remaining[0] as ts.TryStatement, currentFunction);
        }
      }
      if (remaining.length === 2 && ts.isIfStatement(remaining[0]!)) {
        const fallback = functionCompletion(remaining[1]!);
        if (fallback !== undefined) {
          return this.lowerConditional(remaining[0] as ts.IfStatement, fallback, currentFunction);
        }
      }
      throw tinyError(
        "TINY1307",
        "native functions require a terminal return or a string-equality branch with terminal returns",
        owner,
      );
    } finally {
      for (const declaration of locals) this.#locals.delete(declaration);
      for (const declaration of closures) this.#closures.delete(declaration);
    }
  }

  private lowerClosureCall(
    call: ts.CallExpression,
    closure: ClosureBinding,
    currentFunction?: number,
  ): ValueExpression {
    if (currentFunction !== closure.owner) {
      throw tinyError(
        "TINY1323",
        "closed function values may only be called in their declaring function",
        call,
      );
    }
    if (call.arguments.length !== closure.function.parameters.length) {
      throw tinyError(
        "TINY1310",
        `function value \`${closure.declaration.name.getText()}\` expects ${closure.function.parameters.length} arguments`,
        call,
      );
    }
    const explicitArguments = call.arguments.map(argument => this.lower(argument, currentFunction));
    const functionId = this.lowerClosureFunction(closure);
    const context = this.#contexts.get(functionId);
    if (context === undefined) throw new Error(`closure function ${functionId} has no context`);
    return {
      kind: "directCall",
      function: functionId,
      arguments: [...explicitArguments, ...context.captures.map(capture => capture.argument)],
      span: spanOf(call, call.getSourceFile()),
    };
  }

  private lowerClosureFunction(closure: ClosureBinding): number {
    const node = closure.function;
    if (this.#active.has(node)) {
      throw tinyError("TINY1305", "recursive function values are not supported yet", node);
    }
    const existing = this.#ids.get(node);
    if (existing !== undefined) return existing;
    if (node.parameters.length > 4) {
      throw tinyError("TINY1309", "native functions support at most four values", node);
    }

    const id = this.#functions.length;
    this.#ids.set(node, id);
    this.#functions.push(undefined);
    const parameters = this.lowerNativeParameters(node.parameters, id);
    const result = functionResultType(this.checker, node);
    const owner = this.#contexts.get(closure.owner);
    const name = `${owner?.name ?? `function_${closure.owner}`}.${closure.declaration.name.getText()}`;
    this.#contexts.set(id, {
      name,
      parent: closure.owner,
      parameters,
      captures: [],
    });
    this.#active.add(node);
    const body = ts.isBlock(node.body)
      ? this.lowerFunctionBody(node.body.statements, id, node)
      : this.lower(node.body, id);
    this.#active.delete(node);
    this.#functions[id] = {
      id,
      module: node.getSourceFile().fileName,
      name,
      parameters,
      result,
      body,
      span: spanOf(node, node.getSourceFile()),
    };
    return id;
  }

  private capture(
    declaration: ts.Declaration,
    owner: number,
    currentFunction: number | undefined,
    argument: ValueExpression,
    name: string,
    occurrence: ts.Node,
    valueType: NativeValueType,
  ): ValueExpression {
    const context = currentFunction === undefined ? undefined : this.#contexts.get(currentFunction);
    if (context === undefined || context.parent !== owner || valueType !== "string") {
      throw tinyError("TINY1308", "only direct-parent immutable string captures are supported", occurrence);
    }
    const existing = context.captures.find(capture => capture.declaration === declaration);
    const parameter = existing?.parameter ?? (() => {
      if (context.parameters.length >= 4) {
        throw tinyError("TINY1324", "native closure exceeds four explicit and captured strings", occurrence);
      }
      const index = context.parameters.length;
      context.parameters.push({
        name: `$capture.${name}`,
        type: "string",
        span: spanOf(occurrence, occurrence.getSourceFile()),
      });
      context.captures.push({declaration, argument, parameter: index});
      return index;
    })();
    return {
      kind: "parameter",
      parameter,
      span: spanOf(occurrence, occurrence.getSourceFile()),
    };
  }

  private lowerNativeParameters(
    declarations: readonly ts.ParameterDeclaration[],
    functionId: number,
  ): FunctionParameter[] {
    return declarations.map((parameter, index) => {
      const type = requiredNativeParameterType(this.checker, parameter);
      if (type === undefined || !ts.isIdentifier(parameter.name)) {
        throw tinyError(
          "TINY1311",
          "native function parameters must be required strings, numbers, or booleans",
          parameter,
        );
      }
      this.#parameters.set(parameter, {function: functionId, parameter: index});
      return {
        name: parameter.name.text,
        type,
        span: spanOf(parameter, parameter.getSourceFile()),
      };
    });
  }

  private lowerConditional(
    statement: ts.IfStatement,
    fallback: FunctionCompletion | undefined,
    currentFunction: number,
  ): ValueExpression {
    const condition = unwrap(statement.expression);
    if (
      !ts.isBinaryExpression(condition)
      || ![
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(condition.operatorToken.kind)
    ) {
      throw tinyError("TINY1322", "native branches require strict string equality", condition);
    }
    const thenCompletion = functionCompletion(statement.thenStatement);
    const elseCompletion = statement.elseStatement === undefined
      ? fallback
      : functionCompletion(statement.elseStatement);
    if (thenCompletion === undefined || elseCompletion === undefined) {
      throw tinyError("TINY1322", "both native branch paths must return or throw a string", statement);
    }
    const equal = condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
    const leftType = nativeTypeAt(this.checker, condition.left);
    const rightType = nativeTypeAt(this.checker, condition.right);
    if (leftType === undefined || leftType !== rightType) {
      throw tinyError("TINY1322", "native equality operands must have the same scalar type", condition);
    }
    const left = this.lower(condition.left, currentFunction);
    const right = this.lower(condition.right, currentFunction);
    const thenValue = this.lowerCompletion(thenCompletion, currentFunction);
    const elseValue = this.lowerCompletion(elseCompletion, currentFunction);
    return {
      kind: leftType === "string"
        ? "stringEqualConditional"
        : leftType === "number"
          ? "numericEqualConditional"
          : "booleanEqualConditional",
      left,
      right,
      whenEqual: equal ? thenValue : elseValue,
      whenNotEqual: equal ? elseValue : thenValue,
      span: spanOf(statement, statement.getSourceFile()),
    };
  }

  private lowerCompletion(
    completion: FunctionCompletion,
    currentFunction: number,
  ): ValueExpression {
    const value = this.lower(completion.expression, currentFunction);
    if (completion.kind === "throw" && nativeTypeAt(this.checker, completion.expression) !== "string") {
      throw tinyError("TINY1325", "native exceptions currently require string values", completion.expression);
    }
    return completion.kind === "return"
      ? value
      : {
          kind: "throwValue",
          value,
          span: spanOf(completion.expression, completion.expression.getSourceFile()),
        };
  }

  private lowerTryCatch(
    statement: ts.TryStatement,
    currentFunction: number,
  ): ValueExpression {
    if (
      statement.finallyBlock !== undefined
      || statement.catchClause?.variableDeclaration === undefined
      || !ts.isIdentifier(statement.catchClause.variableDeclaration.name)
    ) {
      throw tinyError(
        "TINY1326",
        "native try/catch requires one identifier binding and no finally block",
        statement,
      );
    }
    const tryValue = this.lowerFunctionBody(statement.tryBlock.statements, currentFunction, statement.tryBlock);
    const binding = statement.catchClause.variableDeclaration;
    this.#caught.set(binding, currentFunction);
    let catchValue: ValueExpression;
    try {
      catchValue = this.lowerFunctionBody(
        statement.catchClause.block.statements,
        currentFunction,
        statement.catchClause.block,
      );
    } finally {
      this.#caught.delete(binding);
    }
    return {
      kind: "tryCatch",
      tryValue,
      catchValue,
      span: spanOf(statement, statement.getSourceFile()),
    };
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

function functionCompletion(statement: ts.Statement): FunctionCompletion | undefined {
  if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
    return {kind: "return", expression: statement.expression};
  }
  if (ts.isThrowStatement(statement) && statement.expression !== undefined) {
    return {kind: "throw", expression: statement.expression};
  }
  if (ts.isBlock(statement) && statement.statements.length === 1) {
    const [only] = statement.statements;
    return only === undefined ? undefined : functionCompletion(only);
  }
  return undefined;
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

function requiredNativeParameterType(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
): NativeValueType | undefined {
  if (
    !ts.isIdentifier(parameter.name)
    || parameter.dotDotDotToken !== undefined
    || parameter.questionToken !== undefined
    || parameter.initializer !== undefined
  ) {
    return undefined;
  }
  return nativeTypeAt(checker, parameter);
}

function functionResultType(
  checker: ts.TypeChecker,
  declaration: ts.SignatureDeclaration,
): NativeValueType {
  const signature = checker.getSignatureFromDeclaration(declaration);
  const result = signature === undefined
    ? undefined
    : nativeTypeOf(checker.getReturnTypeOfSignature(signature));
  if (result === undefined) {
    throw tinyError(
      "TINY1328",
      "native functions must return a string, number, or boolean",
      declaration,
    );
  }
  return result;
}

function nativeTypeAt(checker: ts.TypeChecker, node: ts.Node): NativeValueType | undefined {
  return nativeTypeOf(checker.getTypeAtLocation(node));
}

function nativeTypeOf(type: ts.Type): NativeValueType | undefined {
  if ((type.flags & ts.TypeFlags.StringLike) !== 0) return "string";
  if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return "number";
  if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) return "boolean";
  if (type.isUnion()) {
    const members = new Set(type.types.map(nativeTypeOf));
    if (members.size === 1) return members.values().next().value;
  }
  return undefined;
}
