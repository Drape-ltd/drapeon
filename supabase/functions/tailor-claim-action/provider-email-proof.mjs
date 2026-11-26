/** A provider token is usable for account handover only when that provider verified its email. */
export function verifiedProviderEmail(payload) {
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const verified = payload?.email_verified === true || payload?.email_verified === 'true'
  return verified && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) && email.length <= 320
    ? email
    : null
}
