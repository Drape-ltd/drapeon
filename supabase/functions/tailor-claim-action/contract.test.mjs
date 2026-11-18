import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('../../migrations/20261117212042_add_tailor_claim_email_codes.sql', import.meta.url),
  'utf8'
)
const collisionMigration = readFileSync(
  new URL(
    '../../migrations/20261117212930_add_tailor_claim_email_collision_guard.sql',
    import.meta.url
  ),
  'utf8'
)
const hardeningMigration = readFileSync(
  new URL(
    '../../migrations/20261117213656_harden_tailor_claim_email_verification.sql',
    import.meta.url
  ),
  'utf8'
)
const bootstrapMigration = readFileSync(
  new URL(
    '../../migrations/20261117225500_add_tailor_claim_bootstrap_sessions.sql',
    import.meta.url
  ),
  'utf8'
)
const providerBootstrapMigration = readFileSync(
  new URL(
    '../../migrations/20261118021045_add_tailor_claim_provider_bootstrap.sql',
    import.meta.url
  ),
  'utf8'
)
const providerProofMigration = readFileSync(
  new URL(
    '../../migrations/20261118023943_verify_tailor_claim_provider_before_bootstrap.sql',
    import.meta.url
  ),
  'utf8'
)
const sharedAuth = readFileSync(new URL('../_shared/auth.ts', import.meta.url), 'utf8')
const claimTransitionMigration = readFileSync(
  new URL('../../migrations/20261118190130_add_tailor_claim_transition.sql', import.meta.url),
  'utf8'
)
const finalizeMigration = readFileSync(
  new URL('../../migrations/20261118190140_add_tailor_claim_finalize.sql', import.meta.url),
  'utf8'
)
const recoveryMigration = readFileSync(
  new URL('../../migrations/20261118194515_recover_interrupted_tailor_claims.sql', import.meta.url),
  'utf8'
)
const handoverMigration = readFileSync(
  new URL(
    '../../migrations/20261118203934_protect_tailor_claim_auth_handover.sql',
    import.meta.url
  ),
  'utf8'
)
const phoneGuardMigration = readFileSync(
  new URL(
    '../../migrations/20261118212546_guard_tailor_claim_phone_before_auth.sql',
    import.meta.url
  ),
  'utf8'
)
const providerCleanupMigration = readFileSync(
  new URL(
    '../../migrations/20261122013431_harden_tailor_claim_provider_cleanup_and_anon_pre_request.sql',
    import.meta.url
  ),
  'utf8'
)
const mobileClaim = readFileSync(
  new URL('../../../apps/mobile/app/claim/[token].tsx', import.meta.url),
  'utf8'
)
const mobileTailorSetup = readFileSync(
  new URL('../../../apps/mobile/app/(tailor)/profile/setup.tsx', import.meta.url),
  'utf8'
)
const mobileRootLayout = readFileSync(
  new URL('../../../apps/mobile/app/_layout.tsx', import.meta.url),
  'utf8'
)
const webClaim = readFileSync(
  new URL('../../../apps/web/components/claim-web-flow.tsx', import.meta.url),
  'utf8'
)

