import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

const MIN_PHONE_DIGITS = 7
const MAX_PHONE_DIGITS = 15
const US_NATIONAL_PHONE_LENGTH = 10

function looksLikeNigerianLocalMobile(digits: string) {
  return /^0[789]\d{9}$/.test(digits)
}

function looksLikeNigerianE164Digits(digits: string) {
  return /^234[789]\d{9}$/.test(digits)
}

export function normalizePhoneForStorage(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  if (trimmed.startsWith('+')) {
    if (looksLikeNigerianE164Digits(digits)) {
      return `+${digits}`
    }

    return `+${digits}`
  }

  if (trimmed.startsWith('00') && digits.length > 2) {
    return `+${digits.slice(2)}`
  }

  if (looksLikeNigerianLocalMobile(digits)) {
    return `+234${digits.slice(1)}`
  }

  // The default market is the US. Country-aware inputs always emit E.164, but
  // older/plain inputs can still submit ten national digits. Treat those as a
  // US number instead of silently turning 7/8/9-prefixed values into Nigeria.
  if (!trimmed.startsWith('0') && digits.length === US_NATIONAL_PHONE_LENGTH) {
    return `+1${digits}`
  }

  if (looksLikeNigerianE164Digits(digits)) {
    return `+${digits}`
  }

  // If the user entered a long digit-only value without a leading zero,
  // treat it as an international number missing the plus sign.
  if (!trimmed.startsWith('0') && digits.length > 10) {
    return `+${digits}`
  }

  return digits
}

export function validatePhoneForProfile(value: string): string | null {
  const normalized = normalizePhoneForStorage(value)
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return 'Enter a valid phone number.'
  }

  if (normalized.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(normalized)
    return parsed?.isPossible() ? null : 'Enter a valid phone number.'
  }

  return 'Enter a valid phone number.'
}

export function validateDispatchPhoneForProfile(value: string): string | null {
  const normalized = normalizePhoneForStorage(value)
  const digits = normalized.startsWith('+') ? normalized.slice(1) : normalized

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return 'Enter a valid phone number.'
  }

  if (normalized.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(normalized)
    return parsed?.isPossible() ? null : 'Enter a valid phone number.'
  }

  return 'Enter a valid phone number.'
}

export const PHONE_STORAGE_HINT =
  'Choose the calling code, then enter or paste the phone number.'

export const ACCOUNT_PHONE_UNIQUENESS_HINT =
  'One phone number can belong to only one Drapeon account.'
