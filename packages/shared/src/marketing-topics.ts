/**
 * Drapeon's approved marketing topic vocabulary.
 *
 * These names are the product-side contract. A delivery provider may map them
 * to its own audience/topic IDs, but provider metadata must never become the
 * source of truth for consent, audience membership, or suppression.
 */

export const MARKETING_TOPIC_KEYS = [
  'DRAPEON_STORIES',
  'NEW_TAILOR_DROPS',
  'READY_MADE_EDITS',
  'LAUNCH_EVENTS',
] as const
export type MarketingTopicKey = (typeof MARKETING_TOPIC_KEYS)[number]

export type MarketingTopic = {
  key: MarketingTopicKey
  label: string
  description: string
  category: 'PROMOTION' | 'PRODUCT_UPDATE'
  allowedRoles: readonly ('CUSTOMER' | 'TAILOR')[]
  channels: readonly ('EMAIL' | 'PUSH')[]
  requiresExplicitConsent: true
  providerTopicAlias: string
}

export type MarketingAudienceDefinition = {
  user_ids?: unknown
  roles?: unknown
  [key: string]: unknown
}

export type MarketingAudienceValidation = {
  ok: boolean
  reason?: string
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

/**
 * New-tailor messages must be a curated or matched customer audience. A
 * role-wide audience would turn every profile approval into a broadcast and
 * is intentionally rejected before the campaign can be published.
 */
export function validateMarketingTopicAudience(
  key: MarketingTopicKey,
  audience: MarketingAudienceDefinition,
): MarketingAudienceValidation {
  if (key !== 'NEW_TAILOR_DROPS') return { ok: true }

  const userIds = stringList(audience.user_ids)
  const roles = stringList(audience.roles)
  if (userIds.length === 0) {
    return { ok: false, reason: 'New tailor drops require an explicit customer user_ids audience.' }
  }
  if (roles.length > 0) {
    return { ok: false, reason: 'New tailor drops cannot include a role-wide audience.' }
  }
  return { ok: true }
}

const TOPICS: Record<MarketingTopicKey, MarketingTopic> = {
  DRAPEON_STORIES: {
    key: 'DRAPEON_STORIES',
    label: 'Drapeon stories',
    description: 'Tailor stories, customer perspectives, and the craft behind the marketplace.',
    category: 'PRODUCT_UPDATE',
    allowedRoles: ['CUSTOMER', 'TAILOR'],
    channels: ['EMAIL'],
    requiresExplicitConsent: true,
    providerTopicAlias: 'drapeon-stories',
  },
  NEW_TAILOR_DROPS: {
    key: 'NEW_TAILOR_DROPS',
    label: 'New tailor drops',
    description: 'Newly discoverable tailors and collections that match the recipient’s interests.',
    category: 'PROMOTION',
    allowedRoles: ['CUSTOMER'],
    channels: ['EMAIL', 'PUSH'],
    requiresExplicitConsent: true,
    providerTopicAlias: 'new-tailor-drops',
  },
  READY_MADE_EDITS: {
    key: 'READY_MADE_EDITS',
    label: 'Ready-made edits',
    description: 'Ready-made pieces, fit guidance, and limited edits from eligible tailors.',
    category: 'PROMOTION',
    allowedRoles: ['CUSTOMER'],
    channels: ['EMAIL', 'PUSH'],
    requiresExplicitConsent: true,
    providerTopicAlias: 'ready-made-edits',
  },
  LAUNCH_EVENTS: {
    key: 'LAUNCH_EVENTS',
    label: 'Launch events',
    description: 'Drapeon launches, community moments, and optional maker events.',
    category: 'PROMOTION',
    allowedRoles: ['CUSTOMER', 'TAILOR'],
    channels: ['EMAIL', 'PUSH'],
    requiresExplicitConsent: true,
    providerTopicAlias: 'launch-events',
  },
}

export function getMarketingTopic(key: MarketingTopicKey): MarketingTopic {
  return TOPICS[key]
}

export function isMarketingTopic(value: string): value is MarketingTopicKey {
  return (MARKETING_TOPIC_KEYS as readonly string[]).includes(value)
}

export function canUseMarketingTopic(
  key: MarketingTopicKey,
  role: 'CUSTOMER' | 'TAILOR',
  channel: 'EMAIL' | 'PUSH',
): boolean {
  const topic = getMarketingTopic(key)
  return topic.allowedRoles.includes(role) && topic.channels.includes(channel)
}
