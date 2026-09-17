'use client'

export type LinkableIdentityProvider = 'apple' | 'google'

export type IdentityLinkIntent = {
  provider: LinkableIdentityProvider
  userId: string
  returnTo: string
  startedAt: number
}

const IDENTITY_LINK_INTENT_KEY = 'drapeon.web.auth.identityLink.v1'
const IDENTITY_LINK_INTENT_MAX_AGE_MS = 15 * 60_000

function safeReturnTo(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/account/settings'
}

export function writeIdentityLinkIntent(input: {
  provider: LinkableIdentityProvider
  userId: string
  returnTo?: string
}) {
  const intent: IdentityLinkIntent = {
    provider: input.provider,
    userId: input.userId,
    returnTo: safeReturnTo(input.returnTo),
    startedAt: Date.now(),
  }
  window.localStorage.setItem(IDENTITY_LINK_INTENT_KEY, JSON.stringify(intent))
  return intent
}

export function readIdentityLinkIntent(): IdentityLinkIntent | null {
  const raw = window.localStorage.getItem(IDENTITY_LINK_INTENT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<IdentityLinkIntent>
    if (
      (parsed.provider !== 'apple' && parsed.provider !== 'google') ||
      typeof parsed.userId !== 'string' ||
      !parsed.userId ||
      !Number.isFinite(parsed.startedAt) ||
      Date.now() - Number(parsed.startedAt) > IDENTITY_LINK_INTENT_MAX_AGE_MS
    ) {
      clearIdentityLinkIntent()
      return null
    }
    return {
      provider: parsed.provider,
      userId: parsed.userId,
      returnTo: safeReturnTo(parsed.returnTo),
      startedAt: Number(parsed.startedAt),
    }
  } catch {
    clearIdentityLinkIntent()
    return null
  }
}

export function clearIdentityLinkIntent() {
  window.localStorage.removeItem(IDENTITY_LINK_INTENT_KEY)
}

export function parseIdentityLinkProvider(value: string | null): LinkableIdentityProvider | null {
  return value === 'apple' || value === 'google' ? value : null
}
