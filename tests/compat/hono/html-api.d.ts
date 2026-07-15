export interface HonoHtmlEscapedStringApi extends JSX.Element {
  toString(): string;
}

export declare function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): HonoHtmlEscapedStringApi;
