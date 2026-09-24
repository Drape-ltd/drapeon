/**
 * Drapeon lifecycle and conversion measurement contract.
 *
 * This registry describes events that may be emitted by a consent-aware
 * analytics path. It is not an operational order or payment ledger. Server
 * events remain authoritative for those workflows, and no event may include
 * direct customer identifiers or private workflow data.
 */

export const LIFECYCLE_EVENT_REGISTRY_VERSION = 1 as const

export const LIFECYCLE_EVENT_PURPOSES = ['CONVERSION', 'EDUCATION', 'FEEDBACK'] as const
export type LifecycleEventPurpose = (typeof LIFECYCLE_EVENT_PURPOSES)[number]

export const LIFECYCLE_EVENT_SURFACES = ['web', 'ios', 'android'] as const
export type LifecycleEventSurface = (typeof LIFECYCLE_EVENT_SURFACES)[number]

export const LIFECYCLE_EVENT_ROLES = ['ANONYMOUS', 'CUSTOMER', 'TAILOR', 'SYSTEM'] as const
export type LifecycleEventRole = (typeof LIFECYCLE_EVENT_ROLES)[number]

export const LIFECYCLE_EVENT_SOURCES = ['UI_ANALYTICS', 'AUTHORITATIVE_OPERATIONAL'] as const
export type LifecycleEventSource = (typeof LIFECYCLE_EVENT_SOURCES)[number]

export const LIFECYCLE_EVENT_CONSENT_BASES = [
  'OPTIONAL_ANALYTICS_OPT_IN',
  'REQUIRED_OPERATIONAL',
] as const
export type LifecycleEventConsentBasis = (typeof LIFECYCLE_EVENT_CONSENT_BASES)[number]

export const LIFECYCLE_EVENT_SENSITIVITY = ['ANONYMOUS', 'PSEUDONYMOUS', 'OPERATIONAL'] as const
export type LifecycleEventSensitivity = (typeof LIFECYCLE_EVENT_SENSITIVITY)[number]

export const LIFECYCLE_ATTRIBUTION_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ref',
  'referral_id_hash',
] as const
export type LifecycleAttributionField = (typeof LIFECYCLE_ATTRIBUTION_FIELDS)[number]

export const LIFECYCLE_FORBIDDEN_PROPERTIES = [
  'email',
  'phone',
  'name',
  'address',
  'measurement',
  'measurements',
  'trust_video',
  'private_media',
  'message_body',
  'payment_details',
  'credential',
  'password',
  'access_token',
  'refresh_token',
] as const

type LifecycleTerminalSemantics = {
  success: string
  failure: string
}

export type LifecycleEventDefinition = {
  name: string
  version: 1
  purpose: LifecycleEventPurpose
  source: LifecycleEventSource
  surfaces: readonly LifecycleEventSurface[]
  route: string
  actorRole: LifecycleEventRole
  stage: string
  trigger: string
  terminal: LifecycleTerminalSemantics
  attributionFields: readonly LifecycleAttributionField[]
  allowedProperties: readonly string[]
  forbiddenProperties: readonly string[]
  sensitivity: LifecycleEventSensitivity
  retentionDays: number
  consentBasis: LifecycleEventConsentBasis
  destinationMetric: string
  correlationId: string
  dedupeKey: string
  samplingRate: number
  negativeCase: string
}

function event(
  input: Omit<LifecycleEventDefinition, 'version' | 'forbiddenProperties'>
): LifecycleEventDefinition {
  return {
    ...input,
    version: LIFECYCLE_EVENT_REGISTRY_VERSION,
    forbiddenProperties: LIFECYCLE_FORBIDDEN_PROPERTIES,
  }
}

/**
 * Versioned registry for the initial customer, tailor, education, and
 * feedback funnels. Property names are intentionally allow-listed; values
 * are supplied by the emitting surface only after consent and sanitisation.
 */
