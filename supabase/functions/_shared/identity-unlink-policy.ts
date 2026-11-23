export type UnlinkableIdentity = {
  identity_id?: string
  provider?: string
  identity_data?: Record<string, unknown> | null
}

const UNLINKABLE_PROVIDERS = new Set(['google', 'apple'])

export function unlinkIdentityEmail(identity: UnlinkableIdentity) {
  const value = identity.identity_data?.email
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

/**
 * Server-side rules for removing a Google or Apple sign-in. The account must keep
 * another sign-in method, and one remaining method must still carry the confirmed
 * account email, so removing a sign-in can never silently change who the account
 * belongs to.
 */
export function evaluateIdentityUnlink(input: {
  identities: UnlinkableIdentity[]
  identityId: string
  accountEmail: string | null | undefined
  accountEmailConfirmed: boolean
}) {
  const accountEmail = input.accountEmail?.trim().toLowerCase() ?? ''
  const target = input.identities.find((identity) => identity.identity_id === input.identityId) ?? null
  const remaining = input.identities.filter((identity) => identity.identity_id !== input.identityId)
  return {
    target,
    remaining,
    belongsToAccount: Boolean(target),
    providerRemovable: UNLINKABLE_PROVIDERS.has(target?.provider ?? ''),
    anotherMethodRemains: Boolean(target) && remaining.length >= 1,
    accountEmailKept:
      Boolean(accountEmail) &&
      input.accountEmailConfirmed &&
      remaining.some((identity) => unlinkIdentityEmail(identity) === accountEmail),
  }
}
