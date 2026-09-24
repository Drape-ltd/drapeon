/**
 * Cross-surface destinations used by email CTAs.
 *
 * Email clients and link scanners should only ever receive an HTTPS URL. The
 * HTTPS handoff page presents an explicit app button, a web fallback, and the
 * store links. App-scheme values are carried as data and are never used as a
 * redirect target until the user chooses the app button.
 */

export const DRAPEON_IOS_STORE_URL = 'https://apps.apple.com/app/id6784264202'
export const DRAPEON_ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.drape.app'

const SAFE_WEB_PATH =
  /^\/(?:$|(?:explore|how-it-works|tailors|apply|help|status|promotions|account|orders|payments|verify-handoff)(?:$|\/|\?|#))/u
const SAFE_APP_URL = /^drape(?:on)?:\/\/(?:[a-z0-9][a-z0-9._/?#=&%+:-]*)?$/iu

/** Keep email destinations same-origin and relative to prevent open redirects. */
export function normalizeEmailWebPath(value: string | null | undefined, fallback = '/explore') {
  const raw = value?.trim() || fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('..'))
    return fallback
  try {
    const parsed = new URL(raw, 'https://drapeon.co')
    if (
      parsed.origin !== 'https://drapeon.co' ||
      !SAFE_WEB_PATH.test(`${parsed.pathname}${parsed.search}${parsed.hash}`)
    )
      return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

/** Accept only the two app schemes Drapeon has shipped. */
export function normalizeDrapeonAppUrl(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw || !SAFE_APP_URL.test(raw)) return null
  return raw.replace(/^drapeon:\/\//iu, 'drape://')
}

export function buildEmailSmartLink(siteUrl: string, webPath: string, appUrl?: string | null) {
  const base = siteUrl.trim().replace(/\/+$/u, '')
  let parsedBase: URL
  try {
    parsedBase = new URL(base)
  } catch {
    parsedBase = new URL('https://drapeon.co')
  }
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:')
    parsedBase = new URL('https://drapeon.co')

  const params = new URLSearchParams({ next: normalizeEmailWebPath(webPath) })
  const normalizedAppUrl = normalizeDrapeonAppUrl(appUrl)
  if (normalizedAppUrl) params.set('app', normalizedAppUrl)
  return `${parsedBase.origin}/open?${params.toString()}`
}
