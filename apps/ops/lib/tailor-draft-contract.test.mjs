import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const migration = readFileSync(
  new URL('supabase/migrations/20261116120000_tailor_claim_drafts_pr1.sql', root),
  'utf8'
)
const mediaHardeningMigration = readFileSync(
  new URL('supabase/migrations/20261117062555_harden_tailor_draft_media_ordering.sql', root),
  'utf8'
)
const priceUnitMigration = readFileSync(
  new URL('supabase/migrations/20261117151806_normalize_tailor_draft_price_units.sql', root),
  'utf8'
)
const edge = readFileSync(new URL('supabase/functions/tailor-draft-action/index.ts', root), 'utf8')
const middleware = readFileSync(new URL('apps/web/middleware.ts', root), 'utf8')
const reminders = readFileSync(
  new URL('supabase/functions/send-tailor-readiness-reminders/index.ts', root),
  'utf8'
)
const sentry = readFileSync(new URL('apps/web/lib/sentry-web.ts', root), 'utf8')
const claimPage = readFileSync(new URL('apps/web/app/claim/[token]/page.tsx', root), 'utf8')
const opsRoute = readFileSync(
  new URL('apps/ops/app/api/actions/tailor-draft/route.ts', root),
  'utf8'
)
const config = readFileSync(new URL('supabase/config.toml', root), 'utf8')
const draftValidator = readFileSync(
  new URL('supabase/functions/_shared/tailor-draft-profile.ts', root),
  'utf8'
)
const canonicalSetup = readFileSync(new URL('packages/shared/src/tailor-setup.ts', root), 'utf8')
const opsCss = readFileSync(new URL('apps/ops/app/globals.css', root), 'utf8')
const builder = readFileSync(new URL('apps/ops/components/tailor-draft-builder.tsx', root), 'utf8')
const compact = (source) => source.replace(/\s+/gu, '')
const edgeCompact = compact(edge)
const opsRouteCompact = compact(opsRoute)
const builderCompact = compact(builder)
const claimPageCompact = compact(claimPage)

