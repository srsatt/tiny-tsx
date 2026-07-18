import type {Linter, Rule} from 'eslint'

declare namespace plugin {
  interface NoUnsupportedSyntaxOptions {
    additionalIntrinsicJsxAttributes?: string[]
    allow?: Array<
      | 'class-inheritance'
      | 'decorators'
      | 'dynamic-computed-access'
      | 'dynamic-import'
      | 'generators'
      | 'meta-properties'
      | 'runtime-code-generation'
      | 'typescript-runtime-syntax'
      | 'unsupported-intrinsic-jsx-attributes'
      | 'with-statements'
    >
  }
}

declare const plugin: {
  meta: {
    name: 'eslint-plugin-tinytsx'
    namespace: 'tinytsx'
    version: string
  }
  rules: {
    'no-unsupported-syntax': Rule.RuleModule
  }
  configs: {
    recommended: Linter.Config[]
    'flat/recommended': Linter.Config[]
    'legacy-recommended': Linter.LegacyConfig
  }
}

export = plugin
