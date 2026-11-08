export async function recoveryMfaRequirement(auth) {
  try {
    const assurance = await auth.mfa.getAuthenticatorAssuranceLevel()
    if (assurance.error || !assurance.data) return { error: 'assurance_unavailable' }
    if (assurance.data.currentLevel === 'aal2' || assurance.data.nextLevel === 'aal1') {
      return { ready: true }
    }
    const factors = await auth.mfa.listFactors()
    if (factors.error) return { error: 'factors_unavailable' }
    const factor = factors.data?.totp?.find((item) => item.status === 'verified')
    if (!factor) return { error: 'factor_missing' }
    return { ready: false, factorId: factor.id }
  } catch {
    return { error: 'assurance_unavailable' }
  }
}

export async function verifyRecoveryFactor(auth, factorId, code) {
  try {
    const verification = await auth.mfa.challengeAndVerify({ factorId, code })
    if (verification.error) return { error: 'code_rejected' }
    const assurance = await auth.mfa.getAuthenticatorAssuranceLevel()
    return !assurance.error && assurance.data?.currentLevel === 'aal2'
      ? { ready: true }
      : { error: 'assurance_not_upgraded' }
  } catch {
    return { error: 'verification_unavailable' }
  }
}

export async function updateRecoveredPassword(auth, password) {
  const requirement = await recoveryMfaRequirement(auth)
  if (!requirement.ready) return { error: { code: 'insufficient_aal', message: 'MFA verification is required.' } }
  return auth.updateUser({ password })
}