test('public resolver fails closed and returns no draft identifiers', () => {
  assert.match(source, /resolve_tailor_claim_preview/)
  assert.match(source, /rateLimit\(client, ip/)
  assert.match(source, /rateLimit\(\s*client,\s*hash/)
  assert.match(source, /return json\(\{ actionable: true \}\)/)
  assert.doesNotMatch(source, /return json\(\{[^\n]*(invite_id|profile_id)/)
})

test('the public resolver explicitly owns JWT and audit handling', () => {
  assert.match(config, /\[functions\.tailor-claim-action\]\s+verify_jwt = false/u)
  assert.match(source, /await audit\(client/)
  assert.match(source, /tailor_claim\.app_link_opened/)
})

test('claim email codes store digests and enforce the agreed budgets', () => {
  assert.match(migration, /code_hash text not null/)
  assert.match(migration, /email_hash text not null/)
  assert.doesNotMatch(migration, /\bcode text\b|\bemail text\b/)
  assert.match(migration, /now\(\) \+ interval '10 minutes'/)
  assert.match(migration, /attempts between 0 and 5/)
  assert.match(migration, /v_hour_count >= 5/)
  assert.match(migration, /v_day_count >= 10/)
  assert.match(migration, /CODE_REQUEST_LIMIT/)
  assert.match(migration, /CODE_ATTEMPT_LIMIT/)
})

test('the client is told sent only after a provider outcome is recorded', () => {
  const recordCall = source.indexOf("'record_tailor_claim_email_job_outcome'")
  const sentResponse = source.indexOf('return json({ sent: true')
  assert.ok(recordCall > 0)
  assert.ok(sentResponse > recordCall)
  assert.match(source, /recorded !== true/)
  assert.match(source, /Idempotency-Key/)
})

test('a verified address collision stops before any account mutation', () => {
  assert.match(collisionMigration, /auth\.users/)
  assert.match(collisionMigration, /public\.users/)
  assert.match(collisionMigration, /ACCOUNT_CONFLICT/)
  assert.match(collisionMigration, /v_code\.code_hash = p_code_hash/)
  assert.doesNotMatch(collisionMigration, /update\s+auth\.users|update\s+public\.users/)
  assert.match(source, /error: 'ACCOUNT_CONFLICT'/)
})

test('email and code digests use the dedicated claim HMAC key', () => {
  assert.match(source, /TAILOR_CLAIM_HMAC_KEY/)
  assert.match(source, /keyedHash\(`email:/)
  assert.match(source, /keyedHash\(`code:/)
  assert.doesNotMatch(source, /importKey\([\s\S]{0,160}getServiceRoleKey\(\)/)
})

test('state gates precede the account collision lookup', () => {
  const inviteGate = hardeningMigration.indexOf("v_invite.status not in ('INVITED', 'OPENED')")
  const pathGate = hardeningMigration.indexOf('v_path.locked_at is not null')
  const expiryGate = hardeningMigration.indexOf('v_code.expires_at <= now()')
  const collision = hardeningMigration.indexOf('select 1 from auth.users')
  assert.ok(inviteGate > 0 && inviteGate < collision)
  assert.ok(pathGate > inviteGate && pathGate < collision)
  assert.ok(expiryGate > pathGate && expiryGate < collision)
  assert.match(hardeningMigration, /where au\.email = p_email/)
  assert.doesNotMatch(source, /ctaUrl: 'https:\/\/drapeon\.co'/)
})

test('bootstrap session is short-lived and the real JWT stays inert outside claim', () => {
  assert.match(bootstrapMigration, /now\(\) \+ interval '10 minutes'/)
  assert.match(bootstrapMigration, /is_staff_draft_identity/)
  assert.match(bootstrapMigration, /as restrictive for all to authenticated/)
  assert.match(bootstrapMigration, /not public\.is_staff_draft_identity\(\)/)
  assert.match(bootstrapMigration, /is_active_tailor_claim_bootstrap_session/)
  assert.match(bootstrapMigration, /auth_session_id = nullif\(auth\.jwt\(\) ->> 'session_id'/)
  assert.match(sharedAuth, /account_origin === 'STAFF_DRAFT'/)
  assert.match(sharedAuth, /blocked STAFF_DRAFT claim session/)
  assert.match(source, /BOOTSTRAP_EMAIL_SESSION/)
  assert.match(source, /type: 'magiclink'/)
  assert.match(source, /verifyOtp/)
  assert.match(source, /activate_tailor_claim_bootstrap_session/)
})

test('provider identity is proved and collision-checked before placeholder unlock', () => {
  assert.match(providerProofMigration, /prepare_tailor_claim_provider_proof/)
  assert.match(providerProofMigration, /record_tailor_claim_provider_proof/)
  assert.match(providerProofMigration, /from auth\.identities identity/)
  assert.match(providerProofMigration, /identity\.provider_id = p_provider_subject/)
  assert.match(providerProofMigration, /tailor_claim\.provider_account_conflict/)
  assert.match(providerProofMigration, /tailor_claim\.bootstrap_session_superseded/)
  assert.match(source, /PREPARE_PROVIDER_PROOF/)
  assert.match(source, /SUBMIT_PROVIDER_PROOF/)
  assert.match(source, /jwtVerify/)
  assert.match(source, /GOOGLE_CLIENT_IDS/)
  assert.match(source, /new Set\(audiences/)
  assert.match(source, /payload\.nonce !== nonceDigest/)
  assert.match(source, /preparation\.result === 'ACCOUNT_CONFLICT'/)
  assert.ok(
    source.indexOf('record_tailor_claim_provider_proof') < source.indexOf("ban_duration: 'none'")
  )
  assert.match(
    source,
    /getActiveStaffDraftClaimSession\(request,\s*\{\s*allowSessionRebind: true,?\s*\}\s*\)/
  )
  assert.match(sharedAuth, /options: \{ allowSessionRebind\?: boolean \} = \{\}/)
  assert.match(sharedAuth, /active\.auth_session_id !== authSessionId/)
  assert.match(sharedAuth, /p_old_auth_session_id: oldAuthSessionId/)
  assert.match(source, /identity\.provider === provider/)
  assert.match(source, /identity\.user_id === claimSession\.userId/)
  assert.match(source, /identity\.identity_data\?\.sub === ledger\.provider_subject/)
  assert.match(source, /invite\?\.token_hash !== hash/)
  assert.match(source, /REPORT_PROVIDER_CONFLICT/)
  assert.match(source, /FAIL_PROVIDER_SESSION/)
  assert.match(source, /recordError\?\.code === '23505'/)
  assert.match(source, /p_failure_code: 'PROVIDER_LINK_FAILED'/)
  assert.match(source, /fail_tailor_claim_provider_bootstrap_session/)
  assert.match(source, /tailor_claim\.provider_identity_verified/)
})

test('failed provider attempts remove linked identities and handover accepts only its proof identity', () => {
  assert.match(providerCleanupMigration, /delete from auth\.identities[\s\S]*provider <> 'email'/)
  assert.match(providerCleanupMigration, /cleanup_terminal_tailor_claim_provider_identity/)
  assert.match(providerCleanupMigration, /new\.status in \('FAILED', 'EXPIRED'\)/)
  assert.match(providerCleanupMigration, /provider = v_bootstrap\.provider[\s\S]*provider_id = v_bootstrap\.provider_subject/)
  assert.match(source, /const nonEmailIdentities = \(current\.user\.identities \?\? \[\]\)\.filter/)
  assert.match(source, /nonEmailIdentities\.length !== 1/)
  assert.match(source, /nonEmailIdentities\.length !== 0/)
})

test('PostgREST pre-request hook remains callable by signed-out catalogue traffic', () => {
  assert.match(providerCleanupMigration, /grant execute on function public\.reject_staff_draft_data_api_request\(\)[\s\S]*to authenticator, anon, authenticated, service_role/)
})

test('claim consumes proof once and has a durable idempotent receipt', () => {
  assert.match(claimTransitionMigration, /tailor_claim_transition_receipts/)
  assert.match(claimTransitionMigration, /status='CONSUMED'/)
  assert.match(claimTransitionMigration, /p_email<>lower\(trim\(p_email\)\)/)
  assert.match(claimTransitionMigration, /select 1 from auth\.users where email=p_email/)
  assert.match(claimTransitionMigration, /consent_media_manifest/)
  assert.match(claimTransitionMigration, /complete_tailor_profile_claim/)
  assert.match(claimTransitionMigration, /outcome='SUCCEEDED'/)
  assert.match(source, /action === 'CLAIM'/)
  assert.match(source, /validatePhoneForProfile/)
  assert.match(source, /prepare_tailor_profile_claim/)
  assert.match(source, /complete_tailor_profile_claim/)
  assert.match(source, /account_origin: 'CLAIMED'/)
  assert.match(source, /claim_session_id: null/)
  assert.match(source, /PHONE_ALREADY_IN_USE/)
  assert.match(source, /CLAIM_COMPLETION_RETRY/)
  assert.match(mobileClaim, /function claimFailureCopy/)
  assert.match(mobileClaim, /Phone already in use/)
  assert.match(source, /app_metadata: claimedAppMetadata/)
  assert.match(source, /identityUpdateError\.code === 'email_exists'/)
  assert.doesNotMatch(source, /already\|exists\|registered\|duplicate/)
  assert.match(source, /GET_CLAIM_CONTEXT/)
  assert.match(source, /consentTextVersion: 'tailor-imported-media-v1'/)
  assert.match(claimTransitionMigration, /fail_tailor_profile_claim_conflict/)
})

test('claim failures preserve actionable error codes for the app', () => {
  assert.doesNotMatch(source, /bootstrapped: false, retryable: true \}/)
  assert.doesNotMatch(source, /recorded: false, retryable: true \}/)
  for (const code of [
    'PHONE_ALREADY_IN_USE',
    'ACCOUNT_CONFLICT',
    'CODE_EXPIRED',
    'EMAIL_LOCKED',
    'CLAIM_SESSION_EXPIRED',
    'PROVIDER_PROOF_EXPIRED',
    'PROVIDER_IDENTITY_MISMATCH',
    'SECURE_SESSION_SETUP_RETRY',
    'CLAIM_COMPLETION_RETRY',
  ]) {
    assert.match(mobileClaim, new RegExp(`case '${code}'`))
  }
  assert.match(mobileClaim, /Connection interrupted/)
  assert.match(mobileClaim, /Alert\.alert\(failureTitle, failureMessage\)/)
})

test('phone collisions stop before Auth and remain correctable after handover', () => {
  assert.match(phoneGuardMigration, /normalize_account_phone_e164\(p_phone\)/)
  assert.match(phoneGuardMigration, /result:='PHONE_ALREADY_IN_USE'/)
  assert.ok(
    phoneGuardMigration.indexOf("result:='PHONE_ALREADY_IN_USE'") <
      phoneGuardMigration.indexOf('prepare_tailor_profile_claim_v1(')
  )
  assert.match(phoneGuardMigration, /update_tailor_profile_claim_phone/)
  assert.match(phoneGuardMigration, /auth_handover_at is not null/)
  assert.match(phoneGuardMigration, /tailor_claim\.phone_corrected_after_handover/)
  assert.match(phoneGuardMigration, /errcode='P1001',hint='PHONE_ALREADY_IN_USE'/)
  assert.match(source, /P1001: 'PHONE_ALREADY_IN_USE'/)
  assert.doesNotMatch(source, /message\.includes\('PHONE_ALREADY_IN_USE'\)/)
  assert.match(source, /recovery: failure === 'PHONE_ALREADY_IN_USE' \? 'CORRECT_PHONE'/)
  assert.match(mobileClaim, /accountStep === 'phone-recovery'/)
  assert.match(mobileClaim, /label="Use a different number"/)
})

test('claim session rebinds are constrained and audited atomically', () => {
  assert.match(phoneGuardMigration, /rebind_tailor_claim_bootstrap_auth_session/)
  assert.match(phoneGuardMigration, /tailor_claim\.auth_session_rebound/)
  assert.match(sharedAuth, /linkIdentity rotates the Supabase Auth session ID/)
  assert.match(sharedAuth, /rebind_tailor_claim_bootstrap_auth_session/)
})

test('interrupted and failed claims recover without minting a second shop', () => {
  assert.match(recoveryMigration, /i\.status in \('DRAFT','INVITED','OPENED','CLAIMING'\)/)
  assert.match(recoveryMigration, /failure_code='BOOTSTRAP_EXPIRED'/)
  assert.match(recoveryMigration, /status='OPENED'/)
  assert.match(recoveryMigration, /tailor_claim\.interrupted_claim_recovered/)
  assert.match(recoveryMigration, /tailor_claim\.failed_receipt_replaced/)
  assert.match(source, /\.not\('auth_handover_at', 'is', null\)/)
  assert.match(source, /\.eq\('token_hash', hash\)/)
  assert.match(source, /\.eq\('status', 'CLAIMING'\)/)
  assert.match(source, /\.eq\('invite_id', replayInvite\.id\)/)
  assert.doesNotMatch(source, /\.eq\('idempotency_key', idempotencyKey\)/)
  assert.match(source, /complete_tailor_profile_claim/)
  assert.match(mobileClaim, /idempotencyKey: `tailor-claim:\$\{claimSessionId\}`/)
  assert.match(mobileClaim, /account_origin === 'CLAIMED'/)
  assert.match(mobileClaim, /body: \{ action: 'CLAIM', token \}/)
  assert.match(webClaim, /idempotencyKey: `tailor-claim:\$\{claimSessionId\}`/)
  assert.match(webClaim, /href="drape:\/\/profile\/setup"/)
})

test('Auth handover survives bootstrap expiry and remains replayable', () => {
  assert.match(handoverMigration, /add column auth_handover_at timestamptz/)
  assert.match(handoverMigration, /record_tailor_profile_claim_auth_handover/)
  assert.match(handoverMigration, /v_auth_handed_over/)
  assert.match(handoverMigration, /handover_awaiting_replay/)
  assert.match(handoverMigration, /set auth_handover_at=coalesce\(auth_handover_at,now\(\)\)/)
  assert.match(source, /claim_session_id: null/)
  assert.match(source, /update\(\{ auth_handover_at: new Date\(\)\.toISOString\(\) \}\)/)
  assert.match(source, /handoverReceipt\?\.id !== preparation\.receipt_id/)
  assert.match(source, /\.eq\('outcome', 'IN_PROGRESS'\)/)
})

test('finalize rechecks readiness and publishes through a durable service-only receipt', () => {
  assert.match(finalizeMigration, /tailor_claim_finalize_receipts/)
  assert.match(finalizeMigration, /email_confirmed_at is null/)
  assert.match(finalizeMigration, /phone_verified_at is not null/)
  assert.match(finalizeMigration, /CONSENT_MANIFEST_STALE/)
  assert.match(finalizeMigration, /drape\.identity_verification_trusted_write/)
  assert.match(finalizeMigration, /id_verification_method='STAFF_PREAPPROVAL'/)
  assert.match(finalizeMigration, /is_verified=true,is_live=true,lifecycle_state='LIVE'/)
  assert.match(finalizeMigration, /outcome='SUCCEEDED'/)
  assert.match(source, /action === 'FINALIZE'/)
  assert.match(source, /prepare_tailor_profile_finalize/)
  assert.match(source, /destinationBucket: bucket/)
  assert.match(source, /complete_tailor_profile_finalize/)
  assert.match(finalizeMigration, /'next','ADD_PAYOUTS'/)
  assert.match(mobileTailorSetup, /ClaimLifecycleState/)
  assert.match(mobileTailorSetup, /Verify your phone to publish/)
  assert.match(mobileTailorSetup, /await ensurePhoneVerifiedForSetup\('finish'\)/)
  assert.match(mobileTailorSetup, /action: 'FINALIZE'/)
  assert.match(mobileTailorSetup, /Verify phone and publish/)
  assert.match(mobileRootLayout, /tailorClaimContinuationRequired/)
  assert.match(mobileRootLayout, /data\?\.lifecycle_state === 'CLAIMED_AWAITING_EMAIL'/)
  assert.match(mobileRootLayout, /router\.replace\('\/\(tailor\)\/profile\/setup'\)/)
  assert.match(mobileRootLayout, /getPendingTailorClaim/)
  assert.match(mobileRootLayout, /pathname: '\/claim\/\[token\]'/)
  assert.match(mobileClaim, /clearPendingTailorClaim/)
  assert.match(mobileClaim, /data\?\.actionable !== true[\s\S]*clearPendingTailorClaim/)
  assert.match(mobileRootLayout, /session && accountOrigin !== 'STAFF_DRAFT'/)
  assert.match(mobileClaim, /useDrapeCapsuleNavScroll/)
  assert.match(mobileClaim, /compactWidth=\{76\}/)
  assert.match(mobileClaim, /Sign in with Apple to finish/)
  assert.match(source, /createSignedUrls/)
  assert.match(source, /previewUrl/)
  assert.match(mobileClaim, /Photos and videos Drapeon will publish/)
})
