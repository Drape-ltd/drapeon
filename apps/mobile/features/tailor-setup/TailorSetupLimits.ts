import { TAILOR_SELLER_TYPE_OPTIONS } from '@drape/shared'
import { MEDIA_LIMITS_SECONDS } from '@drape/shared/media-policy'

export const MAX_PORTFOLIO_ITEMS = 12
export const MIN_PORTFOLIO_ITEMS = 1
export const PORTFOLIO_MIN_MARKER_LEFT =
  `${(MIN_PORTFOLIO_ITEMS / MAX_PORTFOLIO_ITEMS) * 100}%` as `${number}%`
export const MAX_PORTFOLIO_VIDEO_SECONDS = MEDIA_LIMITS_SECONDS.portfolioVideo
export const SUPPORTED_CURRENCIES = ['GBP', 'USD', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'] as const
export const SELLER_TYPE_OPTIONS = TAILOR_SELLER_TYPE_OPTIONS
