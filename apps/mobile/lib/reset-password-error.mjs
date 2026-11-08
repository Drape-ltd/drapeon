export function mapResetPasswordError(error, passwordPolicyHint) {
  const normalized = String(error?.message ?? '').toLowerCase()
  if (error?.code === 'insufficient_aal' || normalized.includes('aal2 session is required')) {
    return 'This account uses an authenticator. Finish the reset on drapeon.co.'
  }
  if (normalized.includes('weak') || normalized.includes('password')) {
    return passwordPolicyHint
  }
  if (normalized.includes('expired') || normalized.includes('invalid') || normalized.includes('session')) {
    return 'This reset link is no longer valid. Request a new link and try again.'
  }
  if (normalized.includes('rate') || normalized.includes('security purposes')) {
    return 'Please wait before trying another password reset.'
  }
  return 'We could not save your new password right now. Please try again in a moment.'
}
