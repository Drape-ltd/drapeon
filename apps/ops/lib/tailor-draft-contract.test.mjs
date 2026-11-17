import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root=new URL('../../../',import.meta.url)
const migration=readFileSync(new URL('supabase/migrations/20261116120000_tailor_claim_drafts_pr1.sql',root),'utf8')
const edge=readFileSync(new URL('supabase/functions/tailor-draft-action/index.ts',root),'utf8')
const middleware=readFileSync(new URL('apps/web/middleware.ts',root),'utf8')
const reminders=readFileSync(new URL('supabase/functions/send-tailor-readiness-reminders/index.ts',root),'utf8')
const sentry=readFileSync(new URL('apps/web/lib/sentry-web.ts',root),'utf8')

test('draft tables and media remain service-role only',()=>{
  assert.match(migration,/revoke all on public\.tailor_claim_invites, public\.tailor_draft_media, public\.tailor_draft_action_receipts from public, anon, authenticated/i)
  assert.match(migration,/values \('tailor-draft-media', 'tailor-draft-media', false/i)
  assert.doesNotMatch(migration,/create policy[^;]+tailor-draft-media[^;]+to (?:anon|authenticated)/is)
})

test('draft mutations use durable replay receipts without persisting capabilities',()=>{
  assert.match(migration,/unique \(actor_principal_id, idempotency_key\)/)
  assert.match(edge,/tailor_draft_action_receipts/)
  assert.match(edge,/delete stored\.token/)
  assert.match(edge,/outcome:'SUCCEEDED'/)
})

test('preview resolution is row locked and only confirmed approved media is exposed',()=>{
  assert.match(migration,/where token_hash=p_token_hash for update/)
  assert.match(migration,/grant execute on function public\.resolve_tailor_claim_preview\(text\) to service_role/)
  assert.match(edge,/rpc\('resolve_tailor_claim_preview'/)
  assert.match(edge,/\.eq\('moderation_status','APPROVED'\)\.not\('confirmed_at','is',null\)/)
  assert.match(edge,/inspectDraftMedia/)
  assert.match(edge,/queuePrivateMediaSafetyReview/)
})

test('public predicates fail closed unless lifecycle is LIVE',()=>{
  assert.match(migration,/is_live = true and is_verified = true and is_test_profile = false and lifecycle_state = 'LIVE'/i)
  assert.match(reminders,/\.eq\("lifecycle_state", "LIVE"\)/)
})

test('claim capability is random, hashed, expiring, and never logged',()=>{
  assert.match(edge,/new Uint8Array\(32\)/)
  assert.match(edge,/subtle\.digest\('SHA-256'/)
  assert.match(edge,/30\*86400000/)
  assert.doesNotMatch(edge,/payload:\s*\{[^}]*token[,}]/s)
  assert.doesNotMatch(edge,/log\([^\n]+token/s)
})

test('claim preview has private cache, referrer, robots and third-party-free CSP',()=>{
  assert.match(middleware,/response\.headers\.set\('Cache-Control', 'private, no-store, max-age=0'\)/)
  assert.match(middleware,/response\.headers\.set\('Referrer-Policy', 'no-referrer'\)/)
  assert.match(middleware,/response\.headers\.set\('X-Robots-Tag', 'noindex, nofollow'\)/)
  const claimCsp=middleware.slice(middleware.indexOf('function claimContentSecurityPolicy'),middleware.indexOf('export async function middleware'))
  assert.doesNotMatch(claimCsp,/stripe|posthog|sentry|cloudflareinsights/i)
  assert.match(sentry,/claimCapability/)
  assert.match(sentry,/\/claim\/\[Filtered\]/)
})
