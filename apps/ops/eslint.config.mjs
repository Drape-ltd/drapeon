import { globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextVitals,
  globalIgnores([
    '.next/**',
    '.next-build/**',
    '.next-dev/**',
    '.next-qa/**',
    '.open-next/**',
    'node_modules/**',
    'next-env.d.ts',
    'opennextjs-cloudflare.d.ts',
    'react-jsx.d.ts',
    'wrangler.jsonc',
    'public/ops-sw.js',
  ]),
  {
    rules: {
      // These pages are forced-dynamic operational reads. Freshness, SLA, and
      // snooze comparisons intentionally use the request/render instant.
      'react-hooks/purity': 'off',
    },
  },
]

export default eslintConfig
