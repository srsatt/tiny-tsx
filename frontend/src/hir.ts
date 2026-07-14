export interface SourceSpan {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface StaticString {
  id: number;
  value: string;
}

export type ConstantValue =
  | {kind: "undefined"}
  | {kind: "null"}
  | {kind: "boolean"; value: boolean}
  | {kind: "number"; value: number}
  | {kind: "bigint"; value: string}
  | {kind: "string"; value: string}
  | {kind: "array"; items: ConstantValue[]}
  | {kind: "record"; fields: ConstantField[]};

export interface ConstantField {
  name: string;
  value: ConstantValue;
}

export interface Constant {
  id: number;
  module: string;
  name: string;
  span: SourceSpan;
  value: ConstantValue;
}

export type HtmlOp =
  | {
      kind: "writeStatic";
      string: number;
      span: SourceSpan;
    }
  | {
      kind: "callComponent";
      component: number;
      span: SourceSpan;
    };

export interface Component {
  id: number;
  name: string;
  span: SourceSpan;
  html: HtmlOp[];
}

export type ValueExpression =
  | {
      kind: "stringLiteral";
      string: number;
      span: SourceSpan;
    }
  | {
      kind: "constant";
      constant: number;
      span: SourceSpan;
    }
  | {
      kind: "parameter";
      parameter: number;
      span: SourceSpan;
    }
  | {
      kind: "directCall";
      function: number;
      arguments: ValueExpression[];
      span: SourceSpan;
    };

export interface FunctionParameter {
  name: string;
  type: "string";
  span: SourceSpan;
}

export interface HirFunction {
  id: number;
  module: string;
  name: string;
  parameters: FunctionParameter[];
  result: "string";
  body: ValueExpression;
  span: SourceSpan;
}

export type HandlerResponse =
  | {kind: "html"; component: number}
  | {kind: "text"; value: ValueExpression};

export interface Handler {
  method: "GET";
  response: HandlerResponse;
  span: SourceSpan;
}

export interface HirProgram {
  version: 2;
  target: "aarch64-apple-darwin";
  entry: string;
  modules: Array<{ path: string }>;
  functions: HirFunction[];
  components: Component[];
  handlers: Handler[];
  staticStrings: StaticString[];
  constants: Constant[];
  statistics: {
    modules: number;
    functions: number;
    components: number;
    constants: number;
    staticHtmlBytes: number;
    dynamicHtmlExpressions: number;
  };
}

export class StringTable {
  readonly values: StaticString[] = [];
  readonly #ids = new Map<string, number>();

  intern(value: string): number {
    const existing = this.#ids.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const id = this.values.length;
    this.values.push({id, value});
    this.#ids.set(value, id);
    return id;
  }
}
