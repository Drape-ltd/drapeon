/**
 * Deep-link session rules.
 *
 * A PKCE `code` is bound to the verifier this device created, so an attacker's
 * code cannot complete here. Raw `access_token`/`refresh_token` pairs in a link
 * are not bound to anything: any app or web page can open `drape://callback#...`
 * with tokens for an attacker-controlled account (login CSRF). Raw tokens may
 * therefore only refresh the account this device is already signed into. This
 * applies in every build, including Development: QA signs in normally.
 */

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return atob(padded)
}

export function jwtSubject(token: string | null | undefined): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}

export function shouldAcceptDeepLinkTokens(input: {
  accessToken: string
  currentUserId: string | null | undefined
}): boolean {
  const subject = jwtSubject(input.accessToken)
  return Boolean(subject && input.currentUserId && subject === input.currentUserId)
}

export function deepLinkHasPkceCode(url: string): boolean {
  try {
    return Boolean(new URL(url).searchParams.get('code'))
  } catch {
    return false
  }
}
