# eslint-plugin-tinytsx

ESLint rules for TinyTSX's statically checkable TypeScript and TSX syntax
boundary.

The plugin runs during ordinary ESLint analysis. It does not invoke the TinyTSX
compiler, load a TypeScript project, build HIR, or generate native code.

## Installation

```sh
npm install --save-dev eslint typescript-eslint eslint-plugin-tinytsx
```

The package has no runtime dependencies. ESLint is a peer dependency;
`typescript-eslint` supplies the parser for `.ts` and `.tsx` files.

## Flat config

```js
// eslint.config.mjs
import tinytsx from 'eslint-plugin-tinytsx'
import tseslint from 'typescript-eslint'

export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {jsx: true},
      },
    },
    plugins: {tinytsx},
    rules: {
      'tinytsx/no-unsupported-syntax': 'error',
    },
  },
]
```

The equivalent recommended rule configuration is available as
`tinytsx.configs.recommended` and `tinytsx.configs['flat/recommended']`.

## `no-unsupported-syntax`

The rule rejects application syntax that an isolated ESLint AST can identify
as outside the TinyTSX model:

- `eval`, `require`, and the `Function` constructor;
- generator functions;
- dynamic imports and meta properties such as `import.meta`;
- TypeScript namespaces, enums, import-equals, and export assignments;
- decorators;
- dynamic computed property access;
- application class inheritance;
- `with` statements;
- unsupported attributes on intrinsic JSX elements.

Selected async/await, ordinary classes including bounded `#private` members,
loops, closures, arrays, records, and closed spread are intentionally not
rejected because TinyTSX admits bounded forms of them. Ambient `.d.ts`
declarations are ignored because they do not create runtime behavior.

### Options

Add project-specific intrinsic JSX attributes:

```js
{
  'tinytsx/no-unsupported-syntax': ['error', {
    additionalIntrinsicJsxAttributes: ['role'],
  }],
}
```

Allow a conservative category when linting pinned dependency source or another
separately verified boundary:

```js
{
  'tinytsx/no-unsupported-syntax': ['error', {
    allow: ['class-inheritance', 'dynamic-computed-access'],
  }],
}
```

Available categories are:

- `class-inheritance`
- `decorators`
- `dynamic-computed-access`
- `dynamic-import`
- `generators`
- `meta-properties`
- `runtime-code-generation`
- `typescript-runtime-syntax`
- `unsupported-intrinsic-jsx-attributes`
- `with-statements`

## What linting cannot prove

TinyTSX compatibility is not purely syntactic. The compiler still validates:

- whether initialization values and computed keys are compile-time closed;
- function, class, async, loop, array, record, and spread shapes;
- Hono and Web API calls against the pinned executable allowlist;
- resource bounds and ownership;
- environment, filesystem, SQLite, and actor capabilities;
- request-time lifetime and memory requirements;
- imports and package source revisions.

Treat the ESLint rule as fast editor feedback. `tinytsx check` remains the
authoritative compatibility check.

## License

MIT
