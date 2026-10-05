export type PassportClaimRole = 'CUSTOMER' | 'TAILOR'

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
