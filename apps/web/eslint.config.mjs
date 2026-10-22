import { globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextVitals,
  globalIgnores([
    '.next/**',
    '.next-build/**',
    '.next-live/**',
    '.open-next/**',
    'node_modules/**',
    'next-env.d.ts',
    'opennextjs-cloudflare.d.ts',
    'react-jsx.d.ts',
    'wrangler.jsonc',
  ]),
]

export default eslintConfig
