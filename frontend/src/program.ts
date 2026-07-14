import path from "node:path";
import ts from "typescript";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import type {Component, Handler, HirProgram} from "./hir.js";
import {StringTable} from "./hir.js";
import {lowerComponentBody} from "./jsx-lowering.js";
import {validateForbiddenSyntax} from "./subset-validator.js";

export interface CompileOptions {
  sdkPath: string;
}

export function compileEntry(entryPath: string, options: CompileOptions): HirProgram {
  const entry = path.resolve(entryPath);
  const sdk = path.resolve(options.sdkPath);
  const program = ts.createProgram({
    rootNames: [entry, sdk],
    options: {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      lib: ["lib.es2022.d.ts"],
    },
  });

  const sourceFile = program.getSourceFile(entry);
  if (sourceFile === undefined) {
    throw new CompileFailure([{
      code: "TINY0001",
      message: `could not load entry module: ${entry}`,
    }]);
  }

  validateForbiddenSyntax(sourceFile);
  const typeScriptDiagnostics = ts.getPreEmitDiagnostics(program);
  if (typeScriptDiagnostics.length > 0) {
    throw new CompileFailure(typeScriptDiagnostics.map(fromTypeScript));
  }
  const componentDeclarations = sourceFile.statements.filter(isComponentDeclaration);
  if (componentDeclarations.length === 0) {
    throw tinyError("TINY1100", "entry module must declare at least one JSX component", sourceFile);
  }

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
      span: spanOf(declaration, sourceFile),
      html: lowerComponentBody(expression, sourceFile, componentIds, strings),
    };
  });

  const getDeclarations = sourceFile.statements.filter(isGetDeclaration);
  if (getDeclarations.length !== 1) {
    throw tinyError(
      "TINY1103",
      "entry module must export exactly one GET handler",
      getDeclarations[0] ?? sourceFile,
    );
  }
  const handler = lowerGetHandler(getDeclarations[0]!, componentIds, sourceFile);

  const staticHtmlBytes = strings.values.reduce(
    (total, value) => total + Buffer.byteLength(value.value, "utf8"),
    0,
  );
  return {
    version: 1,
    target: "aarch64-apple-darwin",
    entry,
    modules: [{path: entry}],
    components,
    handlers: [handler],
    staticStrings: strings.values,
    statistics: {
      modules: 1,
      components: components.length,
      staticHtmlBytes,
      dynamicHtmlExpressions: 0,
    },
  };
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
    throw tinyError("TINY1111", "GET must return `Response.html(<Component />)`", statement);
  }
  const call = statement.expression;
  if (
    !ts.isCallExpression(call)
    || !ts.isPropertyAccessExpression(call.expression)
    || call.expression.expression.getText(sourceFile) !== "Response"
    || call.expression.name.text !== "html"
    || call.arguments.length !== 1
  ) {
    throw tinyError("TINY1111", "GET must return `Response.html(<Component />)`", call);
  }
  const componentName = getInvokedComponent(call.arguments[0]!);
  const component = componentIds.get(componentName);
  if (component === undefined) {
    throw tinyError("TINY1200", `unknown component \`${componentName}\``, call.arguments[0]!);
  }
  return {method: "GET", component, span: spanOf(declaration, sourceFile)};
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