export const LIFECYCLE_EVENT_REGISTRY = [
  event({
    name: 'account_created',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'account creation callback',
    actorRole: 'SYSTEM',
    stage: 'awareness',
    trigger: 'Auth creates an account and the durable public user row is bootstrapped.',
    terminal: { success: 'account_created', failure: 'profile_bootstrap_failed' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['role', 'signup_method', 'entry_surface', 'referral_id_hash'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'account_created',
    correlationId: 'account_created_event_id_hash',
    dedupeKey: 'user_id_hash+account_created',
    samplingRate: 1,
    negativeCase:
      'A repeated callback, failed profile bootstrap, or abandoned verification must not restart welcome delivery.',
  }),
  event({
    name: 'marketing_page_viewed',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web'],
    route: 'public marketing route',
    actorRole: 'ANONYMOUS',
    stage: 'awareness',
    trigger: 'A public marketing page renders for a real visitor.',
    terminal: { success: 'page_rendered', failure: 'page_failed_to_render' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['page', 'entry_surface', 'media_ready'],
    sensitivity: 'ANONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'marketing_engaged_visit',
    correlationId: 'session_id',
    dedupeKey: 'session_id+page+day',
    samplingRate: 1,
    negativeCase:
      'Do not emit until analytics consent is known and granted; record no vendor replay.',
  }),
  event({
    name: 'marketing_cta_clicked',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web'],
    route: 'public marketing route',
    actorRole: 'ANONYMOUS',
    stage: 'consideration',
    trigger: 'A visitor activates a labeled call to action on a public marketing surface.',
    terminal: { success: 'cta_activated', failure: 'cta_not_activated' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['page', 'cta', 'entry_surface'],
    sensitivity: 'ANONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'marketing_cta_activation',
    correlationId: 'session_id',
    dedupeKey: 'session_id+page+cta+day',
    samplingRate: 1,
    negativeCase:
      'Do not emit for unlabelled controls, private routes, cancelled navigation, or before analytics consent.',
  }),
  event({
    name: 'product_update_opened',
    purpose: 'EDUCATION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'What’s New entry',
    actorRole: 'ANONYMOUS',
    stage: 'education',
    trigger: 'A visitor opens a published, audience-eligible product update from a governed feed.',
    terminal: { success: 'update_opened', failure: 'update_unavailable_or_deep_link_failed' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['update_id', 'entry_surface', 'release'],
    sensitivity: 'ANONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'product_update_open',
    correlationId: 'session_id',
    dedupeKey: 'session_id+update_id+day',
    samplingRate: 1,
    negativeCase:
      'Do not emit for archived, expired, audience-ineligible, unavailable, or private updates, or before consent.',
  }),
  event({
    name: 'tailor_profile_viewed',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'public tailor profile',
    actorRole: 'CUSTOMER',
    stage: 'discovery',
    trigger: 'A public tailor profile renders with its approved media state.',
    terminal: { success: 'profile_rendered', failure: 'profile_or_media_failed' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'entry_surface', 'media_ready', 'profile_variant'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'tailor_profile_open',
    correlationId: 'session_id',
    dedupeKey: 'session_id+tailor_id_hash+day',
    samplingRate: 1,
    negativeCase: 'Missing or failed media is a quality failure, never a conversion success.',
  }),
  event({
    name: 'tailor_saved',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor profile or saved-tailors surface',
    actorRole: 'CUSTOMER',
    stage: 'consideration',
    trigger: 'A signed-in customer saves or follows a tailor.',
    terminal: { success: 'save_persisted', failure: 'save_rejected_or_reverted' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'entry_surface'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'tailor_save',
    correlationId: 'request_id',
    dedupeKey: 'user_id_hash+tailor_id_hash',
    samplingRate: 1,
    negativeCase:
      'A failed or duplicate save emits no success event and leaves the saved state unchanged.',
  }),
  event({
    name: 'conversation_started',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor profile or order conversation',
    actorRole: 'CUSTOMER',
    stage: 'consideration',
    trigger: 'The first customer message is accepted into a new tailor conversation.',
    terminal: { success: 'message_accepted', failure: 'message_rejected_or_undelivered' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'entry_surface', 'conversation_kind'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'first_conversation',
    correlationId: 'conversation_id_hash',
    dedupeKey: 'user_id_hash+tailor_id_hash+conversation_id_hash',
    samplingRate: 1,
    negativeCase:
      'Never send message text, contact details, or a conversion event when delivery is not accepted.',
  }),
  event({
    name: 'fit_profile_completed',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'fit profile',
    actorRole: 'CUSTOMER',
    stage: 'readiness',
    trigger:
      'A customer saves the required fit-profile fields and receives a durable completion state.',
    terminal: { success: 'fit_profile_saved', failure: 'fit_profile_rejected_or_incomplete' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['entry_surface', 'completion_method', 'field_count_bucket'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'fit_profile_completion',
    correlationId: 'request_id',
    dedupeKey: 'user_id_hash+fit_profile_version',
    samplingRate: 1,
    negativeCase: 'Do not include fit values; incomplete or rejected saves remain non-conversions.',
  }),
  event({
    name: 'order_started',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'custom brief or ready-made checkout',
    actorRole: 'CUSTOMER',
    stage: 'intent',
    trigger: 'A customer opens an order path with a valid tailor or ready-made context.',
    terminal: { success: 'order_context_opened', failure: 'order_context_blocked' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'item_id_hash', 'order_kind', 'entry_surface'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'order_intent',
    correlationId: 'session_id',
    dedupeKey: 'session_id+tailor_id_hash+item_id_hash+day',
    samplingRate: 1,
    negativeCase:
      'A blocked, unavailable, or stale context is recorded as failure, not an order start.',
  }),
  event({
    name: 'order_paid',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'order payment result',
    actorRole: 'SYSTEM',
    stage: 'purchase',
    trigger: 'A provider-confirmed payment transition marks the order funded.',
    terminal: { success: 'payment_confirmed', failure: 'payment_failed_or_cancelled' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['order_id_hash', 'order_kind', 'currency', 'amount_bucket'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'paid_order',
    correlationId: 'payment_event_id_hash',
    dedupeKey: 'payment_event_id_hash',
    samplingRate: 1,
    negativeCase:
      'Only a provider-confirmed terminal payment may emit success; duplicate callbacks are ignored.',
  }),
  event({
    name: 'order_completed',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'order timeline',
    actorRole: 'SYSTEM',
    stage: 'retention',
    trigger: 'The authoritative order state reaches completion after required handoff evidence.',
    terminal: { success: 'order_completed', failure: 'completion_blocked_or_reopened' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['order_id_hash', 'order_kind', 'fulfillment_mode'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'completed_order',
    correlationId: 'order_event_id_hash',
    dedupeKey: 'order_id_hash+completed_event_id_hash',
    samplingRate: 1,
    negativeCase:
      'Do not count a dispatch, payout, survey, or review as completion unless the order state is terminal.',
  }),
  event({
    name: 'referral_shared',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'referral or invite surface',
    actorRole: 'CUSTOMER',
    stage: 'advocacy',
    trigger: 'A customer or tailor creates a referral share action.',
    terminal: { success: 'referral_created', failure: 'referral_rejected_or_cancelled' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['referral_id_hash', 'entry_surface', 'recipient_count_bucket'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'referral_share',
    correlationId: 'referral_id_hash',
    dedupeKey: 'user_id_hash+referral_id_hash',
    samplingRate: 1,
    negativeCase:
      'Never include recipient email, phone, or message content; cancelled shares are not conversions.',
  }),
  event({
    name: 'tailor_application_submitted',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor application',
    actorRole: 'TAILOR',
    stage: 'supply',
    trigger: 'A tailor application is accepted for review with a durable request record.',
    terminal: { success: 'application_submitted', failure: 'application_rejected_or_incomplete' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['entry_surface', 'application_kind', 'portfolio_count_bucket'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'tailor_application',
    correlationId: 'application_id_hash',
    dedupeKey: 'user_id_hash+application_id_hash',
    samplingRate: 1,
    negativeCase:
      'A missing proof item or rejected application records failure without sending private media to analytics.',
  }),
  event({
    name: 'waitlist_joined',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web'],
    route: 'waitlist form',
    actorRole: 'ANONYMOUS',
    stage: 'awareness',
    trigger: 'A waitlist request is accepted into the durable queue after validation.',
    terminal: { success: 'waitlist_recorded', failure: 'waitlist_rejected_or_duplicate' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['role', 'entry_surface'],
    sensitivity: 'ANONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'waitlist_join',
    correlationId: 'session_id',
    dedupeKey: 'session_id+role+day',
    samplingRate: 1,
    negativeCase:
      'Invalid, rejected, duplicate, or abandoned waitlist submissions emit no success event and no contact details.',
  }),
  event({
    name: 'tailor_profile_live',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor profile',
    actorRole: 'SYSTEM',
    stage: 'supply',
    trigger: 'Ops/profile eligibility marks a tailor profile publicly discoverable.',
    terminal: { success: 'profile_live', failure: 'profile_blocked_or_unpublished' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: [
      'tailor_id_hash',
      'portfolio_count_bucket',
      'ready_made_enabled',
      'custom_enabled',
    ],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'live_tailor_supply',
    correlationId: 'profile_event_id_hash',
    dedupeKey: 'tailor_id_hash+profile_event_id_hash',
    samplingRate: 1,
    negativeCase: 'A media failure or incomplete profile cannot emit a live success event.',
  }),
  event({
    name: 'portfolio_completed',
    purpose: 'CONVERSION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor portfolio setup',
    actorRole: 'TAILOR',
    stage: 'supply',
    trigger: 'A tailor saves the minimum approved portfolio set and receives completion state.',
    terminal: { success: 'portfolio_saved', failure: 'portfolio_incomplete_or_rejected' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['entry_surface', 'approved_media_count_bucket', 'media_format_set'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'portfolio_completion',
    correlationId: 'request_id',
    dedupeKey: 'user_id_hash+portfolio_version',
    samplingRate: 1,
    negativeCase:
      'Broken, rejected, or missing media remains a failure and does not expose media URLs.',
  }),
  event({
    name: 'ready_made_item_published',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'ready-made listing setup',
    actorRole: 'TAILOR',
    stage: 'supply',
    trigger: 'A ready-made item passes listing eligibility and becomes publicly orderable.',
    terminal: { success: 'item_live', failure: 'item_blocked_or_unpublished' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'item_id_hash', 'media_ready', 'currency'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'live_ready_made_supply',
    correlationId: 'item_event_id_hash',
    dedupeKey: 'item_id_hash+item_event_id_hash',
    samplingRate: 1,
    negativeCase: 'A missing image, price, or fulfillment rule cannot count as a published item.',
  }),
  event({
    name: 'tailor_first_order',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor order timeline',
    actorRole: 'SYSTEM',
    stage: 'supply',
    trigger:
      'A tailor receives the first eligible order that reaches the configured terminal state.',
    terminal: { success: 'first_order_completed', failure: 'order_cancelled_or_disputed' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'order_kind', 'fulfillment_mode'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'tailor_activation',
    correlationId: 'order_event_id_hash',
    dedupeKey: 'tailor_id_hash+order_event_id_hash',
    samplingRate: 1,
    negativeCase: 'A cancelled, refunded, or disputed order is not a first-order success.',
  }),
  event({
    name: 'payout_ready',
    purpose: 'CONVERSION',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'tailor earnings',
    actorRole: 'SYSTEM',
    stage: 'supply',
    trigger: 'Provider-confirmed payout capability and order eligibility make earnings releasable.',
    terminal: { success: 'payout_eligible', failure: 'payout_blocked_or_reversed' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['tailor_id_hash', 'currency', 'amount_bucket'],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'tailor_payout_readiness',
    correlationId: 'settlement_event_id_hash',
    dedupeKey: 'settlement_event_id_hash',
    samplingRate: 1,
    negativeCase:
      'Never infer payout readiness from profile completion or a client-side provider redirect.',
  }),
  event({
    name: 'guide_started',
    purpose: 'EDUCATION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'Learn Drapeon guide',
    actorRole: 'CUSTOMER',
    stage: 'education',
    trigger: 'A customer or tailor opens a contextual guide.',
    terminal: { success: 'guide_opened', failure: 'guide_unavailable' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['guide_id', 'role', 'entry_surface', 'guide_version'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'guide_start',
    correlationId: 'session_id',
    dedupeKey: 'user_id_hash+guide_id+guide_version',
    samplingRate: 1,
    negativeCase: 'Unavailable, gated, or feature-flagged guides emit no start success.',
  }),
  event({
    name: 'guide_completed',
    purpose: 'EDUCATION',
    source: 'UI_ANALYTICS',
    surfaces: ['web', 'ios', 'android'],
    route: 'Learn Drapeon guide',
    actorRole: 'CUSTOMER',
    stage: 'education',
    trigger: 'A guide reaches its final step and stores a durable completion marker.',
    terminal: { success: 'guide_completed', failure: 'guide_abandoned_or_failed' },
    attributionFields: LIFECYCLE_ATTRIBUTION_FIELDS,
    allowedProperties: ['guide_id', 'role', 'entry_surface', 'guide_version'],
    sensitivity: 'PSEUDONYMOUS',
    retentionDays: 180,
    consentBasis: 'OPTIONAL_ANALYTICS_OPT_IN',
    destinationMetric: 'guide_completion',
    correlationId: 'guide_progress_id_hash',
    dedupeKey: 'user_id_hash+guide_id+guide_version',
    samplingRate: 1,
    negativeCase: 'A skipped, closed, or partially loaded guide is not complete.',
  }),
  event({
    name: 'survey_submitted',
    purpose: 'FEEDBACK',
    source: 'AUTHORITATIVE_OPERATIONAL',
    surfaces: ['web', 'ios', 'android'],
    route: 'post-completion or support survey',
    actorRole: 'SYSTEM',
    stage: 'feedback',
    trigger: 'A permitted survey response is saved with its version and subject reference.',
    terminal: { success: 'survey_saved', failure: 'survey_rejected_or_duplicate' },
    attributionFields: [],
    allowedProperties: [
      'survey_id',
      'survey_version',
      'subject_kind',
      'score_bucket',
      'issue_tag_count',
    ],
    sensitivity: 'OPERATIONAL',
    retentionDays: 365,
    consentBasis: 'REQUIRED_OPERATIONAL',
    destinationMetric: 'csat_response',
    correlationId: 'survey_response_id_hash',
    dedupeKey: 'subject_id_hash+survey_version',
    samplingRate: 1,
    negativeCase:
      'Enforce one response per permitted subject; negative feedback routes to support without exposing comments to analytics.',
  }),
] as const satisfies readonly LifecycleEventDefinition[]

export type LifecycleEventName = (typeof LIFECYCLE_EVENT_REGISTRY)[number]['name']

export type LifecycleAnalyticsValue = string | number | boolean | null

const registryByName = new Map<string, LifecycleEventDefinition>(
  LIFECYCLE_EVENT_REGISTRY.map((definition) => [definition.name, definition])
)

export function getLifecycleEventDefinition(name: string): LifecycleEventDefinition | null {
  return registryByName.get(name) ?? null
}

export function isLifecycleEventName(name: string): name is LifecycleEventName {
  return registryByName.has(name)
}

function normalizedPropertyName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .replace(/-/gu, '_')
}

export function isForbiddenLifecycleProperty(name: string): boolean {
  const normalized = normalizedPropertyName(name)
  return LIFECYCLE_FORBIDDEN_PROPERTIES.some((forbidden) => {
    const token = normalizedPropertyName(forbidden)
    return normalized === token || normalized.includes(token)
  })
}

/**
 * Keep event payloads primitive and allow-listed before they reach an
 * analytics SDK. Unknown event names and rejected properties are returned to
 * the caller so debug tooling can surface the contract violation without
 * sending the data.
 */
export function sanitizeLifecycleProperties(
  eventName: string,
  properties: Record<string, unknown> = {}
): { accepted: Record<string, LifecycleAnalyticsValue>; rejected: string[] } {
  const definition = getLifecycleEventDefinition(eventName)
  const allowed = new Set(definition?.allowedProperties ?? [])
  const accepted: Record<string, LifecycleAnalyticsValue> = {}
  const rejected: string[] = []

  for (const [key, value] of Object.entries(properties)) {
    if (
      !definition ||
      !allowed.has(key) ||
      isForbiddenLifecycleProperty(key) ||
      (value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean') ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      rejected.push(key)
      continue
    }
    accepted[key] = value as LifecycleAnalyticsValue
  }

  return { accepted, rejected }
}
