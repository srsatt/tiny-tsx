const path = require('node:path')
const {test} = require('node:test')
const {ESLint} = require('eslint')
const tseslint = require('typescript-eslint')
const plugin = require('../index.cjs')

test('accepts every shipped TinyTSX TypeScript example', async () => {
  const root = path.resolve(__dirname, '../../..')
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {ecmaFeatures: {jsx: true}},
      },
      plugins: {tinytsx: plugin},
      rules: {'tinytsx/no-unsupported-syntax': 'error'},
    }],
  })
  const results = await eslint.lintFiles('examples/**/*.{ts,tsx}')
  const errors = results.flatMap(result => result.messages
    .filter(message => message.severity === 2)
    .map(message => `${result.filePath}:${message.line}:${message.column}: ${message.message}`))

  if (errors.length > 0) throw new Error(errors.join('\n'))
})
