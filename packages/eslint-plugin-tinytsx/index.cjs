const noUnsupportedSyntax = require('./rules/no-unsupported-syntax.cjs')
const {version} = require('./package.json')

const plugin = {
  meta: {
    name: 'eslint-plugin-tinytsx',
    namespace: 'tinytsx',
    version,
  },
  configs: {},
  rules: {
    'no-unsupported-syntax': noUnsupportedSyntax,
  },
}

const flatRecommended = [{
  name: 'tinytsx/recommended',
  plugins: {tinytsx: plugin},
  rules: {'tinytsx/no-unsupported-syntax': 'error'},
}]

plugin.configs.recommended = flatRecommended
plugin.configs['flat/recommended'] = flatRecommended
plugin.configs['legacy-recommended'] = {
  plugins: ['tinytsx'],
  rules: {'tinytsx/no-unsupported-syntax': 'error'},
}

module.exports = plugin
