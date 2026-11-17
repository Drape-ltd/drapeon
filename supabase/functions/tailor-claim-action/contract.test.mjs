import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8')

test('public resolver fails closed and returns no draft identifiers', () => {
  assert.match(source, /resolve_tailor_claim_preview/)
  assert.match(source, /rateLimit\(client, ip/)
  assert.match(source, /rateLimit\(client, hash/)
  assert.match(source, /return json\(\{ actionable: true \}\)/)
  assert.doesNotMatch(source, /return json\(\{[^\n]*(invite_id|profile_id)/)
})

test('the public resolver explicitly owns JWT and audit handling', () => {
  assert.match(config, /\[functions\.tailor-claim-action\]\s+verify_jwt = false/u)
  assert.match(source, /await audit\(client/)
  assert.match(source, /tailor_claim\.app_link_opened/)
})