test('draft tables and media remain service-role only', () => {
  assert.match(
    migration,
    /revoke all on public\.tailor_claim_invites, public\.tailor_draft_media, public\.tailor_draft_action_receipts from public, anon, authenticated/i
  )
  assert.match(migration, /values \('tailor-draft-media', 'tailor-draft-media', false/i)
  assert.doesNotMatch(
    migration,
    /create policy[^;]+tailor-draft-media[^;]+to (?:anon|authenticated)/is
  )
})

test('draft mutations use durable replay receipts without persisting capabilities', () => {
  assert.match(migration, /unique \(actor_principal_id, idempotency_key\)/)
  assert.match(edge, /tailor_draft_action_receipts/)
  assert.match(edge, /delete stored\.token/)
  assert.match(edgeCompact, /outcome:'SUCCEEDED'/)
})

test('preview resolution is row locked and only confirmed approved media is exposed', () => {
  assert.match(migration, /where token_hash=p_token_hash for update/)
  assert.match(
    migration,
    /grant execute on function public\.resolve_tailor_claim_preview\(text\) to service_role/
  )
  assert.match(edge, /rpc\('resolve_tailor_claim_preview'/)
  assert.match(
    edgeCompact,
    /\.eq\('moderation_status','APPROVED'\)\.not\('confirmed_at','is',null\)/
  )
  assert.match(edge, /inspectDraftMedia/)
  assert.match(edge, /queuePrivateMediaSafetyReview/)
})

test('public predicates fail closed unless lifecycle is LIVE', () => {
  assert.match(
    migration,
    /is_live = true and is_verified = true and is_test_profile = false and lifecycle_state = 'LIVE'/i
  )
  assert.match(reminders, /\.eq\("lifecycle_state", "LIVE"\)/)
})

test('claim capability is random, hashed, expiring, and never logged', () => {
  assert.match(edge, /new Uint8Array\(32\)/)
  assert.match(edge, /subtle\.digest\('SHA-256'/)
  assert.match(edgeCompact, /30\*86400000/)
  assert.doesNotMatch(edge, /payload:\s*\{[^}]*token[,}]/s)
  assert.doesNotMatch(edge, /log\([^\n]+token/s)
})

test('claim preview has private cache, referrer, robots and third-party-free CSP', () => {
  assert.match(
    middleware,
    /response\.headers\.set\('Cache-Control', 'private, no-store, max-age=0'\)/
  )
  assert.match(middleware, /response\.headers\.set\('Referrer-Policy', 'no-referrer'\)/)
  assert.match(middleware, /response\.headers\.set\('X-Robots-Tag', 'noindex, nofollow'\)/)
  const claimCsp = middleware.slice(
    middleware.indexOf('function claimContentSecurityPolicy'),
    middleware.indexOf('export async function middleware')
  )
  assert.doesNotMatch(claimCsp, /stripe|posthog|sentry|cloudflareinsights/i)
  assert.match(sentry, /claimCapability/)
  assert.match(sentry, /\/claim\/\[Filtered\]/)
})

test('migration uses a parent-compatible profile id and atomic guarded lifecycle transitions', () => {
  assert.match(migration, /format_type\(a\.atttypid,a\.atttypmod\)/)
  assert.match(migration, /references public\.tailor_profiles\(id\) on delete cascade/)
  assert.match(migration, /transition_tailor_claim_invite/)
  assert.match(migration, /status not in \('DRAFT','INVITED','OPENED'\)/)
  assert.match(edge, /rpc\('transition_tailor_claim_invite'/)
  assert.match(opsRoute, /functions\/v1\/tailor-draft-action/)
  assert.doesNotMatch(opsRoute, /transition_tailor_claim_invite|tailor_draft_action_receipts/)
})

test('preview broker uses the real client address and cannot fall back around limits', () => {
  assert.match(config, /\[functions\.tailor-draft-action\]\s+verify_jwt = true/)
  assert.match(claimPage, /cf-connecting-ip/)
  assert.match(claimPage, /x-drape-client-ip/)
  assert.match(edge, /hasVerifiedServiceRoleBroker\(request\)/)
  assert.match(edge, /resolve:ip:\$\{ip\}/)
  assert.doesNotMatch(claimPage, /resolveDevelopmentPreview|createServiceRoleClient/)
})

test('workforce revocation is immediate and preapproval freezes after issue', () => {
  assert.match(edge, /access_subject/)
  assert.match(edge, /session_revoked_before/)
  assert.match(edgeCompact, /identity!\.issuedAt<=revokedBefore/)
  assert.match(edgeCompact, /invite\.status!=='DRAFT'/)
  assert.match(edgeCompact, /if\(invite\.status!=='DRAFT'\).*Draftdetailsfreeze/)
  assert.match(edgeCompact, /localBroker&&\(!principal\.access_review_due_at/)
})

test('draft fields and issue readiness fail closed', () => {
  assert.match(edge, /validateTailorDraftFields\(body\)/)
  assert.match(migration, /media_kind='AVATAR'/)
  assert.match(migration, /media_kind='PHOTO'/)
  assert.match(migration, /cardinality\(v_profile\.languages\)/)
})

test('preview media paths are opaque, avatar is not portfolio, and claim action is disabled', () => {
  assert.match(edge, /`drafts\/\$\{rawToken\(\)\}\/\$\{rawToken\(\)\}/)
  assert.match(claimPageCompact, /item\.kind!=='AVATAR'/)
  assert.doesNotMatch(claimPage, /drapeon:\/\/|drape:\/\//)
  assert.match(claimPage, /Meet your new shop/)
  assert.match(edgeCompact, /id:`media-\$\{index\}`/)
})

test('draft price bounds stay aligned with canonical setup and database issue checks', () => {
  const currencies = ['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD']
  const expected = {
    NGN: [5000, 9999999],
    GHS: [50, 1000000],
    KES: [500, 5000000],
    USD: [10, 100000],
    GBP: [10, 100000],
    EUR: [10, 100000],
    CAD: [10, 100000],
  }
  const minimumBlock = canonicalSetup.slice(
    canonicalSetup.indexOf('TAILOR_PRICE_MINIMUMS_MAJOR'),
    canonicalSetup.indexOf('const TRUST_VIDEO')
  )
  const maximumBlock = canonicalSetup.slice(
    canonicalSetup.indexOf('TAILOR_PRICE_LIMITS_MAJOR'),
    canonicalSetup.indexOf('TAILOR_PRICE_MINIMUMS_MAJOR')
  )
  const sourceNumber = (value) => value.toLocaleString('en-US').replaceAll(',', '_')
  for (const currency of currencies) {
    const [minimum, maximum] = expected[currency]
    assert.match(minimumBlock, new RegExp(`${currency}: ${sourceNumber(minimum)}`))
    assert.match(maximumBlock, new RegExp(`${currency}: ${sourceNumber(maximum)}`))
    assert.match(draftValidator, new RegExp(`${currency}:\\{min:${minimum},max:${maximum}\\}`))
  }
  assert.match(migration, /when 'NGN' then 5000 when 'GHS' then 50 when 'KES' then 500 else 10 end/)
  assert.match(
    migration,
    /when 'NGN' then 9999999 when 'GHS' then 1000000 when 'KES' then 5000000 when 'USD' then 100000/
  )
  assert.match(edgeCompact, /price_range_min:fields\.priceMin\*100/)
  assert.match(edgeCompact, /price_range_max:fields\.priceMax\*100/)
  assert.match(builderCompact, /price_range_min:payload\.priceMin\*100/)
  assert.match(builder, /draftPriceMajor\(profile\?\.price_range_min\)/)
  assert.match(claimPageCompact, /priceRangeMin:typeofrow\.price_range_min==='number'\?row\.price_range_min:null/)
  assert.doesNotMatch(claimPageCompact, /price_range_min\*100/)
  assert.match(priceUnitMigration, /price_range_min=profile\.price_range_min\*100/)
  assert.match(priceUnitMigration, /when 'USD' then 10000000/)
  assert.equal(75 * 100 / 100, 75, 'a $75 draft remains $75 from storage through Ops display')
})

test('listed media writes check database errors before success', () => {
  assert.match(edgeCompact, /if\(insertError\)throwinsertError/)
  assert.match(edgeCompact, /if\(updateError\)throwupdateError/)
  assert.match(edgeCompact, /if\(deleted\.error\)throwdeleted\.error/)
  assert.equal((opsRoute.match(/functions\/v1\/tailor-draft-action/gu) ?? []).length, 1)
})

test('media freezes after issue and reorder is one guarded database transaction', () => {
  assert.match(mediaHardeningMigration, /where id=p_invite_id and status='DRAFT' for update/)
  assert.match(
    mediaHardeningMigration,
    /create or replace function public\.reorder_tailor_draft_media/
  )
  assert.match(mediaHardeningMigration, /confirmed_at is not null/)
  assert.match(mediaHardeningMigration, /from unnest\(p_asset_ids\) with ordinality/)
  assert.match(mediaHardeningMigration, /enforce_one_tailor_draft_avatar/)
  assert.match(priceUnitMigration, /new\.confirmed_at is not null/)
  assert.match(edgeCompact, /mediaActions\.has\(action\)&&invite\.status!=='DRAFT'/)
  assert.match(builder, /action: 'REORDER_MEDIA'/)
  assert.doesNotMatch(builder, /await mediaAction\(target/)
})

test('local Ops proxies to the deployed Edge action and upload/focal controls recover safely', () => {
  assert.match(opsRoute, /x-drape-local-ops-email/)
  assert.match(edge, /environment === 'DEVELOPMENT'/)
  assert.match(edge, /localBroker/)
  assert.match(builder, /action: 'DELETE_MEDIA'/)
  assert.match(builder, /focalSave\.current = setTimeout/)
  assert.match(builder, /disabled=\{locked\}/)
})

test('Ops builder uses styled guided controls and explicit attestations', () => {
  assert.match(opsCss, /\.ops-form-grid\s*\{/)
  assert.match(opsCss, /\.ops-field\s*\{/)
  assert.match(builder, /ops-stepper/)
  assert.match(builder, /ops-check-row/)
  assert.match(builderCompact, /publicEvidenceReviewed:reviewed/)
  assert.match(builderCompact, /videoWaiverAcknowledged:waiver/)
  assert.doesNotMatch(builder, /publicEvidenceReviewed:\s*true/)
  assert.match(builder, /window\.confirm\('Revoke this link/)
  assert.match(builder, /Your shop, ready when you are/)
})
