/** Manual waivers are a distinct protected workflow, never normal video approval. */
export type TrustExceptionCommand = {
  action: 'REQUEST' | 'APPROVE' | 'REJECT' | 'REFRESH'
  profileId: string
  reason: string
  evidenceReference: string
  idempotencyKey: string
  issueId: string | null
  expectedRecordVersion: number | null
}

export type TrustExceptionProfileRequirements = {
  name: boolean
  phone: boolean
  avatar: boolean
  specialties: boolean
  portfolio: boolean
}

/** Return only readiness booleans; never return or log the tailor's contact value. */
export function deriveTrustExceptionProfileRequirements(input: {
  displayName?: unknown
  phone?: unknown
  avatarUrl?: unknown
  specialtyTags?: unknown
  portfolioPhotoUrls?: unknown
}): TrustExceptionProfileRequirements {
  const present = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  return {
    name: present(input.displayName),
    phone: present(input.phone),
    avatar: present(input.avatarUrl),
    specialties: Array.isArray(input.specialtyTags) && input.specialtyTags.length > 0,
    portfolio: Array.isArray(input.portfolioPhotoUrls) && input.portfolioPhotoUrls.length > 0,
  }
}

export function trustExceptionFailureMessage(code: string | null | undefined, message: string | null | undefined): string {
  const reason = (message ?? '').trim()
  if (reason === 'Profile changed; reread normal trust state') {
    return 'This profile changed after the waiver request. Reload, review the current evidence and refresh its snapshot before approving.'
  }
  if (reason === 'Non-video profile requirements missing') {
    return 'One or more required profile details are missing. Reload to see what must be completed before approval.'
  }
  if (reason === 'Case version changed') return 'Another action changed this case. Reload before deciding.'
  if (reason === 'Exception already decided') return 'This waiver already has a final decision. Reload the case to confirm its current status.'
  if (reason === 'Use the normal trust workflow for this profile') return 'This profile now has a video or a different verification status. Use the normal trust review instead of a video waiver.'
  if (reason === 'Exact exception case required') return 'The selected waiver case no longer matches this profile. Reload the current case before continuing.'
  if (reason === 'Public evidence review and video waiver acknowledgement required'
    || reason === 'Fresh review, reason and recruitment evidence required') {
    return 'Review the current portfolio, confirm no challenge video was reviewed, and complete the reason and recruitment evidence fields.'
  }
  if (code === '42501' && reason.includes('Protected administrator authority')) return 'Protected administrator access expired or is unavailable. Verify protected access, then reload the case.'
  if (code === '42501') return 'The decision was not authorized. Confirm both review acknowledgements and reload the current case.'
  if (['40001', '55000'].includes(code ?? '')) return 'The case cannot be decided in its current state. Reload and review the current profile.'
  return 'The protected exception was not accepted. Check administrator authority and required review fields.'
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function parseTrustExceptionCommand(value: unknown): TrustExceptionCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid exception request.')
  const body = value as Record<string, unknown>
  const action = body.action
  if (action !== 'REQUEST' && action !== 'APPROVE' && action !== 'REJECT' && action !== 'REFRESH') throw new Error('Unsupported exception action.')
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
