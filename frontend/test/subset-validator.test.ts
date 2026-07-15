import assert from "node:assert/strict";
import {test} from "node:test";
import ts from "typescript";
import {CompileFailure} from "../src/diagnostics.js";
import {validateForbiddenSyntax} from "../src/subset-validator.js";

function source(text: string): ts.SourceFile {
  return ts.createSourceFile("component.tsx", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
}

test("allows typed props on component JSX while retaining intrinsic attribute checks", () => {
  assert.doesNotThrow(() => validateForbiddenSyntax(source(`
    const Card = (props: {title: string}) => <h1>{props.title}</h1>;
    const page = <Card title="Hello" />;
  `)));

  assert.throws(
    () => validateForbiddenSyntax(source(`<button onClick="unsafe">Hello</button>`)),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TINY1204",
  );
});
