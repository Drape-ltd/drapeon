export type ClaimActionInvocationResult = {
  data: unknown
  error: unknown
}

export async function claimActionServerError(
  result: ClaimActionInvocationResult
): Promise<string | null> {
  if (
    result.data &&
    typeof result.data === 'object' &&
    'error' in result.data &&
    typeof (result.data as { error?: unknown }).error === 'string'
  ) {
    return (result.data as { error: string }).error
  }

  if (!result.error) return null
  const context = (result.error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || !('json' in context)) return null

  try {
    const response =
      'clone' in context && typeof context.clone === 'function' ? context.clone() : context
    const payload = await (response as { json: () => Promise<unknown> }).json()
    return payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : null
  } catch {
    return null
  }
}
