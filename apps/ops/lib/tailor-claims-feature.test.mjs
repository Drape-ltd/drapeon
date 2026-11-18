import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const feature = readFileSync(new URL('lib/tailor-claims-feature.ts', root), 'utf8')
const layout = readFileSync(new URL('app/ops/layout.tsx', root), 'utf8')
const page = readFileSync(new URL('app/ops/draft-tailors/page.tsx', root), 'utf8')
const broker = readFileSync(new URL('app/api/actions/tailor-draft/route.ts', root), 'utf8')
const shell = readFileSync(new URL('components/ops-shell.tsx', root), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const wrangler = readFileSync(new URL('wrangler.jsonc', root), 'utf8')

test('tailor claims require the explicit enabled value', () => {
  assert.match(feature, /DRAPE_TAILOR_CLAIMS_ENABLED === '1'/)
  assert.match(wrangler, /"DRAPE_TAILOR_CLAIMS_ENABLED": "0"/)
  assert.match(packageJson.scripts.dev, /DRAPE_TAILOR_CLAIMS_ENABLED=1/)
  assert.match(packageJson.scripts['dev:founder'], /DRAPE_TAILOR_CLAIMS_ENABLED=1/)
  assert.match(packageJson.scripts['dev:mfa'], /DRAPE_TAILOR_CLAIMS_ENABLED=1/)
})

test('navigation, page projection, and mutation broker all fail closed', () => {
  assert.match(layout, /tailorClaimsEnabled=\{isTailorClaimsEnabled\(\)\}/)
  assert.match(shell, /item\.href !== '\/ops\/draft-tailors' \|\| tailorClaimsEnabled/)
  assert.match(page, /if \(!isTailorClaimsEnabled\(\)\) return <OpsPermissionRestriction/)
  assert.match(broker, /if \(!isTailorClaimsEnabled\(\)\) return json\(\{ error: 'Draft tailors are not enabled\.' \}, 404\)/)
})
