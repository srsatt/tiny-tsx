import tinytsx = require('eslint-plugin-tinytsx')

const recommended = tinytsx.configs.recommended
const rule = tinytsx.rules['no-unsupported-syntax']
const options: tinytsx.NoUnsupportedSyntaxOptions = {
  allow: ['dynamic-computed-access'],
}

void recommended
void rule
void options
