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

export interface WorkerModule {
  id: number;
  module: string;
  operation: "asciiUppercase";
}

export interface ActorModule {
  id: number;
  operation: "counter";
  initialState: number;
  mailboxCapacity: number;
}

export interface SqliteDatabase {
  id: number;
  path: ":memory:";
}

export type ActorAction =
  | {kind: "tell"; actor: number; message: number}
  | {kind: "stop"; actor: number};

export type SqliteAction =
  | {kind: "exec"; database: number; sql: number; parameters?: SqliteParameter[]}
  | {kind: "close"; database: number};

export type SqliteParameter =
  | {kind: "routeParameter"; segment: number}
  | {kind: "requestJsonField"; field: number};

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
    }
  | {
      kind: "concat";
      values: ValueExpression[];
      span: SourceSpan;
    }
  | {
      kind: "routeParameter";
      name: string;
      segment: number;
      span: SourceSpan;
    }
  | {
      kind: "requestHeader";
      header: number;
      span: SourceSpan;
    }
  | {
      kind: "environmentVariable";
      name: number;
      required: boolean;
      fallback?: number;
      span: SourceSpan;
    }
  | {
      kind: "fileText";
      path: number;
      maxBytes: number;
      span: SourceSpan;
    }
  | {
      kind: "actorCall";
      actor: number;
      message: number;
      span: SourceSpan;
    }
  | {
      kind: "sqliteQuery";
      database: number;
      sql: number;
      mode: "all" | "first";
      parameters: SqliteParameter[];
      span: SourceSpan;
    }
  | {
      kind: "fetchStatus";
      url: number;
      span: SourceSpan;
    }
  | {
      kind: "queryParameter";
      query: number;
      fallback?: number;
      escapeHtml: boolean;
      span: SourceSpan;
    }
  | {
      kind: "queryConditional";
      query: number;
      whenPresent: ValueExpression;
      whenAbsent: ValueExpression;
      span: SourceSpan;
    }
  | {
      kind: "workerCall";
      worker: number;
      input: ValueExpression;
      span: SourceSpan;
    }
  | {
      kind: "openAiChatText";
      url: number;
      authorization: number;
      body: number;
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
  | {
      kind: "text";
      value: ValueExpression;
      status?: number;
      contentType?:
        | ""
        | "text/plain; charset=UTF-8"
        | "text/plain; charset=utf-8"
        | "text/plain;charset=UTF-8"
        | "text/html; charset=UTF-8"
        | "application/json";
    }
  | {
      kind: "stream";
      chunks: ValueExpression[];
      status?: number;
      contentType?:
        | ""
        | "text/plain; charset=UTF-8"
        | "text/plain; charset=utf-8"
        | "text/plain;charset=UTF-8"
        | "text/html; charset=UTF-8"
        | "application/json";
    };

export interface Handler {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  headers?: StaticHeader[];
  elapsedHeaders?: ElapsedHeader[];
  stderr?: number[];
  basicAuthorization?: BasicAuthorization;
  entityTag?: EntityTag;
  parameterValidations?: ParameterValidation[];
  actorActions?: ActorAction[];
  sqliteActions?: SqliteAction[];
  response: HandlerResponse;
  span: SourceSpan;
}

export interface ParameterValidation {
  name: string;
  segment: number;
  minLength: number;
  rejected: GuardedResponse;
}

export interface StaticHeader {
  name: string;
  value: string;
}

export interface ElapsedHeader {
  name: string;
  suffix: string;
}

export interface BasicAuthorization {
  credentials: BasicCredential[];
  rejected: GuardedResponse;
}

export interface BasicCredential {
  username: string;
  password: string;
}

export interface EntityTag {
  value: string;
  notModified: GuardedResponse;
}

export interface GuardedResponse {
  headers?: StaticHeader[];
  elapsedHeaders?: ElapsedHeader[];
  stderr?: number[];
  response: HandlerResponse;
}

export interface MemoryAllocationSite {
  module: string;
  line: number;
  column: number;
  valueKind: string;
  instances: number;
  maxReferences: number;
  lifetime: "compileTime" | "static" | "request" | "worker" | "message" | "managed";
  escape: "none" | "response" | "worker" | "message" | "process";
}

export interface MemoryReport {
  policy: "arena";
  managedHeapRequired: boolean;
  sites: MemoryAllocationSite[];
  summary: {
    compileTime: number;
    static: number;
    request: number;
    worker: number;
    message: number;
    managed: number;
    aliasedSites: number;
    responseEscapes: number;
  };
}

export interface HirProgram {
  version: 2;
  target: "aarch64-apple-darwin";
  server?: {
    port?: number;
  };
  entry: string;
  modules: Array<{ path: string }>;
  functions: HirFunction[];
  components: Component[];
  workers: WorkerModule[];
  actors: ActorModule[];
  sqliteDatabases: SqliteDatabase[];
  handlers: Handler[];
  staticStrings: StaticString[];
  constants: Constant[];
  memory: MemoryReport;
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
