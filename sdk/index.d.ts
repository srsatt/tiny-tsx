type i32 = number;
type u32 = number;
type i64 = number;
type u64 = number;

declare class Request {
  query(name: string): string | null;
}

declare class Response {
  static html(element: JSX.Element): Response;
  /** TinyTSX lowering intrinsic; not a Web-standard static Response method. */
  static text(body: string): Response;
}

declare namespace JSX {
  interface Element {
    readonly __tinytsxElement: unique symbol;
  }

  type StaticAttribute = string | boolean;

  interface IntrinsicAttributes {
    class?: string;
    className?: string;
    id?: string;
    href?: string;
    title?: string;
    lang?: string;
    name?: string;
    value?: string;
    type?: string;
    placeholder?: string;
    style?: string;
  }

  interface IntrinsicElements {
    html: IntrinsicAttributes;
    head: IntrinsicAttributes;
    title: IntrinsicAttributes;
    meta: IntrinsicAttributes;
    link: IntrinsicAttributes;
    body: IntrinsicAttributes;
    main: IntrinsicAttributes;
    section: IntrinsicAttributes;
    article: IntrinsicAttributes;
    header: IntrinsicAttributes;
    footer: IntrinsicAttributes;
    nav: IntrinsicAttributes;
    div: IntrinsicAttributes;
    span: IntrinsicAttributes;
    h1: IntrinsicAttributes;
    h2: IntrinsicAttributes;
    h3: IntrinsicAttributes;
    p: IntrinsicAttributes;
    a: IntrinsicAttributes;
    ul: IntrinsicAttributes;
    ol: IntrinsicAttributes;
    li: IntrinsicAttributes;
    strong: IntrinsicAttributes;
    em: IntrinsicAttributes;
    code: IntrinsicAttributes;
    pre: IntrinsicAttributes;
    form: IntrinsicAttributes;
    label: IntrinsicAttributes;
    input: IntrinsicAttributes;
    button: IntrinsicAttributes;
  }
}
