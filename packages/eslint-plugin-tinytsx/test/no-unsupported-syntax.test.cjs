const {describe, it} = require('node:test')
const {RuleTester} = require('eslint')
const tseslint = require('typescript-eslint')
const plugin = require('../index.cjs')

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaFeatures: {jsx: true},
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
})

tester.run('no-unsupported-syntax', plugin.rules['no-unsupported-syntax'], {
  valid: [
    {
      filename: 'server.tsx',
      code: `
        import {Hono} from 'hono'

        interface CardProps { title: string }
        const Card = (props: CardProps) => <h1 data-kind="card">{props.title}</h1>

        class TodoService {
          private prefix: string
          constructor(prefix: string) { this.prefix = prefix }
          get = async (id: string) => this.prefix + id
        }

        const app = new Hono()
        app.get('/:id', async context => {
          const service = new TodoService('todo:')
          const values = [...['one', 'two']]
          for (let index = 0; index < values.length; index++) {
            if (index === 100) break
          }
          return context.html(<Card title={await service.get(context.req.param('id'))} />)
        })
      `,
    },
    {
      filename: 'closed-access.ts',
      code: `
        const record = {answer: 42}
        record['answer']
        context.var['requestId']
      `,
    },
    {
      filename: 'advanced.ts',
      options: [{allow: ['class-inheritance', 'dynamic-computed-access']}],
      code: `
        class Child extends Parent {}
        const value = record[key]
      `,
    },
    {
      filename: 'component.tsx',
      code: `
        const Button = (props: {onClick: string}) => <button>{props.onClick}</button>
        const page = <Button onClick="compile-time prop" />
      `,
    },
    {
      filename: 'custom-attribute.tsx',
      options: [{additionalIntrinsicJsxAttributes: ['role']}],
      code: `const page = <main role="document">Hello</main>`,
    },
    {
      filename: 'private-class.ts',
      code: `
        class TodoService {
          #set = async (values: string[]) => values
          add = async (value: string) => this.#set([value])
        }
      `,
    },
    {
      filename: 'beta-air-quality.ts',
      code: `
        import {Hono} from 'hono'
        import {openAssets} from 'tinytsx:assets'
        import {openReadonlyDatabase} from 'tinytsx:sqlite'

        const database = openReadonlyDatabase('AIR_DB')
        const history = database.prepare('SELECT co2 FROM readings LIMIT ?1')
        const web = openAssets('WEB', {index: 'index.html', spaFallback: true})
        const app = new Hono()
        app.get('/history', async context => context.json({readings: await history.all([
          Number(context.req.query('limit') ?? '256'),
        ])}))
        app.get('*', context => web.fetch(context.req))
      `,
    },
    {
      filename: 'api.d.ts',
      code: `
        declare module 'hono/cors' { export function cors(): unknown }
        declare global { interface Env { readonly TOKEN: string } }
      `,
    },
  ],
  invalid: [
    {
      filename: 'runtime-code.ts',
      code: `eval('value'); require('node:fs'); Function('return 1'); new Function('return 2')`,
      errors: [
        {messageId: 'runtimeCodeGeneration'},
        {messageId: 'runtimeCodeGeneration'},
        {messageId: 'runtimeCodeGeneration'},
        {messageId: 'runtimeCodeGeneration'},
      ],
    },
    {
      filename: 'computed.ts',
      code: `const value = record[key]`,
      errors: [{messageId: 'dynamicComputedAccess'}],
    },
    {
      filename: 'intrinsic.tsx',
      code: `const page = <button onClick="unsafe">Hello</button>`,
      errors: [{messageId: 'intrinsicJsxAttribute'}],
    },
    {
      filename: 'inheritance.ts',
      code: `class Child extends Parent {}`,
      errors: [{messageId: 'classInheritance'}],
    },
    {
      filename: 'generator.ts',
      code: `function* values() { yield 1 }`,
      errors: [{messageId: 'generator'}],
    },
    {
      filename: 'decorator.ts',
      code: `@sealed class Value {}`,
      errors: [{messageId: 'decorator'}],
    },
    {
      filename: 'dynamic-import.ts',
      code: `const module = await import('./dynamic.js')`,
      errors: [{messageId: 'dynamicImport'}],
    },
    {
      filename: 'meta.ts',
      code: `const url = import.meta.url`,
      errors: [{messageId: 'metaProperty'}],
    },
    {
      filename: 'namespace.ts',
      code: `namespace Runtime { export const value = 1 }`,
      errors: [{messageId: 'typescriptRuntimeSyntax'}],
    },
    {
      filename: 'enum.ts',
      code: `enum State { Ready }`,
      errors: [{messageId: 'typescriptRuntimeSyntax'}],
    },
    {
      filename: 'import-equals.ts',
      code: `import fs = require('node:fs')`,
      errors: [{messageId: 'typescriptRuntimeSyntax'}],
    },
    {
      filename: 'export-assignment.ts',
      code: `export = application`,
      errors: [{messageId: 'typescriptRuntimeSyntax'}],
    },
    {
      filename: 'with.js',
      code: `with (value) { result = field }`,
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'script',
        parserOptions: {sourceType: 'script'},
      },
      errors: [{messageId: 'withStatement'}],
    },
  ],
})

describe('plugin exports', () => {
  it('exposes metadata and the recommended flat config', () => {
    if (plugin.meta.name !== 'eslint-plugin-tinytsx') throw new Error('missing plugin name')
    if (plugin.meta.namespace !== 'tinytsx') throw new Error('missing plugin namespace')
    if (plugin.configs.recommended[0].plugins.tinytsx !== plugin) {
      throw new Error('recommended config does not register the plugin')
    }
    if (plugin.configs.recommended[0].rules['tinytsx/no-unsupported-syntax'] !== 'error') {
      throw new Error('recommended config does not enable the syntax rule')
    }
  })
})
