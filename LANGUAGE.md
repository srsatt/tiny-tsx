# TinyTSX Language

TinyTSX uses TypeScript-compatible syntax and tooling but defines a smaller,
statically compiled language. TypeScript acceptance is necessary but not
sufficient: the TinyTSX subset validator has the final word.

## Initial static subset

The first vertical slice supports:

- top-level interface declarations used by SDK types;
- ordinary function declarations;
- named exports;
- a single exported `GET` handler;
- function parameters with explicit types;
- direct component invocations;
- `return` statements;
- `Response.html(...)`;
- TSX intrinsic elements, fragments, static text, and string attributes;
- zero-argument function components with `JSX.Element` return type.

The initial intrinsic allowlist is `html`, `head`, `title`, `meta`, `link`,
`body`, `main`, `section`, `article`, `header`, `footer`, `nav`, `div`, `span`,
`h1`, `h2`, `h3`, `p`, `a`, `ul`, `ol`, `li`, `strong`, `em`, `code`, `pre`,
`form`, `label`, `input`, and `button`.

`meta`, `link`, and `input` are void elements and cannot have children.

Static attributes initially accept `class`, `className`, `id`, `href`, `title`,
`lang`, `name`, `value`, `type`, `placeholder`, `style`, `data-*`, and `aria-*`.
`className` is emitted as `class`.

## TSX semantics

`JSX.Element` is a compiler-only type. It has no native runtime representation
and cannot be stored or inspected. TSX lowers directly to ordered HTML writer
operations. Adjacent static markup is coalesced before code generation.

The source:

```tsx
function Page(): JSX.Element {
  return <h1 className="title">Hello</h1>;
}
```

initially lowers to one operation equivalent to:

```text
write_static("<h1 class=\"title\">Hello</h1>")
```

Text and attribute escaping become mandatory when dynamic expressions are added.
There is no raw-HTML escape hatch.

## Types

The planned MVP types are `void`, `boolean`, `string`, `string | null`, `i32`,
`u32`, `i64`, `u64`, closed records, direct function signatures, `Request`,
`Response`, and compiler-only `JSX.Element`. Strings are UTF-8 string views;
TinyTSX does not reproduce JavaScript UTF-16 behavior.

Record shapes are closed. Properties have fixed offsets and cannot be inserted,
deleted, or accessed through arbitrary computed names.

## Rejected constructs

The validator rejects unsupported behavior rather than changing its meaning.
This includes `any`, unsafe assertions, classes, prototypes, dynamic imports,
CommonJS `require`, decorators, accessors, exceptions, generators, symbols,
collections, regular expressions, reflection, loose equality, recursion,
async/await, arbitrary npm imports, event handlers, spread attributes, refs,
style objects, and `dangerouslySetInnerHTML`.

The static slice additionally rejects all dynamic TSX expressions except a
direct component invocation. Dynamic props, request query values, nullish
coalescing, and escaped insertions enter together in the next milestone.

## Diagnostics

Diagnostics use stable `TINYxxxx` codes and include the source path, one-based
line, one-based column, the unsupported construct, and—when useful—a remediation.
Normal TypeScript diagnostics are reported before TinyTSX lowering.

