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

export interface Handler {
  method: "GET";
  component: number;
  span: SourceSpan;
}

export interface HirProgram {
  version: 1;
  target: "aarch64-apple-darwin";
  entry: string;
  modules: Array<{ path: string }>;
  components: Component[];
  handlers: Handler[];
  staticStrings: StaticString[];
  statistics: {
    modules: number;
    components: number;
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

