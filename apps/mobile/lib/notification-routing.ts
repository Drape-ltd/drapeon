export type PassportClaimRole = 'CUSTOMER' | 'TAILOR'

/** Open the exact public Explore section named by a section-move push. */
export function exploreSectionMoveNotificationPath(data: Record<string, unknown>): string | null {
  if (data.type !== 'explore_section_moved') return null
  if (data.exploreSectionMove === 'READY_TO_WEAR') return '/(public)/explore?category=READY_TO_WEAR'
  if (data.exploreSectionMove === 'TAILORING') return '/(public)/explore?category=TAILORING'
  return null
}

export type PassportClaimNotificationRoute = {
  pathname: '/(tailor)/clients'
  params: { tab: 'diary'; filter: 'claimed' }
}

/** Build a fixed, non-user-controlled Expo Router destination for claim pushes. */
export function passportClaimNotificationRoute(
  role: PassportClaimRole,
  data: Record<string, unknown>
): PassportClaimNotificationRoute | null {
  if (role !== 'TAILOR' || data.type !== 'PASSPORT_CLAIMED') return null

  return {
    pathname: '/(tailor)/clients',
    params: { tab: 'diary', filter: 'claimed' },
  }
}
