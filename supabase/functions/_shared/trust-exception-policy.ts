/** Manual waivers are a distinct protected workflow, never normal video approval. */
export type TrustExceptionCommand = {
  action: 'REQUEST' | 'APPROVE' | 'REJECT'
  profileId: string
  reason: string
  evidenceReference: string
  idempotencyKey: string
  issueId: string | null
  expectedRecordVersion: number | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function parseTrustExceptionCommand(value: unknown): TrustExceptionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid exception request.')
  const body = value as Record<string, unknown>
  const action = body.action
  if (action !== 'REQUEST' && action !== 'APPROVE' && action !== 'REJECT') throw new Error('Unsupported exception action.')
  const text = (key: string, min: number, max: number) => {
    const result = typeof body[key] === 'string' ? body[key].trim() : ''
    if (result.length < min || result.length > max) throw new Error(`Invalid ${key}.`)
    return result
  }
  const profileId = text('profileId', 36, 36)
  if (!uuid.test(profileId)) throw new Error('Invalid profile ID.')
  const reason = text('reason', 20, 1000)
  const evidenceReference = text('evidenceReference', 8, 500)
  const idempotencyKey = text('idempotencyKey', 16, 180)
  let issueId: string | null = null
  let expectedRecordVersion: number | null = null
  if (action !== 'REQUEST') {
    issueId = text('issueId', 36, 36)
    if (!uuid.test(issueId)) throw new Error('Invalid case ID.')
    if (typeof body.expectedRecordVersion !== 'number' || !Number.isSafeInteger(body.expectedRecordVersion) || body.expectedRecordVersion < 1) throw new Error('Current case version required.')
    expectedRecordVersion = body.expectedRecordVersion
    if (body.publicEvidenceReviewed !== true || body.videoWaiverAcknowledged !== true) throw new Error('Review the public evidence and explicitly acknowledge the missing video.')
  }
  return { action, profileId, reason, evidenceReference, idempotencyKey, issueId, expectedRecordVersion }
}

export function canDecideTrustException(input: { roles: string[]; protectedAccess: boolean; status: string; environmentAllowed: boolean }): boolean {
  return input.status === 'ACTIVE' && input.roles.includes('admin') && input.protectedAccess && input.environmentAllowed
}
