import path from "node:path";
import ts from "typescript";
import {analyzeApplicationEntry} from "./application-entry.js";
import {
  evaluateApplicationConstructor,
  evaluateApplicationInitialization,
} from "./constructor-evaluator.js";
import {lowerStagedConstants} from "./constant-lowering.js";
import {CompileFailure, fromTypeScript, spanOf, tinyError} from "./diagnostics.js";
import {FunctionLowerer} from "./function-lowering.js";
import type {Component, Handler, HirProgram} from "./hir.js";
import {StringTable} from "./hir.js";
import {lowerComponentBody} from "./jsx-lowering.js";
import {loadModuleGraph} from "./module-graph.js";
import {displayRuntimeClassPlan, resolveRuntimeClassPlan} from "./runtime-class-plan.js";
import {analyzeStaging} from "./staging.js";
import {validateForbiddenSyntax} from "./subset-validator.js";

export interface CompileOptions {
  sdkPath: string;
  aliases?: Readonly<Record<string, string>>;
  apiAliases?: Readonly<Record<string, string>>;
}

export function compileEntry(entryPath: string, options: CompileOptions): HirProgram {
  const entry = path.resolve(entryPath);
  const sdk = path.resolve(options.sdkPath);
  const graph = loadModuleGraph(entry, options.aliases === undefined ? {} : {aliases: options.aliases});
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
  const typeAliases = {...options.aliases, ...options.apiAliases};
  if (Object.keys(typeAliases).length > 0) {
    compilerOptions.paths = Object.fromEntries(Object.entries(typeAliases).map(([specifier, target]) => [
      specifier,
      [path.resolve(target)],
    ]));
  }
  const program = ts.createProgram({
    rootNames: [entry, sdk, ...graph.modules.map(module => module.path)],
    options: compilerOptions,
  });

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
  validateForbiddenSyntax(sourceFile, staging.computedAccesses);
  const entryDiagnostics = ts.getPreEmitDiagnostics(program, sourceFile)
    .filter(diagnostic => !isResponseIntrinsicDiagnostic(diagnostic));
  if (entryDiagnostics.length > 0) {
    throw new CompileFailure(entryDiagnostics.map(fromTypeScript));
  }
  const typeScriptDiagnostics = ts.getPreEmitDiagnostics(program)
    .filter(diagnostic => !isResponseIntrinsicDiagnostic(diagnostic));
  if (typeScriptDiagnostics.length > 0) {
    throw new CompileFailure(typeScriptDiagnostics.map(fromTypeScript));
  }
  const getDeclarations = sourceFile.statements.filter(isGetDeclaration);
  if (getDeclarations.length === 0) {
    const application = analyzeApplicationEntry(sourceFile);
    if (application !== undefined) {
      const calls = application.calls.map(call => call.method).join(", ") || "none";
      const classPlan = resolveRuntimeClassPlan(graph, application);
      const chain = classPlan === undefined
        ? application.constructorName
        : displayRuntimeClassPlan(classPlan, process.cwd());
      const initialization = evaluateApplicationInitialization(graph, application);
      if (initialization !== undefined && initialization.issues.length === 0) {
        throw tinyError(
          "TINY1402",
          `default application \`${application.binding}\` executed calls [${calls}] into ${initialization.routes.length} closed routes and ${initialization.routerInsertions} router insertions; native dispatch is not lowered yet`,
          sourceFile.statements.find(statement => ts.isExportAssignment(statement)) ?? sourceFile,
        );
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
    handlers: [handler],
    staticStrings: strings.values,
    constants,
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
