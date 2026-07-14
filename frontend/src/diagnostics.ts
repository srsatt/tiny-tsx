import ts from "typescript";
import type {SourceSpan} from "./hir.js";

export interface Diagnostic {
  code: string;
  message: string;
  span?: SourceSpan;
  help?: string;
}

export class CompileFailure extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    this.name = "CompileFailure";
  }
}

export function spanOf(node: ts.Node, sourceFile = node.getSourceFile()): SourceSpan {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: sourceFile.fileName,
    line: start.line + 1,
    column: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

export function tinyError(
  code: string,
  message: string,
  node: ts.Node,
  help?: string,
  sourceFile?: ts.SourceFile,
): CompileFailure {
  const diagnostic: Diagnostic = {code, message, span: spanOf(node, sourceFile ?? node.getSourceFile())};
  if (help !== undefined) {
    diagnostic.help = help;
  }
  return new CompileFailure([diagnostic]);
}

export function fromTypeScript(diagnostic: ts.Diagnostic): Diagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return {code: `TS${diagnostic.code}`, message};
  }

  const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const endPosition = diagnostic.start + (diagnostic.length ?? 0);
  const end = diagnostic.file.getLineAndCharacterOfPosition(endPosition);
  return {
    code: `TS${diagnostic.code}`,
    message,
    span: {
      file: diagnostic.file.fileName,
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    },
  };
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.span === undefined
    ? ""
    : `\n  ${diagnostic.span.file}:${diagnostic.span.line}:${diagnostic.span.column}`;
  const help = diagnostic.help === undefined ? "" : `\n  help: ${diagnostic.help}`;
  return `error[${diagnostic.code}]: ${diagnostic.message}${location}${help}`;
}
