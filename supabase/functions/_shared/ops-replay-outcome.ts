export type OpsReplayOutcome = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNKNOWN'

export function opsReplayOutcome(value: unknown): OpsReplayOutcome {
  if (typeof value !== 'string') return 'UNKNOWN'
  const outcome = value.trim().toUpperCase()
  if (outcome === 'SUCCEEDED' || outcome === 'PENDING' || outcome === 'FAILED') return outcome
  return 'UNKNOWN'
}

export function opsReplayFailure(value: unknown): { status: number; code: string; error: string } | null {
  const outcome = opsReplayOutcome(value)
  if (outcome === 'SUCCEEDED') return null
  if (outcome === 'PENDING') return {
    status: 409,
    code: 'OPS_RECEIPT_PENDING',
    error: 'This protected action is still pending. Reread the case and receipt before trying anything else.',
  }
  if (outcome === 'FAILED') return {
    status: 409,
    code: 'OPS_RECEIPT_FAILED',
    error: 'The prior protected action failed. Reread the case and recorded receipt before deciding how to proceed.',
  }
  return {
    status: 502,
    code: 'OPS_RECEIPT_UNVERIFIED',
    error: 'The prior action outcome could not be verified. Reread the case and receipt before proceeding.',
  }
}
