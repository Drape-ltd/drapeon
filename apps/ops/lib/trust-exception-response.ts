export type ExceptionCase = {
  id: string
  caseNumber: string
  recordVersion: number
  status: string
  snapshotStale?: boolean
  metadata: Record<string, unknown>
}

export type ProfileRequirements = {
  name: boolean
  phone: boolean
  avatar: boolean
  specialties: boolean
  portfolio: boolean
}

export type ActionResponse = {
  ok?: unknown
  error?: unknown
  code?: unknown
  correlationId?: unknown
  case?: ExceptionCase | null
  receiptId?: unknown
  profileRequirements?: ProfileRequirements | null
}

export type ExceptionDraft = { reason: string; reference: string }

export function resolveTrustExceptionDraft(record: ExceptionCase | null, preserved: ExceptionDraft | null): ExceptionDraft {
  if (preserved) return preserved
  return {
    reason: String(record?.metadata?.reason ?? ''),
    reference: String(record?.metadata?.evidenceReference ?? ''),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validCase(value: unknown): value is ExceptionCase {
  return isObject(value) &&
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.caseNumber === 'string' && value.caseNumber.length > 0 &&
    Number.isSafeInteger(value.recordVersion) && Number(value.recordVersion) >= 0 &&
    typeof value.status === 'string' && value.status.length > 0 &&
    (value.snapshotStale === undefined || typeof value.snapshotStale === 'boolean') &&
    isObject(value.metadata)
}

function validRequirements(value: unknown): value is ProfileRequirements {
  return isObject(value) &&
    ['name', 'phone', 'avatar', 'specialties', 'portfolio'].every(key => typeof value[key] === 'boolean')
}

export function validTrustExceptionRead(value: unknown): value is ActionResponse {
  return isObject(value) && value.ok === true &&
    (value.case === null || validCase(value.case)) &&
    (value.profileRequirements === null || validRequirements(value.profileRequirements))
}

export function validTrustExceptionAction(value: unknown): value is ActionResponse & { case: ExceptionCase } {
  return isObject(value) && value.ok === true && validCase(value.case) &&
    (value.profileRequirements === undefined || value.profileRequirements === null || validRequirements(value.profileRequirements))
}
