import { canDecideTrustException, parseTrustExceptionCommand } from './trust-exception-policy.ts'

const assert = (value: boolean) => { if (!value) throw new Error('Assertion failed') }
const request = { action: 'REQUEST', profileId: 'bf63097d-16b4-4504-ab69-c8d6c92a5d6a', reason: 'Recruitment team omitted the challenge-video instruction.', evidenceReference: 'Recruitment case reviewed by owner', idempotencyKey: 'trust-exception-request-20260928' }
const rejects = (value: unknown) => { let failed = false; try { parseTrustExceptionCommand(value) } catch { failed = true } assert(failed) }
Deno.test('request requires bounded reason, evidence reference, profile and replay key', () => {
  assert(parseTrustExceptionCommand(request).action === 'REQUEST')
  rejects({ ...request, reason: '' })
  rejects({ ...request, evidenceReference: '' })
  rejects({ ...request, profileId: 'other' })
  rejects({ ...request, idempotencyKey: 'short' })
  rejects({ ...request, action: 'BYPASS' })
})
Deno.test('approval and rejection require current case version and truthful waiver acknowledgement', () => {
  for (const action of ['APPROVE', 'REJECT']) {
    const decision = { ...request, action, issueId: '04ef8495-f752-4879-b8b1-64c0fd5189db', expectedRecordVersion: 1, publicEvidenceReviewed: true, videoWaiverAcknowledged: true }
    assert(parseTrustExceptionCommand(decision).action === action)
    rejects({ ...decision, expectedRecordVersion: null })
    rejects({ ...decision, videoWaiverAcknowledged: false })
    rejects({ ...decision, publicEvidenceReviewed: false })
  }
})
Deno.test('only current protected administrator authority may decide waivers', () => {
  const valid = { roles: ['admin'], protectedAccess: true, status: 'ACTIVE', environmentAllowed: true }
  assert(canDecideTrustException(valid))
  assert(!canDecideTrustException({ ...valid, roles: ['trust'] }))
  assert(!canDecideTrustException({ ...valid, protectedAccess: false }))
  assert(!canDecideTrustException({ ...valid, status: 'REVOKED' }))
  assert(!canDecideTrustException({ ...valid, environmentAllowed: false }))
})
