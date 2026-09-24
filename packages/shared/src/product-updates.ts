/**
 * Public product-update contract shared by web, mobile, and Ops.
 *
 * These entries are educational content, not an operational order or payment
 * ledger. Delivery, read state, consent, and audience suppression belong to
 * the communications/control plane.
 */

export const PRODUCT_UPDATE_ROLES = ['ALL', 'CUSTOMER', 'TAILOR'] as const
export type ProductUpdateRole = (typeof PRODUCT_UPDATE_ROLES)[number]

export const PRODUCT_UPDATE_SURFACES = ['web', 'ios', 'android'] as const
export type ProductUpdateSurface = (typeof PRODUCT_UPDATE_SURFACES)[number]

export type ProductUpdate = {
  id: string
  title: string
  summary: string
  audience: ProductUpdateRole
  surfaces: readonly ProductUpdateSurface[]
  release: string
  publishedAt: string
  expiresAt?: string
  route?: string
  ctaLabel?: string
  accessibilityText: string
  owner: string
  adoptionEvent: string
  status: 'PUBLISHED' | 'ARCHIVED'
}

export const PRODUCT_UPDATES: readonly ProductUpdate[] = [
  {
    id: 'order-thread-2026-09',
    title: 'One clear order thread',
    summary:
      'Briefs, quotes, payment state, production updates, handoff, and support stay together so both sides know what happens next.',
    audience: 'ALL',
    surfaces: ['web', 'ios', 'android'],
    release: '2026.09',
    publishedAt: '2026-09-12T09:00:00Z',
    route: '/how-it-works',
    ctaLabel: 'See how it works',
    accessibilityText: 'Learn how Drapeon keeps a customer and tailor on the same order record.',
    owner: 'product',
    adoptionEvent: 'product_update_opened',
    status: 'PUBLISHED',
  },
  {
    id: 'ready-made-tailor-2026-09',
    title: 'Ready-made items belong beside your craft',
    summary:
      'Tailors can present ready-made pieces alongside custom work, with the right language and a separate purchase path for each.',
    audience: 'TAILOR',
    surfaces: ['web', 'ios', 'android'],
    release: '2026.09',
    publishedAt: '2026-09-13T09:00:00Z',
    route: '/tailors',
    ctaLabel: 'Read the tailor guide',
    accessibilityText: 'Open guidance for tailor profiles and ready-made listings.',
    owner: 'marketplace',
    adoptionEvent: 'product_update_opened',
    status: 'PUBLISHED',
  },
  {
    id: 'fit-profile-2026-09',
    title: 'Make your fit reusable',
    summary:
      'Save the fit details and preferences you want to reuse, then share the right context when you start a new order.',
    audience: 'CUSTOMER',
    surfaces: ['web', 'ios', 'android'],
    release: '2026.09',
    publishedAt: '2026-09-14T09:00:00Z',
    route: '/account/measurements',
    ctaLabel: 'Open your fit profile',
    accessibilityText: 'Open the customer fit-profile area.',
    owner: 'experience',
    adoptionEvent: 'product_update_opened',
    status: 'PUBLISHED',
  },
] as const

export function isProductUpdateVisible(
  update: ProductUpdate,
  options: { surface: ProductUpdateSurface; role?: ProductUpdateRole; now?: Date }
): boolean {
  if (update.status !== 'PUBLISHED' || !update.surfaces.includes(options.surface)) return false
  if (update.audience !== 'ALL' && update.audience !== (options.role ?? 'ALL')) return false
  const now = options.now ?? new Date()
  if (new Date(update.publishedAt) > now) return false
  if (update.expiresAt && new Date(update.expiresAt) <= now) return false
  return true
}

export function getVisibleProductUpdates(
  options: { surface: ProductUpdateSurface; role?: ProductUpdateRole; now?: Date }
): readonly ProductUpdate[] {
  return PRODUCT_UPDATES.filter((update) => isProductUpdateVisible(update, options))
}
