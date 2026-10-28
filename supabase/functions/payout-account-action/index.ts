import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'
import { createOrRefreshOpsIssue, resolveOpsIssueByDedupeKey } from '../_shared/ops-issues.ts'
import { enqueueBackgroundJob } from '../_shared/jobs.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import {
  createStripeAccountLink,
  createStripeConnectAccount,
  retrieveStripeConnectAccount,
  stripeTransfersAndPayoutsReady,
} from '../_shared/stripe.ts'
import { getBachsClient } from '../_shared/bachs.ts'
import {
  createBachsOnboardingLink,
  createBachsRecipientAccount,
  getBachsAccount,
} from '../_shared/bachs-operations.ts'
import { startBachsAccountOnboarding } from '../_shared/bachs-account-onboarding.ts'
import { syncBachsPayoutDestination } from '../_shared/bachs-payout-destination.ts'
import {
  availableBachsPayoutSetupOptions,
  availableStripePayoutSetupOptions,
  bachsSandboxOnboardingEnabled,
  paymentRouteEnvironment,
  stripePayoutSetupRouteAvailable,
} from '../_shared/payment-routes.ts'
import { syncStripePayoutDestination } from '../_shared/stripe-payout-destination.ts'
import {
  requiresOpsPayoutDestinationReview,
  stagePayoutChangeRequest,
} from '../_shared/verification-review.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { normalizeAccountCurrency } from '../../../packages/shared/src/currency-config.ts'
import {
  isLegacyPayoutSetupCurrency,
  isRetiredManualBankEntryAction,
  isRetiredPaystackSetupAction,
  LEGACY_PAYOUT_SETUP_COMING_SOON_COPY,
  payoutBankLogoUrl,
  payoutProviderLabelFromSavedIdentity,
} from '../../../packages/shared/src/payout-setup.ts'
import { Sentry } from '../_shared/sentry.ts'

