import { canDecideTrustException, deriveTrustExceptionProfileRequirements, parseTrustExceptionCommand, trustExceptionFailureMessage } from './trust-exception-policy.ts'

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
  for (const action of ['APPROVE', 'REJECT', 'REFRESH']) {
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

Deno.test('waiver conflict errors preserve actionable parity for local Ops and production Edge', () => {
  assert(trustExceptionFailureMessage('55000', 'Profile changed; reread normal trust state').includes('refresh its snapshot'))
  assert(trustExceptionFailureMessage('55000', 'Non-video profile requirements missing').includes('profile details'))
  assert(trustExceptionFailureMessage('40001', 'Case version changed').includes('Reload'))
  assert(trustExceptionFailureMessage('55000', 'Exception already decided').includes('final decision'))
  assert(trustExceptionFailureMessage('55000', 'Use the normal trust workflow for this profile').includes('normal trust review'))
  assert(trustExceptionFailureMessage('42501', 'Protected administrator authority required').includes('Verify protected access'))
  assert(trustExceptionFailureMessage('42501', 'Public evidence review and video waiver acknowledgement required').includes('confirm no challenge video was reviewed'))
  assert(trustExceptionFailureMessage('55000', 'unrecognized conflict').includes('current profile'))
})

Deno.test('profile readiness exposes presence only and treats whitespace and empty collections as missing', () => {
  const complete = deriveTrustExceptionProfileRequirements({displayName:'Kenny',phone:'+2348000000000',avatarUrl:'avatar.jpg',specialtyTags:['Suits'],portfolioPhotoUrls:['work.jpg']})
  assert(Object.values(complete).every(Boolean))
  const missingPhone = deriveTrustExceptionProfileRequirements({displayName:'Kenny',phone:'  ',avatarUrl:'avatar.jpg',specialtyTags:['Suits'],portfolioPhotoUrls:['work.jpg']})
  assert(!missingPhone.phone && missingPhone.name && missingPhone.avatar && missingPhone.specialties && missingPhone.portfolio)
  const incomplete = deriveTrustExceptionProfileRequirements({displayName:'',phone:null,avatarUrl:' ',specialtyTags:[],portfolioPhotoUrls:[]})
  assert(Object.values(incomplete).every(value => !value))
})
