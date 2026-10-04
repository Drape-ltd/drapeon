/**
 * claim-passport
 *
 * Allows a customer to preview or atomically claim a tailor-issued
 * Client Passport (diary entry) identified by its passport_id UUID.
 *
 * Actions:
 *   preview  — returns tailor display name, client name, and how many
 *              measurements are filled in, without touching the database.
 *              Used to render a confirmation screen before claiming.
 *
 *   claim    — atomically marks the diary_entry as CLAIMED and copies the
 *              available measurements into both customer fit profiles.
 *              Fails if the entry is already claimed or the invite link has
 *              expired (invite_expires_at < now()).
 *
 * Security:
 *   - Caller must be authenticated (customer JWT).
 *   - Role is verified by checking for a customer_profiles row — tailors
 *     do not have one, so they cannot claim passports.
 *   - Rate limited to 10 attempts per user per hour to prevent brute force.
 *   - All passport lookups and the claim UPDATE use the service role client
 *     so RLS on diary_entries is bypassed server-side (not from the client).
 *   - claimed_by_user_id is never grantable to the authenticated role at DB
 *     level; it can only be written here via service role.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { z, parseBody, uuid } from '../_shared/validate.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { mergeDiaryMeasurementsIntoCustomerProfile } from '../_shared/fit-passport.ts'

const BodySchema = z.discriminatedUnion('action', [
  z.object({ passportId: uuid, action: z.literal('preview') }),
  z.object({ passportId: uuid, action: z.literal('claim') }),
])

const FN = 'claim-passport'

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.', message: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  const caller = await getAuthUser(req)
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── Service-role client (bypasses RLS for passport lookups and claim write) ─

  const service = createClient(
    getSupabaseUrl(),
    getServiceRoleKey(),
    { auth: { persistSession: false } },
  )

  // ── Rate limit — 10 attempts per user per hour ────────────────────────────

  const allowed = await checkRateLimit(service, `claim-passport:${caller.id}`, 3600, 10)
  if (!allowed) {
    return rateLimitExceededResponse(cors)
  }

  // ── Role check — must be a customer ──────────────────────────────────────

  const { data: customerProfile } = await service
    .from('customer_profiles')
    .select('id')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!customerProfile) {
    return new Response(
      JSON.stringify({ error: 'Only customers can claim passports.' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // ── Parse body ────────────────────────────────────────────────────────────

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.', message: 'Invalid request body.', code: 'INVALID_JSON' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const parsed = parseBody(BodySchema, rawBody)
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: 'This invite link could not be opened. Ask your tailor to resend it.', message: 'This invite link could not be opened. Ask your tailor to resend it.', code: 'VALIDATION_FAILED' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { passportId, action } = parsed.data

  // ── Fetch the diary entry ─────────────────────────────────────────────────

  const { data: entry, error: fetchErr } = await service
    .from('diary_entries')
    .select(`
      id, full_name, invite_status, invite_expires_at, claimed_by_user_id, updated_at,
      measurement_unit, chest, shoulder, sleeve, waist, hip, trouser_length, neck, inseam,
      thigh, ankle, bicep, wrist, back_length, under_bust, measured_at, measured_location,
      tailor_id
    `)
    .eq('passport_id', passportId)
    .maybeSingle()

  if (fetchErr) {
    console.error(`[${FN}] fetch error:`, fetchErr.message)
    return new Response(JSON.stringify({ error: 'Unexpected error. Please try again.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (!entry) {
    return new Response(JSON.stringify({ error: 'Passport not found.' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Count filled measurements (excluding unit field)
  const MEASUREMENT_FIELDS = ['chest', 'shoulder', 'sleeve', 'waist', 'hip', 'trouser_length', 'neck', 'inseam', 'thigh', 'ankle', 'bicep', 'wrist', 'back_length', 'under_bust'] as const
  const measurementCount = MEASUREMENT_FIELDS.filter((f) => (entry as any)[f] !== null).length

  // diary_entries.tailor_id references auth.users, not tailor_profiles.
  // Look up the public profile by its user key separately; a missing profile
  // must not make an otherwise valid passport impossible to claim.
  const { data: tailorProfile, error: tailorError } = await service
    .from('tailor_profiles')
    .select('display_name')
    .eq('user_id', entry.tailor_id)
    .maybeSingle()
  if (tailorError) console.warn(`[${FN}] tailor display name unavailable:`, tailorError.message)
  const tailorName = tailorProfile?.display_name ?? 'Your tailor'

  // ── PREVIEW ───────────────────────────────────────────────────────────────

  if (action === 'preview') {
    const expired = entry.invite_expires_at
      ? new Date(entry.invite_expires_at) < new Date()
      : false

    return new Response(
      JSON.stringify({
        clientName:      entry.full_name,
        tailorName,
        measurementCount,
        inviteStatus:    entry.invite_status,
        expired,
        alreadyClaimed:  entry.invite_status === 'CLAIMED',
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  // ── CLAIM ─────────────────────────────────────────────────────────────────

  // Build only the passport-owned patch. The database routine merges it into
  // the latest customer profile while holding row locks, avoiding stale writes.
  const patch = mergeDiaryMeasurementsIntoCustomerProfile({
    existing: null,
    diaryEntry: entry as Record<string, unknown>,
    claimedAt: new Date().toISOString(),
  })
  const { data: result, error: claimErr } = await service.rpc('claim_diary_passport_atomic', {
    p_passport_id: passportId,
    p_customer_id: caller.id,
    p_measurement_patch: patch,
    p_expected_updated_at: entry.updated_at,
  })
  if (claimErr) {
    console.error(`[${FN}] atomic claim error:`, claimErr.message)
    return new Response(JSON.stringify({ error: 'We could not save your measurements. Nothing was claimed. Please try again.' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!result?.success) {
    const errors: Record<string, [number, string]> = {
      NOT_FOUND: [404, 'Passport not found.'],
      ALREADY_CLAIMED: [409, 'This passport has already been claimed.'],
      STALE: [409, 'Your tailor updated this fitting. Refresh the passport and try again.'],
      EXPIRED: [410, 'This invite link has expired. Ask your tailor to resend it.'],
      NOT_CUSTOMER: [403, 'Only customers can claim passports.'],
    }
    const [status, message] = errors[result?.code] ?? [500, 'We could not claim this passport. Please try again.']
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  console.log(`[${FN}] passport ${passportId} claimed by user ${caller.id}`)

  return new Response(
    JSON.stringify({ success: true, alreadyOwned: result.alreadyOwned ?? false, measurementCount }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
  )
})