const FN = 'payout-account-action'
const PAYOUT_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const PAYOUT_CHANGE_CONFIRMATION_MS = 48 * 60 * 60 * 1000

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-status'),
  }),
  z.object({
    action: z.literal('list-paystack-banks'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES']),
    countryCode: z.string().trim().min(2).max(2).optional(),
  }),
  z.object({
    action: z.literal('verify-paystack-account'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES']),
    countryCode: z.string().trim().min(2).max(2),
    bankCode: z.string().trim().min(2).max(40),
    bankName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(40),
    accountName: z.string().trim().min(2).max(120).optional(),
  }),
  z.object({
    action: z.literal('confirm-paystack-account'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES']),
    countryCode: z.string().trim().min(2).max(2),
    bankCode: z.string().trim().min(2).max(40),
    bankName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(40),
    accountName: z.string().trim().min(2).max(120),
  }),
  z.object({
    action: z.literal('submit-manual-bank-entry'),
    payoutCurrency: z.enum(['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD']),
    bankName: z.string().trim().min(1).max(120),
    bankCountryCode: z.string().trim().min(2).max(2),
    swiftBic: z.string().trim().min(1).max(16),
    accountNumber: z.string().trim().min(1).max(64),
    accountName: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal('start-stripe-connect'),
    payoutCurrency: z.enum(['USD', 'GBP', 'EUR', 'CAD']),
    countryCode: z.string().trim().min(2).max(2),
    returnUrl: z.string().trim().min(1).max(500),
    refreshUrl: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal('refresh-stripe-connect-status'),
  }),
  z.object({
    action: z.literal('start-bachs-connect'),
    routeId: z.string().uuid(),
    returnUrl: z.string().trim().min(1).max(500),
    refreshUrl: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal('refresh-bachs-connect-status'),
    routeId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('confirm-payout-change'),
    requestId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('cancel-payout-change'),
    requestId: z.string().uuid(),
  }),
])

type PayoutAccountActionBody = z.infer<typeof BodySchema>

function isPaystackSetupAction(body: PayoutAccountActionBody): boolean {
  return isRetiredPaystackSetupAction(body.action)
}

type TailorProfileRow = {
  id: string
  display_name?: string | null
  profile_completed?: boolean | null
  id_verification_status?: string | null
  is_live?: boolean | null
  payout_currency?: string | null
  payout_provider?: 'PAYSTACK' | 'STRIPE' | null
  payout_reverification_required?: boolean | null
  payout_account_type?: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payout_account_verified?: boolean | null
  payout_account_verified_at?: string | null
  payout_bank_name?: string | null
  payout_bank_code?: string | null
  payout_account_name?: string | null
  payout_account_masked?: string | null
  payout_country_code?: string | null
  manual_bank_entry?: boolean | null
  manual_bank_name?: string | null
  manual_bank_country_code?: string | null
  manual_bank_country_name?: string | null
  manual_bank_swift_bic?: string | null
  manual_bank_account_name?: string | null
  manual_bank_verification_status?: string | null
  manual_bank_submitted_at?: string | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
  stripe_account_id?: string | null
  paystack_account_id?: string | null
  payout_account_change_count?: number | null
  payout_account_last_changed_at?: string | null
  payout_account_change_locked_until?: string | null
  payout_destination_hold_until?: string | null
  payout_name_match_status?: 'NOT_CHECKED' | 'MATCH' | 'REVIEW_REQUIRED' | 'MISMATCH' | null
  payout_name_match_checked_at?: string | null
  payout_name_match_metadata?: Record<string, unknown> | null
}

type PayoutChangeRequestRow = {
  id: string
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | null
  current_destination?: Record<string, unknown> | null
  requested_destination?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  submitted_at?: string | null
  reviewed_at?: string | null
  updated_at?: string | null
}

function publicPayoutDestination(destination: Record<string, unknown> | null | undefined) {
  if (!destination) return null
  return {
    payoutCurrency:
      typeof destination.payout_currency === 'string' ? destination.payout_currency : null,
    payoutProvider:
      typeof destination.payout_provider === 'string' ? destination.payout_provider : null,
    payoutAccountType:
      typeof destination.payout_account_type === 'string' ? destination.payout_account_type : null,
    payoutBankName:
      typeof destination.payout_bank_name === 'string' ? destination.payout_bank_name : null,
    payoutAccountName:
      typeof destination.payout_account_name === 'string' ? destination.payout_account_name : null,
    payoutAccountMasked:
      typeof destination.payout_account_masked === 'string'
        ? destination.payout_account_masked
        : null,
    payoutCountryCode:
      typeof destination.payout_country_code === 'string' ? destination.payout_country_code : null,
    payoutAccountVerified: destination.payout_account_verified === true,
    payoutReverificationRequired: destination.payout_reverification_required === true,
  }
}

function stringValue(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payoutChangeRisk(
  current: Record<string, unknown> | null | undefined,
  requested: Record<string, unknown> | null | undefined
) {
  const signals: string[] = []
  const verified =
    requested?.payout_account_verified === true &&
    requested?.payout_reverification_required !== true
  const sameProvider =
    stringValue(current, 'payout_provider') === stringValue(requested, 'payout_provider')
  const sameCurrency =
    stringValue(current, 'payout_currency') === stringValue(requested, 'payout_currency')
  const sameHolder =
    normalizeNameForCompare(stringValue(current, 'payout_account_name')) ===
    normalizeNameForCompare(stringValue(requested, 'payout_account_name'))
  if (!verified) signals.push('PROVIDER_VERIFICATION_INCOMPLETE')
  if (!sameProvider) signals.push('PROVIDER_CHANGED')
  if (!sameCurrency) signals.push('CURRENCY_CHANGED')
  if (!sameHolder) signals.push('ACCOUNT_HOLDER_CHANGED')
  if (requested?.manual_bank_entry === true) {
    signals.push('MANUAL_BANK_REVIEW_REQUIRED')
  }
  return { autoActivationEligible: signals.length === 0, signals }
}

async function enqueuePayoutChangeNotice(
  supabase: any,
  input: {
    userId: string
    requestId: string
    event: 'REQUESTED' | 'CONFIRMED' | 'CANCELLED' | 'NEEDS_REVIEW' | 'SETUP_COMPLETE'
    destination: Record<string, unknown> | null | undefined
  }
) {
  const bank =
    stringValue(input.destination, 'payout_bank_name') ??
    stringValue(input.destination, 'payout_provider') ??
    'payout account'
  const masked = stringValue(input.destination, 'payout_account_masked')
  const destination = masked ? `${bank} ending ${masked.replace(/\D/gu, '').slice(-4)}` : bank
  const copy = {
    REQUESTED: {
      title: 'Confirm your payout change',
      body: `Confirm the request for ${destination} within 48 hours. Your current payout account remains active.`,
      subject: 'Confirm your Drapeon payout change',
      cta: 'Review payout change',
    },
    CONFIRMED: {
      title: 'New payout account active',
      body: 'Your verified replacement is active now. Eligible earnings can release to it without an extra payout-account hold.',
      subject: 'Your new payout account is active',
      cta: 'View payout status',
    },
    CANCELLED: {
      title: 'Payout change cancelled',
      body: 'The replacement request was cancelled. Your current payout account was not changed.',
      subject: 'Your payout change was cancelled',
      cta: 'View payout account',
    },
    NEEDS_REVIEW: {
      title: 'Payout change needs review',
      body: 'Drapeon is reviewing this replacement because one or more account details changed. Your current payout account remains active.',
      subject: 'Your payout change needs review',
      cta: 'View payout status',
    },
    SETUP_COMPLETE: {
      title: 'Your payout account is ready',
      body: 'Drapeon will release eligible earnings to this verified account after the order checks and any customer protection window.',
      subject: 'Your Drapeon payout account is ready',
      cta: 'View payout account',
    },
  }[input.event]
  const eventKey = input.event.toLowerCase()
  const currency = stringValue(input.destination, 'payout_currency') ?? 'Not recorded'
  const provider = stringValue(input.destination, 'payout_provider') ?? 'Not recorded'
  const details =
    input.event === 'SETUP_COMPLETE'
      ? [
          { label: 'Active destination', value: destination },
          { label: 'Payout currency', value: currency },
          { label: 'Provider', value: provider },
          {
            label: 'When earnings release',
            value: 'After the order handoff checks and any protection window finish',
          },
          {
            label: 'Changing this account',
            value: 'You confirm the change; verified low-risk replacements activate immediately',
          },
          {
            label: 'If a payout is blocked',
            value: 'Drapeon shows the reason and next step in Earnings and notifies you',
          },
        ]
      : [{ label: 'Requested destination', value: destination }]
  await Promise.all([
    enqueueBackgroundJob(supabase, {
      eventType: `PAYOUT_CHANGE_${input.event}`,
      aggregateType: 'PAYOUT_CHANGE_REQUEST',
      aggregateId: input.requestId,
      actorId: input.userId,
      actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:${eventKey}:push`,
      jobType: 'SEND_PUSH',
      priority: 35,
      payload: {
        userId: input.userId,
        notification: {
          title: copy.title,
          body: copy.body,
          data: {
            url: '/profile/payout-setup',
            payoutChangeRequestId: input.requestId,
          },
          preferenceKey: 'paymentReleased',
        },
      },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: `PAYOUT_CHANGE_${input.event}`,
      aggregateType: 'PAYOUT_CHANGE_REQUEST',
      aggregateId: input.requestId,
      actorId: input.userId,
      actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:${eventKey}:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL',
      priority: 35,
      payload: {
        userId: input.userId,
        subject: copy.subject,
        headline: copy.title,
        body: copy.body,
        eyebrow: input.event === 'SETUP_COMPLETE' ? 'Payout setup' : 'Payout account update',
        ctaLabel: copy.cta,
        webPath: '/account/payout',
        appUrl: 'drape://profile/payout-setup',
        details,
      },
    }),
  ])
}

function initialPayoutChangeMetadata(input: Record<string, unknown>) {
  const now = new Date().toISOString()
  return {
    ...input,
    lifecycle_state: 'AWAITING_CONFIRMATION',
    confirmation_status: 'PENDING',
    confirmation_expires_at: addMsIso(now, PAYOUT_CHANGE_CONFIRMATION_MS),
  }
}

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  const payload =
    typeof body.error === 'string' && typeof body.message !== 'string'
      ? { ...body, message: body.error }
      : body
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function providerErrorResponse(error: unknown, headers: HeadersInit) {
  const message = error instanceof Error ? error.message : String(error)
  const isProviderish =
    message.includes('Paystack') ||
    message.includes('Stripe') ||
    message.includes('Bachs') ||
    message.includes('Missing Paystack') ||
    message.includes('Missing Stripe') ||
    message.includes('Missing Bachs')

  if (isProviderish) {
    return jsonResponse({ code: 'PAYOUT_PROVIDER_ERROR', error: message }, 503, headers)
  }

  return jsonResponse(
    {
      code: 'INTERNAL_ERROR',
      error: 'We could not complete payout setup right now.',
    },
    500,
    headers
  )
}

function isAllowedBachsCallbackUrl(value: string, allowLocalHttp: boolean): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return (
      (url.protocol === 'https:' && (host === 'drapeon.co' || host.endsWith('.drapeon.co'))) ||
      (allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host))
    )
  } catch {
    return false
  }
}

function normalizeCountryCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null
}

function normalizeNameForCompare(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

function manualBankResetPatch() {
  return {
    manual_bank_entry: false,
    manual_bank_name: null,
    manual_bank_country_code: null,
    manual_bank_country_name: null,
    manual_bank_swift_bic: null,
    manual_bank_account_number: null,
    manual_bank_account_name: null,
    manual_bank_verification_status: 'NOT_SUBMITTED',
    manual_bank_submitted_at: null,
    manual_bank_verified_at: null,
    manual_bank_verified_by: null,
  }
}

function payoutProviderFromSavedProfile(profile: TailorProfileRow) {
  const label = payoutProviderLabelFromSavedIdentity({
    payoutProvider: profile.payout_provider,
    payoutAccountType: profile.payout_account_type,
    stripeAccountId: profile.stripe_account_id,
    stripeConnectAccountId: profile.stripe_connect_account_id,
    paystackAccountId: profile.paystack_account_id,
    paystackRecipientCode: profile.paystack_recipient_code,
  })
  if (label === 'Stripe') return 'STRIPE' as const
  if (label === 'Paystack') return 'PAYSTACK' as const
  return null
}

function addMsIso(iso: string, ms: number) {
  return new Date(Date.parse(iso) + ms).toISOString()
}

function isFutureIso(value: string | null | undefined, nowIso: string) {
  if (!value) return false
  const valueMs = Date.parse(value)
  const nowMs = Date.parse(nowIso)
  return Number.isFinite(valueMs) && Number.isFinite(nowMs) && valueMs > nowMs
}

function normalizedKeyPart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, ' ').toUpperCase() ?? ''
}

function currentPayoutDestinationKey(profile: TailorProfileRow) {
  if (profile.payout_account_type === 'PAYSTACK') {
    return [
      'PAYSTACK',
      profile.payout_currency ?? '',
      profile.payout_bank_code ?? '',
      profile.payout_account_masked ?? '',
      normalizedKeyPart(profile.payout_account_name),
    ].join(':')
  }

  if (profile.payout_account_type === 'STRIPE_CONNECT') {
    return [
      'STRIPE_CONNECT',
      profile.payout_currency ?? '',
      profile.stripe_connect_account_id ?? profile.stripe_account_id ?? '',
    ].join(':')
  }

  if (profile.manual_bank_entry === true) {
    return [
      'MANUAL',
      profile.payout_currency ?? '',
      profile.manual_bank_country_code ?? profile.payout_country_code ?? '',
      normalizedKeyPart(profile.manual_bank_name ?? profile.payout_bank_name),
      profile.payout_account_masked ?? '',
      normalizedKeyPart(profile.manual_bank_account_name ?? profile.payout_account_name),
    ].join(':')
  }

  return null
}

function hasVerifiedPayoutDestination(profile: TailorProfileRow) {
  return (
    profile.payout_account_verified === true &&
    profile.payout_reverification_required !== true &&
    currentPayoutDestinationKey(profile) !== null
  )
}

function isPayoutDestinationChange(profile: TailorProfileRow, nextDestinationKey: string | null) {
  return requiresOpsPayoutDestinationReview(
    profile,
    currentPayoutDestinationKey(profile),
    nextDestinationKey
  )
}

function currentDestinationPayload(profile: TailorProfileRow) {
  return {
    payout_currency: profile.payout_currency ?? null,
    payout_provider: profile.payout_provider ?? null,
    payout_account_type: profile.payout_account_type ?? null,
    payout_account_verified: profile.payout_account_verified ?? false,
    payout_reverification_required: profile.payout_reverification_required ?? null,
    payout_bank_name: profile.payout_bank_name ?? null,
    payout_bank_code: profile.payout_bank_code ?? null,
    payout_account_name: profile.payout_account_name ?? null,
    payout_account_masked: profile.payout_account_masked ?? null,
    payout_country_code: profile.payout_country_code ?? null,
    paystack_recipient_code: profile.paystack_recipient_code ?? null,
    paystack_account_id: profile.paystack_account_id ?? null,
    stripe_connect_account_id: profile.stripe_connect_account_id ?? null,
    stripe_account_id: profile.stripe_account_id ?? null,
    manual_bank_entry: profile.manual_bank_entry ?? false,
    manual_bank_name: profile.manual_bank_name ?? null,
    manual_bank_country_code: profile.manual_bank_country_code ?? null,
    manual_bank_country_name: profile.manual_bank_country_name ?? null,
    manual_bank_swift_bic: profile.manual_bank_swift_bic ?? null,
    manual_bank_account_name: profile.manual_bank_account_name ?? null,
    manual_bank_verification_status: profile.manual_bank_verification_status ?? null,
    payout_name_match_status: profile.payout_name_match_status ?? 'NOT_CHECKED',
    payout_name_match_checked_at: profile.payout_name_match_checked_at ?? null,
    payout_name_match_metadata: profile.payout_name_match_metadata ?? {},
  }
}

async function createPayoutChangeReviewIssue(
  supabase: any,
  input: {
    callerId: string
    profile: TailorProfileRow
    requestId: string | null
    provider: 'PAYSTACK' | 'STRIPE'
    payoutCurrency: string
    title: string
    description: string
    metadata?: Record<string, unknown>
  }
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: 'PAYOUT_BLOCKED',
    severity: 'HIGH',
    source: FN,
    actorId: input.callerId,
    actorRole: 'TAILOR',
    userId: input.callerId,
    tailorProfileId: input.profile.id,
    relatedEntityType: 'payout_change_request',
    relatedEntityId: input.requestId,
    provider: input.provider,
    title: input.title,
    description: input.description,
    recommendedAction:
      'Compare the current payout destination against the requested destination, confirm account holder risk, then approve or reject the staged change.',
    dedupeKey: `payout-change:${input.profile.id}`,
    metadata: {
      request_id: input.requestId,
      payout_currency: input.payoutCurrency,
      ...(input.metadata ?? {}),
    },
  })
}

function payoutChangeGuardResponse(
  profile: TailorProfileRow,
  nextDestinationKey: string,
  nowIso: string,
  headers: HeadersInit
) {
  const isDestinationChange = isPayoutDestinationChange(profile, nextDestinationKey)

  if (!isDestinationChange || !isFutureIso(profile.payout_account_change_locked_until, nowIso)) {
    return null
  }

  const lockedUntil = profile.payout_account_change_locked_until as string
  const retryAfter = Math.max(60, Math.ceil((Date.parse(lockedUntil) - Date.parse(nowIso)) / 1000))
  return jsonResponse(
    {
      code: 'PAYOUT_CHANGE_COOLDOWN',
      error:
        'For account safety, payout destination changes are limited for a short period after a verified account is changed.',
      lockedUntil,
      retryAfter,
    },
    409,
    {
      ...headers,
      'Retry-After': String(retryAfter),
    }
  )
}

function payoutChangePatch(profile: TailorProfileRow, nextDestinationKey: string, nowIso: string) {
  const isDestinationChange = isPayoutDestinationChange(profile, nextDestinationKey)

  if (!isDestinationChange) {
    return {
      payout_account_last_changed_at: profile.payout_account_last_changed_at ?? nowIso,
    }
  }

  return {
    payout_account_change_count: (profile.payout_account_change_count ?? 0) + 1,
    payout_account_last_changed_at: nowIso,
    payout_account_change_locked_until: addMsIso(nowIso, PAYOUT_CHANGE_COOLDOWN_MS),
    payout_destination_hold_until: null,
  }
}

async function activateVerifiedPayoutChange(
  supabase: any,
  input: {
    requestId: string
    profileId: string
    destination: Record<string, unknown>
    metadata: Record<string, unknown>
    now: string
  }
) {
  const allowedFields = [
    'payout_currency',
    'payout_provider',
    'payout_account_type',
    'payout_account_verified',
    'payout_reverification_required',
    'payout_bank_name',
    'payout_bank_code',
    'payout_account_name',
    'payout_account_masked',
    'payout_country_code',
    'paystack_recipient_code',
    'paystack_account_id',
    'stripe_connect_account_id',
    'stripe_account_id',
    'manual_bank_entry',
    'manual_bank_name',
    'manual_bank_country_code',
    'manual_bank_country_name',
    'manual_bank_swift_bic',
    'manual_bank_account_number',
    'manual_bank_account_name',
    'manual_bank_verification_status',
    'payout_name_match_status',
    'payout_name_match_checked_at',
    'payout_name_match_metadata',
  ]
  const patch = Object.fromEntries(
    allowedFields
      .filter((key) => key in input.destination)
      .map((key) => [key, input.destination[key]])
  )
  Object.assign(patch, {
    payout_account_verified_at: input.now,
    payout_account_last_changed_at: input.now,
    payout_account_change_locked_until: addMsIso(input.now, PAYOUT_CHANGE_COOLDOWN_MS),
    payout_destination_hold_until: null,
  })

  const profileUpdate = await supabase
    .from('tailor_profiles')
    .update(patch)
    .eq('id', input.profileId)
  if (profileUpdate.error) throw profileUpdate.error

  const requestUpdate = await supabase
    .from('payout_change_requests')
    .update({
      status: 'APPROVED',
      reviewed_at: input.now,
      reviewed_by: null,
      updated_at: input.now,
      metadata: {
        ...input.metadata,
        lifecycle_state: 'ACTIVATED',
        activated_at: input.now,
        activation_source: 'LOW_RISK_PROVIDER_VERIFIED_CONFIRMATION',
        hold_until: null,
      },
    })
    .eq('id', input.requestId)
    .eq('status', 'PENDING')
  if (requestUpdate.error) throw requestUpdate.error
}

async function loadTailorProfile(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('tailor_profiles')
    .select(
      `
      id,
      display_name,
      profile_completed,
      id_verification_status,
      is_live,
      payout_currency,
      payout_provider,
      payout_reverification_required,
      payout_account_type,
      payout_account_verified,
      payout_account_verified_at,
      payout_bank_name,
      payout_bank_code,
      payout_account_name,
      payout_account_masked,
      payout_country_code,
      manual_bank_entry,
      manual_bank_name,
      manual_bank_country_code,
      manual_bank_country_name,
      manual_bank_swift_bic,
      manual_bank_account_name,
      manual_bank_verification_status,
      manual_bank_submitted_at,
      paystack_recipient_code,
      stripe_connect_account_id,
      stripe_account_id,
      paystack_account_id,
      payout_account_change_count,
      payout_account_last_changed_at,
      payout_account_change_locked_until,
      payout_destination_hold_until,
      payout_name_match_status,
      payout_name_match_checked_at,
      payout_name_match_metadata
    `
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data as TailorProfileRow | null) ?? null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const caller = await getAuthUser(req)
    if (!caller) {
      log('warn', FN, 'auth.unauthenticated')
      return jsonResponse(
        {
          error: 'Please sign in again before managing your payout account.',
          message: 'Please sign in again before managing your payout account.',
        },
        401,
        cors
      )
    }

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) {
      log('warn', FN, 'validation.failed', {
        actor_id: caller.id,
        error: parsed.error,
      })
      return jsonResponse({ error: parsed.error }, 400, cors)
    }

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 40)
    if (!allowed) {
      await audit(supabase, {
        event: 'rate_limit.exceeded',
        actor_id: caller.id,
        severity: 'warn',
        payload: { function: FN },
      })
      return rateLimitExceededResponse(cors)
    }

    const profile = await loadTailorProfile(supabase, caller.id)
    if (!profile?.id) {
      return jsonResponse(
        { error: 'Complete your tailor profile before setting up payouts.' },
        404,
        cors
      )
    }

    const body = parsed.data

    if (body.action === 'start-bachs-connect' || body.action === 'refresh-bachs-connect-status') {
      if (
        !bachsSandboxOnboardingEnabled({
          supabaseUrl: getSupabaseUrl(),
          flag: Deno.env.get('BACHS_SANDBOX_ONBOARDING_ENABLED'),
        })
      ) {
        return jsonResponse(
          {
            code: 'BACHS_ONBOARDING_UNAVAILABLE',
            error: 'Bachs payout setup is not available in this environment yet.',
          },
          409,
          cors
        )
      }

      if (
        body.action === 'start-bachs-connect' &&
        (!isAllowedBachsCallbackUrl(body.returnUrl, true) ||
          !isAllowedBachsCallbackUrl(body.refreshUrl, true))
      ) {
        return jsonResponse(
          {
            code: 'BACHS_ONBOARDING_CALLBACK_INVALID',
            error: 'Payout setup could not open a trusted return page.',
          },
          400,
          cors
        )
      }

      const routeId = body.routeId
      const { data: route, error: routeError } = await supabase
        .from('payment_routes')
        .select(
          'id,version,status,provider,legal_entity,tailor_country_code,payout_currency,fees_collector'
        )
        .eq('id', routeId)
        .maybeSingle()
      if (routeError) throw routeError
      if (
        !route ||
        route.provider !== 'BACHS' ||
        route.legal_entity !== 'DRAPE_MARKETPLACE_LIMITED' ||
        route.status !== 'SANDBOX_ONLY' ||
        !Number.isInteger(route.version)
      ) {
        return jsonResponse(
          {
            code: 'BACHS_ONBOARDING_ROUTE_UNAVAILABLE',
            error: 'Bachs payout setup is not available for this route yet.',
          },
          409,
          cors
        )
      }

      const bachsClient = getBachsClient()
      if (body.action === 'start-bachs-connect') {
        try {
          const setup = await startBachsAccountOnboarding({
            supabase,
            tailorProfileId: profile.id,
            route,
            email: caller.email ?? `${caller.id}@drapeon.co`,
            displayName: profile.display_name?.trim() || 'Drapeon tailor',
            returnUrl: body.returnUrl,
            refreshUrl: body.refreshUrl,
            checkedAt: new Date().toISOString(),
            createAccount: (request) => createBachsRecipientAccount(bachsClient, request),
            retrieveAccount: (accountId) => getBachsAccount(bachsClient, accountId),
            createOnboardingLink: (request) => createBachsOnboardingLink(bachsClient, request),
          })
          if (setup.state === 'UNCERTAIN') {
            await createOrRefreshOpsIssue(supabase, {
              issueType: 'PAYOUT_BLOCKED',
              severity: 'HIGH',
              source: FN,
              actorId: caller.id,
              actorRole: 'TAILOR',
              userId: caller.id,
              tailorProfileId: profile.id,
              relatedEntityType: 'bachs_account_setup_claim',
              relatedEntityId: setup.claimId,
              provider: 'BACHS',
              title: 'Bachs payout setup needs reconciliation',
              description:
                'The Bachs recipient-account creation result could not be confirmed. The account setup is reserved to prevent creating a duplicate.',
              recommendedAction:
                'Reconcile the saved Bachs account-setup claim and provider account before allowing another onboarding attempt.',
              dedupeKey: `bachs-account-setup:${setup.claimId}`,
              queueKey: 'money-desk',
              persistWhenRoutineDisabled: true,
              notifyOps: false,
              notifyOpsPush: false,
              metadata: {
                claim_id: setup.claimId,
                route_id: route.id,
                route_version: route.version,
              },
            })
            return jsonResponse(
              {
                ok: false,
                pendingReview: true,
                code: 'BACHS_ACCOUNT_SETUP_UNCERTAIN',
                message:
                  'Payout setup is being checked. Please don’t start another request; we’ll update its status here.',
              },
              202,
              cors
            )
          }
          await audit(supabase, {
            event: 'seller.bachs_payout_onboarding_started',
            actor_id: caller.id,
            actor_role: 'TAILOR',
            severity: 'info',
            payload: {
              function: FN,
              route_id: route.id,
              route_version: route.version,
              destination_id: setup.destinationId,
              capability_ready: setup.destinationActive,
            },
          })
          return jsonResponse(
            {
              ok: true,
              onboarding: {
                provider: 'BACHS',
                routeId: route.id,
                routeVersion: route.version,
                countryCode: route.tailor_country_code,
                payoutCurrency: route.payout_currency,
                destinationId: setup.destinationId,
                accountId: setup.accountId,
                firstWithdrawalReviewStatus: setup.firstWithdrawalReviewStatus,
                capabilitiesReady: setup.destinationActive,
                url: setup.onboardingUrl,
                expiresAt: setup.expiresAt,
              },
            },
            200,
            cors
          )
        } catch (error) {
          log('error', FN, 'Bachs payout onboarding failed', {
            function: FN,
            actor_id: caller.id,
            route_id: route.id,
            error: error instanceof Error ? error.message : 'unknown',
          })
          return providerErrorResponse(error, cors)
        }
      }

      const { data: claim, error: claimError } = await supabase
        .from('bachs_account_setup_claims')
        .select('id,provider_account_ref,state')
        .eq('tailor_profile_id', profile.id)
        .eq('route_id', route.id)
        .eq('route_version', route.version)
        .maybeSingle()
      if (claimError) throw claimError
      if (!claim?.provider_account_ref || claim.state !== 'BOUND') {
        return jsonResponse(
          {
            ok: true,
            pendingReview: claim?.state === 'RESERVED',
            account: null,
            message:
              claim?.state === 'RESERVED'
                ? 'Payout setup is being checked. Please don’t start another request.'
                : 'Bachs payout setup has not been started yet.',
          },
          200,
          cors
        )
      }
      const account = await getBachsAccount(bachsClient, claim.provider_account_ref)
      const destination = await syncBachsPayoutDestination(supabase, {
        tailorProfileId: profile.id,
        routeId: route.id,
        routeVersion: route.version,
        account,
        checkedAt: new Date().toISOString(),
      })
      return jsonResponse(
        {
          ok: true,
          account: {
            provider: 'BACHS',
            accountId: account.id,
            transfersEnabled: account.capabilities?.transfers?.status === 'active',
            payoutsEnabled: account.capabilities?.payouts?.status === 'active',
            firstWithdrawalReviewStatus: destination.persisted
              ? destination.firstWithdrawalReviewStatus
              : 'PENDING',
            destinationActive: destination.persisted && destination.active,
            requirements: account.requirements ?? {},
          },
        },
        200,
        cors
      )
    }

    // Keep old client binaries safe, but do not create any new Paystack recipient.
    // Historical payout readers and status remain available for already accepted work.
    if (isPaystackSetupAction(body)) {
      return jsonResponse(
        {
          code: 'PAYOUT_SETUP_COMING_SOON',
          error: LEGACY_PAYOUT_SETUP_COMING_SOON_COPY,
        },
        409,
        cors
      )
    }

    if (
      body.action === 'submit-manual-bank-entry' &&
      isLegacyPayoutSetupCurrency(body.payoutCurrency)
    ) {
      return jsonResponse(
        {
          code: 'PAYOUT_SETUP_COMING_SOON',
          error: LEGACY_PAYOUT_SETUP_COMING_SOON_COPY,
        },
        409,
        cors
      )
    }

    if (body.action === 'get-status') {
      const payoutCurrency = normalizeAccountCurrency(profile.payout_currency) ?? 'USD'
      const [pendingChangeResult, setupRoutesResult] = await Promise.all([
        supabase
          .from('payout_change_requests')
          .select(
            'id,status,current_destination,requested_destination,metadata,submitted_at,reviewed_at,updated_at'
          )
          .eq('tailor_user_id', caller.id)
          .eq('status', 'PENDING')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('payment_routes')
          .select(
            'id,route_key,version,status,provider,legal_entity,tailor_country_code,payout_currency,charge_currency'
          ),
      ])
      const pendingChange = pendingChangeResult.data
      const pendingChangeError = pendingChangeResult.error
      if (pendingChangeError) throw pendingChangeError
      const setupOptionsUnavailable = Boolean(setupRoutesResult.error)
      if (setupRoutesResult.error) {
        log('warn', FN, 'Payout setup route options unavailable; failing closed', {
          function: FN,
          code: setupRoutesResult.error.code ?? null,
        })
      }
      const setupRoutes = (setupRoutesResult.data ?? []) as Parameters<
        typeof availableStripePayoutSetupOptions
      >[0]['routes']
      const environment = paymentRouteEnvironment(getSupabaseUrl())
      const setupOptions = setupOptionsUnavailable
        ? []
        : [
            ...availableStripePayoutSetupOptions({
              routes: setupRoutes,
              environment,
            }),
            ...availableBachsPayoutSetupOptions({
              routes: setupRoutes,
              environment,
            }),
          ]
      const pendingRequest = (pendingChange as PayoutChangeRequestRow | null) ?? null
      const { data: bachsDestination, error: bachsDestinationError } = await supabase
        .from('payout_destinations')
        .select(
          'id,country_code,currency,transfers_enabled,payouts_enabled,first_withdrawal_review_status,active,capability_checked_at'
        )
        .eq('tailor_profile_id', profile.id)
        .eq('provider', 'BACHS')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (bachsDestinationError) throw bachsDestinationError
      return jsonResponse(
        {
          ok: true,
          payoutSetupOptions: setupOptions,
          payoutSetupOptionsStatus: setupOptionsUnavailable
            ? 'UNAVAILABLE'
            : setupOptions.length > 0
              ? 'AVAILABLE'
              : 'NONE',
          profile: {
            id: profile.id,
            displayName: profile.display_name ?? 'Your tailor profile',
            payoutCurrency,
            payoutProvider: payoutProviderFromSavedProfile(profile),
            payoutAccountType: profile.payout_account_type ?? null,
            payoutAccountVerified: profile.payout_account_verified === true,
            payoutReverificationRequired: profile.payout_reverification_required === true,
            payoutAccountVerifiedAt: profile.payout_account_verified_at ?? null,
            payoutBankName: profile.payout_bank_name ?? null,
            payoutAccountName: profile.payout_account_name ?? null,
            payoutAccountMasked: profile.payout_account_masked ?? null,
            payoutCountryCode: profile.payout_country_code ?? null,
            manualBankEntry: profile.manual_bank_entry === true,
            manualBankName: profile.manual_bank_name ?? null,
            manualBankCountryCode: profile.manual_bank_country_code ?? null,
            manualBankCountryName: profile.manual_bank_country_name ?? null,
            manualBankSwiftBic: profile.manual_bank_swift_bic ?? null,
            manualBankAccountName: profile.manual_bank_account_name ?? null,
            manualBankVerificationStatus:
              profile.manual_bank_verification_status ?? 'NOT_SUBMITTED',
            manualBankSubmittedAt: profile.manual_bank_submitted_at ?? null,
            // Manual details remain readable for historical records only. They are
            // not a provider-backed destination and cannot be newly submitted.
            manualBankEntryEnabled: false,
            paystackRecipientCode: profile.paystack_recipient_code ?? null,
            stripeConnectAccountId: profile.stripe_connect_account_id ?? null,
            bachsPayoutDestination: bachsDestination
              ? {
                  id: bachsDestination.id,
                  countryCode: bachsDestination.country_code,
                  payoutCurrency: bachsDestination.currency,
                  transfersEnabled: bachsDestination.transfers_enabled,
                  payoutsEnabled: bachsDestination.payouts_enabled,
                  firstWithdrawalReviewStatus: bachsDestination.first_withdrawal_review_status,
                  active: bachsDestination.active,
                  capabilityCheckedAt: bachsDestination.capability_checked_at,
                }
              : null,
            payoutAccountChangeCount: profile.payout_account_change_count ?? 0,
            payoutAccountLastChangedAt: profile.payout_account_last_changed_at ?? null,
            payoutAccountChangeLockedUntil: profile.payout_account_change_locked_until ?? null,
            payoutDestinationHoldUntil: profile.payout_destination_hold_until ?? null,
          },
          pendingPayoutChange: pendingRequest
            ? {
                id: pendingRequest.id,
                status: pendingRequest.status ?? 'PENDING',
                submittedAt: pendingRequest.submitted_at ?? pendingRequest.updated_at ?? null,
                confirmationStatus:
                  stringValue(pendingRequest.metadata, 'confirmation_status') ?? 'PENDING',
                lifecycleState:
                  stringValue(pendingRequest.metadata, 'lifecycle_state') ??
                  'AWAITING_CONFIRMATION',
                confirmationExpiresAt: stringValue(
                  pendingRequest.metadata,
                  'confirmation_expires_at'
                ),
                confirmedAt: stringValue(pendingRequest.metadata, 'confirmed_at'),
                holdUntil: stringValue(pendingRequest.metadata, 'hold_until'),
                autoActivationEligible: pendingRequest.metadata?.auto_activation_eligible === true,
                riskSignals: Array.isArray(pendingRequest.metadata?.risk_signals)
                  ? pendingRequest.metadata?.risk_signals
                  : [],
                currentDestination: publicPayoutDestination(pendingRequest.current_destination),
                requestedDestination: publicPayoutDestination(pendingRequest.requested_destination),
              }
            : null,
        },
        200,
        cors
      )
    }

    if (body.action === 'cancel-payout-change') {
      const { data: request, error } = await supabase
        .from('payout_change_requests')
        .select('id,status,requested_destination,metadata')
        .eq('id', body.requestId)
        .eq('tailor_user_id', caller.id)
        .maybeSingle()
      if (error) throw error
      if (!request || request.status !== 'PENDING') {
        return jsonResponse(
          {
            code: 'PAYOUT_CHANGE_NOT_PENDING',
            error: 'This payout change is no longer pending.',
          },
          409,
          cors
        )
      }
      const now = new Date().toISOString()
      const { error: cancelError } = await supabase
        .from('payout_change_requests')
        .update({
          status: 'CANCELLED',
          reviewed_at: now,
          updated_at: now,
          metadata: {
            ...(request.metadata ?? {}),
            lifecycle_state: 'CANCELLED',
            cancelled_at: now,
            cancelled_by: caller.id,
          },
        })
        .eq('id', request.id)
        .eq('status', 'PENDING')
      if (cancelError) throw cancelError
      await resolveOpsIssueByDedupeKey(supabase, `payout-change:${profile.id}`, {
        outcome: 'TAILOR_CANCELLED',
      })
      await enqueuePayoutChangeNotice(supabase, {
        userId: caller.id,
        requestId: request.id,
        event: 'CANCELLED',
        destination: request.requested_destination,
      })
      await audit(supabase, {
        event: 'seller.payout_change_cancelled',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: 'info',
        payload: { function: FN, request_id: request.id },
      })
      return jsonResponse({ ok: true, outcome: 'CANCELLED' }, 200, cors)
    }

    if (body.action === 'confirm-payout-change') {
      const { data: request, error } = await supabase
        .from('payout_change_requests')
        .select('id,status,current_destination,requested_destination,metadata,submitted_at')
        .eq('id', body.requestId)
        .eq('tailor_user_id', caller.id)
        .maybeSingle()
      if (error) throw error
      if (!request || request.status !== 'PENDING') {
        return jsonResponse(
          {
            code: 'PAYOUT_CHANGE_NOT_PENDING',
            error: 'This payout change is no longer pending.',
          },
          409,
          cors
        )
      }
      const now = new Date().toISOString()
      const expiresAt = stringValue(request.metadata, 'confirmation_expires_at')
      if (expiresAt && Date.parse(expiresAt) <= Date.parse(now)) {
        return jsonResponse(
          {
            code: 'PAYOUT_CHANGE_CONFIRMATION_EXPIRED',
            error: 'This confirmation window expired. Start a new payout change.',
          },
          409,
          cors
        )
      }
      const risk = payoutChangeRisk(request.current_destination, request.requested_destination)
      const lifecycleState = risk.autoActivationEligible ? 'ACTIVATED' : 'OPS_REVIEW'
      const metadata = {
        ...(request.metadata ?? {}),
        confirmation_status: 'CONFIRMED',
        confirmed_at: now,
        hold_until: null,
        lifecycle_state: lifecycleState,
        auto_activation_eligible: risk.autoActivationEligible,
        risk_signals: risk.signals,
      }
      if (risk.autoActivationEligible) {
        await activateVerifiedPayoutChange(supabase, {
          requestId: request.id,
          profileId: profile.id,
          destination: request.requested_destination ?? {},
          metadata,
          now,
        })
        await resolveOpsIssueByDedupeKey(supabase, `payout-change:${profile.id}`, {
          outcome: 'LOW_RISK_AUTO_ACTIVATED',
        })
        await enqueuePayoutChangeNotice(supabase, {
          userId: caller.id,
          requestId: request.id,
          event: 'CONFIRMED',
          destination: request.requested_destination,
        })
      } else {
        const { error: updateError } = await supabase
          .from('payout_change_requests')
          .update({ metadata, updated_at: now })
          .eq('id', request.id)
          .eq('status', 'PENDING')
        if (updateError) throw updateError
        const provider =
          stringValue(request.requested_destination, 'payout_provider') === 'STRIPE'
            ? 'STRIPE'
            : 'PAYSTACK'
        await createPayoutChangeReviewIssue(supabase, {
          callerId: caller.id,
          profile,
          requestId: request.id,
          provider,
          payoutCurrency:
            stringValue(request.requested_destination, 'payout_currency') ??
            profile.payout_currency ??
            'USD',
          title: 'Confirmed payout change needs review',
          description: `${
            profile.display_name ?? 'A tailor'
          } confirmed a payout replacement with security differences that require review. The current destination remains active.`,
          metadata: {
            lifecycle_state: lifecycleState,
            confirmation_status: 'CONFIRMED',
            risk_signals: risk.signals,
            hold_until: null,
          },
        })
        await enqueuePayoutChangeNotice(supabase, {
          userId: caller.id,
          requestId: request.id,
          event: 'NEEDS_REVIEW',
          destination: request.requested_destination,
        })
      }
      await audit(supabase, {
        event: 'seller.payout_change_confirmed',
        actor_id: caller.id,
        actor_role: 'TAILOR',
        severity: risk.autoActivationEligible ? 'info' : 'warn',
        payload: {
          function: FN,
          request_id: request.id,
          lifecycle_state: lifecycleState,
          risk_signals: risk.signals,
          activated_immediately: risk.autoActivationEligible,
        },
      })
      return jsonResponse(
        {
          ok: true,
          lifecycleState,
          holdUntil: null,
          autoActivationEligible: risk.autoActivationEligible,
        },
        200,
        cors
      )
    }

    if (isRetiredManualBankEntryAction(body.action)) {
      return jsonResponse(
        {
          code: 'MANUAL_BANK_ENTRY_DISABLED',
          error:
            'Manual bank details cannot be used as a payout destination right now. Choose an available connected payout option or contact payouts for help.',
        },
        409,
        cors
      )
    }

    if (body.action === 'start-stripe-connect') {
      const countryCode = normalizeCountryCode(body.countryCode)
      if (!countryCode) {
        return jsonResponse({ error: 'Enter the payout country first.' }, 400, cors)
      }

      const { data: setupRoutes, error: setupRoutesError } = await supabase
        .from('payment_routes')
        .select(
          'id,version,status,provider,legal_entity,tailor_country_code,payout_currency,charge_currency'
        )
        .eq('provider', 'STRIPE')
        .eq('legal_entity', 'O4_GROUP_LLC')
        .eq('tailor_country_code', countryCode)
        .eq('payout_currency', body.payoutCurrency)
      if (setupRoutesError) {
        log('warn', FN, 'Stripe payout onboarding route preflight failed closed', {
          function: FN,
          code: setupRoutesError.code ?? null,
        })
        return jsonResponse(
          {
            code: 'PAYOUT_SETUP_ROUTE_UNAVAILABLE',
            error: 'Payout setup is temporarily unavailable for this country and currency.',
          },
          503,
          cors
        )
      }
      if (
        !stripePayoutSetupRouteAvailable({
          routes: (setupRoutes ?? []) as Parameters<
            typeof stripePayoutSetupRouteAvailable
          >[0]['routes'],
          environment: paymentRouteEnvironment(getSupabaseUrl()),
          tailorCountryCode: countryCode,
          payoutCurrency: body.payoutCurrency,
        })
      ) {
        return jsonResponse(
          {
            code: 'PAYOUT_SETUP_ROUTE_UNAVAILABLE',
            error: 'Payout setup is not available for this country and currency yet.',
          },
          409,
          cors
        )
      }

      const now = new Date().toISOString()
      let accountId = profile.stripe_connect_account_id?.trim() || null
      if (!accountId) {
        const account = await createStripeConnectAccount({
          email: caller.email ?? `${caller.id}@drapeon.co`,
          countryCode,
          metadata: {
            drape_user_id: caller.id,
            tailor_profile_id: profile.id,
          },
        })
        accountId = account.id
      }

      const nextDestinationKey = ['STRIPE_CONNECT', body.payoutCurrency, accountId].join(':')
      const guardResponse = payoutChangeGuardResponse(profile, nextDestinationKey, now, cors)
      if (guardResponse) return guardResponse

      const accountLink = await createStripeAccountLink({
        accountId,
        returnUrl: body.returnUrl,
        refreshUrl: body.refreshUrl,
      })

      const stripeDestination = {
        payout_currency: body.payoutCurrency,
        payout_provider: 'STRIPE',
        payout_account_type: 'STRIPE_CONNECT',
        payout_account_verified: false,
        payout_reverification_required: true,
        payout_country_code: countryCode,
        stripe_connect_account_id: accountId,
        stripe_account_id: accountId,
        paystack_recipient_code: null,
        paystack_account_id: null,
        payout_bank_name: null,
        payout_bank_code: null,
        payout_account_name: null,
        payout_account_masked: null,
        ...manualBankResetPatch(),
      }

      if (isPayoutDestinationChange(profile, nextDestinationKey)) {
        const request = await stagePayoutChangeRequest(supabase, {
          tailorUserId: caller.id,
          tailorProfileId: profile.id,
          currentDestination: currentDestinationPayload(profile),
          requestedDestination: stripeDestination,
          metadata: initialPayoutChangeMetadata({
            action: body.action,
            provider: 'STRIPE',
            next_destination_key: nextDestinationKey,
          }),
        })
        await resolveOpsIssueByDedupeKey(supabase, `payout-change:${profile.id}`, {
          outcome: 'AWAITING_TAILOR_CONFIRMATION',
        })
        if (request?.id) {
          await enqueuePayoutChangeNotice(supabase, {
            userId: caller.id,
            requestId: request.id,
            event: 'REQUESTED',
            destination: stripeDestination,
          })
        }

        await audit(supabase, {
          event: 'seller.payout_change_requested',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'warn',
          payload: {
            function: FN,
            provider: 'STRIPE',
            request_id: request?.id ?? null,
            payout_currency: body.payoutCurrency,
            stripe_connect_account_id: accountId,
          },
        })

        return jsonResponse(
          {
            ok: true,
            confirmationRequired: true,
            requestId: request?.id ?? null,
            onboarding: {
              provider: 'STRIPE',
              payoutCurrency: body.payoutCurrency,
              countryCode,
              stripeConnectAccountId: accountId,
              url: accountLink.url,
              expiresAt: accountLink.expires_at,
            },
          },
          200,
          cors
        )
      }

      const { error: updateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_currency: body.payoutCurrency,
          payout_provider: 'STRIPE',
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: false,
          payout_reverification_required: true,
          payout_country_code: countryCode,
          stripe_connect_account_id: accountId,
          stripe_account_id: accountId,
          paystack_recipient_code: null,
          paystack_account_id: null,
          payout_bank_name: null,
          payout_bank_code: null,
          payout_account_name: null,
          payout_account_masked: null,
          payout_account_verified_at: null,
          ...manualBankResetPatch(),
          ...payoutChangePatch(profile, nextDestinationKey, now),
        })
        .eq('id', profile.id)

      if (updateError) {
        throw updateError
      }

      return jsonResponse(
        {
          ok: true,
          onboarding: {
            provider: 'STRIPE',
            payoutCurrency: body.payoutCurrency,
            countryCode,
            stripeConnectAccountId: accountId,
            url: accountLink.url,
            expiresAt: accountLink.expires_at,
          },
        },
        200,
        cors
      )
    }

    if (body.action === 'refresh-stripe-connect-status') {
      const { data: pending, error: pendingError } = await supabase
        .from('payout_change_requests')
        .select('id, requested_destination, metadata')
        .eq('tailor_user_id', caller.id)
        .eq('status', 'PENDING')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (pendingError) throw pendingError
      const latestPendingRequest = (pending as PayoutChangeRequestRow | null) ?? null
      const pendingProvider = stringValue(
        latestPendingRequest?.requested_destination,
        'payout_provider'
      )
      const pendingPayoutRequest = pendingProvider === 'STRIPE' ? latestPendingRequest : null
      const pendingStripeId =
        typeof pendingPayoutRequest?.requested_destination?.stripe_connect_account_id === 'string'
          ? pendingPayoutRequest.requested_destination.stripe_connect_account_id.trim()
          : ''
      const accountId = pendingStripeId || profile.stripe_connect_account_id?.trim() || null

      if (!accountId) {
        return jsonResponse(
          { error: 'Stripe Connect is not started for this tailor yet.' },
          409,
          cors
        )
      }

      const account = await retrieveStripeConnectAccount(accountId)
      const verified = stripeTransfersAndPayoutsReady(account)
      const now = new Date().toISOString()
      const pendingCurrency =
        typeof pendingPayoutRequest?.requested_destination?.payout_currency === 'string'
          ? pendingPayoutRequest.requested_destination.payout_currency
          : (profile.payout_currency ?? '')
      await syncStripePayoutDestination(supabase, {
        tailorProfileId: profile.id,
        payoutCurrency: pendingCurrency,
        account,
        checkedAt: now,
      })
      const nextDestinationKey = ['STRIPE_CONNECT', pendingCurrency, account.id].join(':')

      if (isPayoutDestinationChange(profile, nextDestinationKey)) {
        const requestedDestination = {
          ...(pendingPayoutRequest?.requested_destination ?? {}),
          payout_provider: 'STRIPE',
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: verified,
          payout_reverification_required: verified ? false : true,
          stripe_connect_account_id: account.id,
          stripe_account_id: account.id,
          payout_country_code: normalizeCountryCode(
            account.country ?? profile.payout_country_code ?? null
          ),
        }

        let requestId = pendingPayoutRequest?.id ?? null
        if (requestId) {
          const { error: pendingUpdateError } = await supabase
            .from('payout_change_requests')
            .update({
              current_destination: currentDestinationPayload(profile),
              requested_destination: requestedDestination,
              metadata: pendingPayoutRequest?.metadata
                ? {
                    ...pendingPayoutRequest.metadata,
                    action: body.action,
                    provider: 'STRIPE',
                    stripe_status_refreshed_at: now,
                  }
                : initialPayoutChangeMetadata({
                    action: body.action,
                    provider: 'STRIPE',
                    stripe_status_refreshed_at: now,
                    next_destination_key: nextDestinationKey,
                  }),
              submitted_at: now,
              updated_at: now,
            })
            .eq('id', requestId)
          if (pendingUpdateError) throw pendingUpdateError
        } else {
          const staged = await stagePayoutChangeRequest(supabase, {
            tailorUserId: caller.id,
            tailorProfileId: profile.id,
            currentDestination: currentDestinationPayload(profile),
            requestedDestination,
            metadata: initialPayoutChangeMetadata({
              action: body.action,
              provider: 'STRIPE',
              stripe_status_refreshed_at: now,
              next_destination_key: nextDestinationKey,
            }),
          })
          requestId = staged?.id ?? null
        }

        if (verified) {
          await resolveOpsIssueByDedupeKey(supabase, `payout-change:${profile.id}`, {
            outcome: 'AWAITING_TAILOR_CONFIRMATION',
          })
          if (requestId) {
            await enqueuePayoutChangeNotice(supabase, {
              userId: caller.id,
              requestId,
              event: 'REQUESTED',
              destination: requestedDestination,
            })
          }
          await audit(supabase, {
            event: 'seller.payout_change_ready_for_review',
            actor_id: caller.id,
            actor_role: 'TAILOR',
            severity: 'warn',
            payload: {
              function: FN,
              provider: 'STRIPE',
              request_id: requestId,
              payout_currency: normalizeAccountCurrency(profile.payout_currency) ?? 'USD',
              stripe_connect_account_id: account.id,
            },
          })
        }

        return jsonResponse(
          {
            ok: true,
            confirmationRequired: verified,
            pendingReview: !verified,
            requestId,
            account: {
              provider: 'STRIPE',
              stripeConnectAccountId: account.id,
              chargesEnabled: account.charges_enabled === true,
              payoutsEnabled: account.payouts_enabled === true,
              detailsSubmitted: account.details_submitted === true,
              payoutAccountVerified: verified,
              payoutReverificationRequired: verified ? false : true,
              payoutAccountVerifiedAt: verified ? now : null,
              payoutCountryCode: normalizeCountryCode(
                account.country ?? profile.payout_country_code ?? null
              ),
            },
          },
          200,
          cors
        )
      }

      const { error: updateError } = await supabase
        .from('tailor_profiles')
        .update({
          payout_provider: 'STRIPE',
          payout_account_type: 'STRIPE_CONNECT',
          payout_account_verified: verified,
          payout_reverification_required: verified ? false : true,
          payout_account_verified_at: verified ? now : null,
          stripe_connect_account_id: account.id,
          stripe_account_id: account.id,
          payout_country_code: normalizeCountryCode(
            account.country ?? profile.payout_country_code ?? null
          ),
        })
        .eq('id', profile.id)

      if (updateError) {
        throw updateError
      }

      if (verified) {
        await audit(supabase, {
          event: 'seller.payout_account_verified',
          actor_id: caller.id,
          actor_role: 'TAILOR',
          severity: 'info',
          payload: {
            function: FN,
            provider: 'STRIPE',
            payout_currency: normalizeAccountCurrency(profile.payout_currency) ?? 'USD',
            stripe_connect_account_id: account.id,
          },
        })
        await enqueuePayoutChangeNotice(supabase, {
          userId: caller.id,
          requestId: profile.id,
          event: 'SETUP_COMPLETE',
          destination: {
            payout_provider: 'STRIPE',
            payout_currency: normalizeAccountCurrency(profile.payout_currency) ?? 'USD',
            payout_account_verified: true,
          },
        })
      }

      return jsonResponse(
        {
          ok: true,
          account: {
            provider: 'STRIPE',
            stripeConnectAccountId: account.id,
            chargesEnabled: account.charges_enabled === true,
            payoutsEnabled: account.payouts_enabled === true,
            detailsSubmitted: account.details_submitted === true,
            payoutAccountVerified: verified,
            payoutReverificationRequired: verified ? false : true,
            payoutAccountVerifiedAt: verified ? now : null,
            payoutCountryCode: normalizeCountryCode(
              account.country ?? profile.payout_country_code ?? null
            ),
          },
        },
        200,
        cors
      )
    }

    return jsonResponse(
      {
        error: 'Unsupported payout action.',
        message: 'Unsupported payout action.',
        code: 'UNSUPPORTED_ACTION',
      },
      400,
      cors
    )
  } catch (error) {
    await Sentry.captureMessage('Payout account action failed', {
      level: 'error',
      tags: { function: FN, failure_class: 'payout_account' },
      extra: { error: error instanceof Error ? error.message : String(error) },
    })
    log('error', FN, 'unhandled', {
      error: error instanceof Error ? error.message : String(error),
    })
    return providerErrorResponse(error, cors)
  }
})
