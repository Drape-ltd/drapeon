function functionErrorResponse(error: unknown): Response | null {
  if (!error || typeof error !== 'object') return null
  const context = (error as { context?: unknown }).context
  return context instanceof Response ? context : null
}

function safeMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const message = value.trim()
  if (!message) return null
  const normalized = message.toLowerCase()
  if (
    normalized === 'edge function returned a non-2xx status code' ||
    normalized.startsWith('validation error') ||
    normalized.includes('invalid discriminator')
  ) {
    return null
  }
  return message
}

export async function readFunctionErrorMessage(
  error: unknown,
  fallback = 'That action could not be completed.'
): Promise<string> {
  const response = functionErrorResponse(error)
  if (response) {
    try {
      const clone = response.clone()
      const payload = (await clone.json()) as { message?: unknown; error?: unknown }
      const message = safeMessage(payload?.message) ?? safeMessage(payload?.error)
      if (message) return message
    } catch {
      // Fall through to the safe local message.
    }
  }

  const direct =
    error instanceof Error
      ? safeMessage(error.message)
      : safeMessage((error as { message?: unknown } | null)?.message)
  return direct ?? fallback
}
