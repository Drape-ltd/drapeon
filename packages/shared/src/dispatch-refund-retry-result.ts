/** A queued provider job is not a terminal Money Desk execution. */
export function queuedDispatchRefundRetryResult(
  data: unknown,
  error?: { message: string } | null,
): { ok: boolean; pending?: boolean; providerReference?: string; error?: string } {
  const result = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown> : {}
  const jobId = typeof result.jobId === 'string' ? result.jobId : null
  return error || !jobId
    ? { ok: false, error: error?.message ?? String(result.outcome ?? 'DISPATCH_REFUND_RETRY_NOT_QUEUED') }
    : { ok: true, pending: true, providerReference: jobId }
}
