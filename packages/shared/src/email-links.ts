export const DRAPEON_IOS_STORE_URL = 'https://apps.apple.com/app/id6784264202'
export const DRAPEON_ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.drape.app'

const SAFE_WEB_PATH = /^\/(?:$|(?:explore|how-it-works|tailors|apply|help|status|promotions|account|orders|payments|verify-handoff)(?:$|\/|\?|#))/u
const SAFE_APP_URL = /^drape(?:on)?:\/\/(?:[a-z0-9][a-z0-9._/?#=&%+:-]*)?$/iu

export function normalizeEmailWebPath(value: string | null | undefined) {
  const candidate = value?.trim() || '/explore'
  if (!SAFE_WEB_PATH.test(candidate) || candidate.startsWith('//') || candidate.includes('\\')) return '/explore'
  return candidate
}

export function normalizeDrapeonAppUrl(value: string | null | undefined) {
  const candidate = value?.trim() || 'drape://'
  if (!SAFE_APP_URL.test(candidate)) return null
  return candidate.replace(/^drapeon:\/\//iu, 'drape://')
}

export function buildEmailSmartLink(siteUrl: string, webPath: string, appUrl?: string | null) {
  const origin = siteUrl.replace(/\/+$/u, '')
  const params = new URLSearchParams({ next: normalizeEmailWebPath(webPath) })
  const normalizedAppUrl = normalizeDrapeonAppUrl(appUrl)
  if (normalizedAppUrl) params.set('app', normalizedAppUrl)
  return `${origin}/open?${params.toString()}`
}
