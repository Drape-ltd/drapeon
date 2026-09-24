const GENERIC_SERVER_ERROR_MESSAGES = new Set([
  'database error',
  'internal error',
  'internal server error',
  'unauthorized',
  'forbidden',
  'not found',
  'failed to send a request to the edge function',
])

const CONNECTIVITY_ERROR_PATTERNS = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'timed out',
  'connection lost',
  'offline',
  'internet connection appears to be offline',
]

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (!error || typeof error !== 'object') return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : null
}

export function isMachineErrorCodeMessage(value: string): boolean {
  const trimmed = value.trim()
  return /^[A-Z0-9_:-]+$/.test(trimmed) && !trimmed.includes(' ')
}

function isGenericServerErrorMessage(value: string): boolean {
  return GENERIC_SERVER_ERROR_MESSAGES.has(value.trim().toLowerCase())
}

function isValidationLeakMessage(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith('validation error') ||
    normalized.includes('invalid discriminator') ||
    normalized.includes('expected ') ||
    normalized.includes('received ')
  )
}

export function isDisplayableActionError(value: string): boolean {
  return (
    !isMachineErrorCodeMessage(value) &&
    !isGenericServerErrorMessage(value) &&
    !isValidationLeakMessage(value)
  )
}

export function isLikelyConnectivityIssue(error: unknown): boolean {
  const message = readErrorMessage(error)?.toLowerCase() ?? ''
  return CONNECTIVITY_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

export function friendlyActionError(
  error: unknown,
  fallback = 'That action could not finish right now. Please try again.'
): string {
  if (isLikelyConnectivityIssue(error)) {
    return 'Connection looks weak. Your details are still here, so retry when the signal improves.'
  }

  if (error && typeof error === 'object') {
    const candidate =
      (error as { message?: unknown; error?: unknown }).message ??
      (error as { error?: unknown }).error
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      const message = candidate.replace(/^FunctionsHttpError:\s*/i, '').trim()
      if (isDisplayableActionError(message)) return message
    }
  }

  if (
    typeof error === 'string' &&
    error.trim().length > 0 &&
    isDisplayableActionError(error)
  ) {
    return error
  }

  return fallback
}
