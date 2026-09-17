export type PhoneChangeVerificationState = {
  phoneChanged: boolean
  currentPhone: string
  phoneVerifiedAt: unknown
  verifiedPhone: string
}

/**
 * A legacy verified timestamp without a bound phone is treated as applying to
 * the current stored number. Newer records bind the timestamp to
 * `verifiedPhone`, preventing a stale marker from following a changed number.
 */
export function isCurrentPhoneVerified({
  currentPhone,
  phoneVerifiedAt,
  verifiedPhone,
}: Omit<PhoneChangeVerificationState, 'phoneChanged'>) {
  if (!currentPhone || !phoneVerifiedAt) return false
  return !verifiedPhone || verifiedPhone === currentPhone
}

export function phoneChangeRequiresReauth(state: PhoneChangeVerificationState) {
  return state.phoneChanged && isCurrentPhoneVerified(state)
}
