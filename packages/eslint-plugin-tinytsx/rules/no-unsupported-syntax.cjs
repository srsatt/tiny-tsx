const FORBIDDEN_CALLS = new Set(['eval', 'require', 'Function'])
const SUPPORTED_INTRINSIC_ATTRIBUTES = new Set([
  'class',
  'className',
  'href',
  'id',
  'lang',
  'name',
  'placeholder',
  'style',
  'title',
  'type',
  'value',
])

const ALLOW_CATEGORIES = [
  'class-inheritance',
  'decorators',
  'dynamic-computed-access',
  'dynamic-import',
  'generators',
  'meta-properties',
  'runtime-code-generation',
  'typescript-runtime-syntax',
  'unsupported-intrinsic-jsx-attributes',
  'with-statements',
]

function optionsFor(context) {
  const options = context.options[0] ?? {}
  return {
    additionalIntrinsicJsxAttributes: new Set(options.additionalIntrinsicJsxAttributes ?? []),
    allow: new Set(options.allow ?? []),
  }
}

function isAllowed(options, category) {
  return options.allow.has(category)
}

function isClosedComputedProperty(node) {
  if (node.type === 'Literal') {
    return typeof node.value === 'string' || typeof node.value === 'number'
  }
  return node.type === 'TemplateLiteral' && node.expressions.length === 0
}

function isIntrinsicElement(openingElement) {
  const name = openingElement.name
  return name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name)
}

function isAmbientTypeScript(node, context) {
  return node.declare === true
    || node.global === true
    || context.filename.endsWith('.d.ts')
}

function generatorVisitor(context, options) {
  return node => {
    if (node.generator && !isAllowed(options, 'generators')) {
      context.report({node, messageId: 'generator'})
    }
  }
}

function computedPropertyVisitor(context, options) {
  return node => {
    if (
      node.computed
      && !isClosedComputedProperty(node.property ?? node.key)
      && !isAllowed(options, 'dynamic-computed-access')
    ) {
      context.report({node, messageId: 'dynamicComputedAccess'})
    }
  }
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'reject syntax outside the statically checkable TinyTSX application subset',
      recommended: true,
      url: 'https://github.com/srsatt/tiny-tsx/tree/main/packages/eslint-plugin-tinytsx#no-unsupported-syntax',
    },
    messages: {
      classInheritance: 'Application class inheritance is outside the TinyTSX syntax subset.',
      decorator: 'Decorators are outside the TinyTSX syntax subset.',
      dynamicComputedAccess: 'Computed access must use a literal key or be proven closed by the compiler.',
      dynamicImport: 'Dynamic import is outside the TinyTSX static module graph.',
      generator: 'Generator functions are outside the TinyTSX execution model.',
      intrinsicJsxAttribute: 'Intrinsic JSX attribute `{{name}}` is not supported by TinyTSX.',
      metaProperty: 'Meta property `{{name}}` is outside the TinyTSX syntax subset.',
      runtimeCodeGeneration: '`{{name}}` requires runtime code loading or generation and is not supported.',
      typescriptRuntimeSyntax: 'TypeScript {{kind}} runtime syntax is outside the TinyTSX module subset.',
      withStatement: '`with` statements are outside the TinyTSX static scope model.',
    },
    schema: [{
      type: 'object',
      additionalProperties: false,
      properties: {
        additionalIntrinsicJsxAttributes: {
          type: 'array',
          uniqueItems: true,
          items: {type: 'string', minLength: 1},
        },
        allow: {
          type: 'array',
          uniqueItems: true,
          items: {enum: ALLOW_CATEGORIES},
        },
      },
    }],
  },

  create(context) {
    const options = optionsFor(context)
    const visitGenerator = generatorVisitor(context, options)
    const visitComputedProperty = computedPropertyVisitor(context, options)

    return {
      FunctionDeclaration: visitGenerator,
      FunctionExpression: visitGenerator,

      CallExpression(node) {
        if (
          node.callee.type === 'Identifier'
          && FORBIDDEN_CALLS.has(node.callee.name)
          && !isAllowed(options, 'runtime-code-generation')
        ) {
          context.report({
            node,
            messageId: 'runtimeCodeGeneration',
            data: {name: node.callee.name},
          })
        }
      },

      NewExpression(node) {
        if (
          node.callee.type === 'Identifier'
          && node.callee.name === 'Function'
          && !isAllowed(options, 'runtime-code-generation')
        ) {
          context.report({
            node,
            messageId: 'runtimeCodeGeneration',
            data: {name: node.callee.name},
          })
        }
      },

      MemberExpression: visitComputedProperty,
      MethodDefinition: visitComputedProperty,
      Property: visitComputedProperty,
      PropertyDefinition: visitComputedProperty,

      ClassDeclaration(node) {
        if (node.superClass && !isAllowed(options, 'class-inheritance')) {
          context.report({node: node.superClass, messageId: 'classInheritance'})
        }
      },

      ClassExpression(node) {
        if (node.superClass && !isAllowed(options, 'class-inheritance')) {
          context.report({node: node.superClass, messageId: 'classInheritance'})
        }
      },

      Decorator(node) {
        if (!isAllowed(options, 'decorators')) {
          context.report({node, messageId: 'decorator'})
        }
      },

      ImportExpression(node) {
        if (!isAllowed(options, 'dynamic-import')) {
          context.report({node, messageId: 'dynamicImport'})
        }
      },

      MetaProperty(node) {
        if (!isAllowed(options, 'meta-properties')) {
          context.report({
            node,
            messageId: 'metaProperty',
            data: {name: `${node.meta.name}.${node.property.name}`},
          })
        }
      },

      TSModuleDeclaration(node) {
        if (!isAmbientTypeScript(node, context) && !isAllowed(options, 'typescript-runtime-syntax')) {
          context.report({node, messageId: 'typescriptRuntimeSyntax', data: {kind: 'namespace'}})
        }
      },

      TSEnumDeclaration(node) {
        if (!isAmbientTypeScript(node, context) && !isAllowed(options, 'typescript-runtime-syntax')) {
          context.report({node, messageId: 'typescriptRuntimeSyntax', data: {kind: 'enum'}})
        }
      },

      TSImportEqualsDeclaration(node) {
        if (!isAmbientTypeScript(node, context) && !isAllowed(options, 'typescript-runtime-syntax')) {
          context.report({node, messageId: 'typescriptRuntimeSyntax', data: {kind: 'import-equals'}})
        }
      },

      TSExportAssignment(node) {
        if (!isAmbientTypeScript(node, context) && !isAllowed(options, 'typescript-runtime-syntax')) {
          context.report({node, messageId: 'typescriptRuntimeSyntax', data: {kind: 'export-assignment'}})
        }
      },

      WithStatement(node) {
        if (!isAllowed(options, 'with-statements')) {
          context.report({node, messageId: 'withStatement'})
        }
      },

      JSXAttribute(node) {
        if (isAllowed(options, 'unsupported-intrinsic-jsx-attributes')) return
        if (node.name.type !== 'JSXIdentifier') return
        const openingElement = node.parent
        if (!openingElement || openingElement.type !== 'JSXOpeningElement') return
        if (!isIntrinsicElement(openingElement)) return
        const name = node.name.name
        if (
          SUPPORTED_INTRINSIC_ATTRIBUTES.has(name)
          || options.additionalIntrinsicJsxAttributes.has(name)
          || name.startsWith('aria-')
          || name.startsWith('data-')
        ) return
        context.report({node: node.name, messageId: 'intrinsicJsxAttribute', data: {name}})
      },
    }
  },
}
