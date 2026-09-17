import type { SignupMediaDraftDescriptor } from './signup-media-draft'

export const OAUTH_SIGNUP_DRAFT_KEY = 'drapeon.web.auth.oauth-signup-draft.v1'

// A Google or Apple round trip can include creating the provider account,
// two-factor, and a password manager prompt. Fifteen minutes silently discarded
// the phone number of anyone who took longer.
const OAUTH_SIGNUP_DRAFT_MAX_AGE_MS = 60 * 60_000

export type OAuthSignupDraft = {
  role: 'CUSTOMER' | 'TAILOR'
  displayName: string
  phone: string
  /**
   * The bytes remain in IndexedDB; this descriptor lets the callback attach
   * the photo after the provider creates the account.
   */
  avatarDraft?: SignupMediaDraftDescriptor
  startedAt: number
}

function readAvatarDraft(value: unknown): SignupMediaDraftDescriptor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const draft = value as Partial<SignupMediaDraftDescriptor>
  if (
    typeof draft.key !== 'string' ||
    typeof draft.name !== 'string' ||
    typeof draft.contentType !== 'string' ||
    typeof draft.byteLength !== 'number' ||
    typeof draft.durationSeconds !== 'number' ||
    typeof draft.createdAt !== 'string'
  ) {
    return undefined
  }
  return draft as SignupMediaDraftDescriptor
}

export function writeOAuthSignupDraft(draft: OAuthSignupDraft) {
  window.localStorage.setItem(OAUTH_SIGNUP_DRAFT_KEY, JSON.stringify(draft))
}

export function readOAuthSignupDraft(): OAuthSignupDraft | null {
  const raw = window.localStorage.getItem(OAUTH_SIGNUP_DRAFT_KEY)
  if (!raw) return null

  try {
    const draft = JSON.parse(raw) as Partial<OAuthSignupDraft>
    if (
      (draft.role !== 'CUSTOMER' && draft.role !== 'TAILOR') ||
      typeof draft.displayName !== 'string' ||
      typeof draft.phone !== 'string' ||
      typeof draft.startedAt !== 'number' ||
      !Number.isFinite(draft.startedAt) ||
      Date.now() - draft.startedAt > OAUTH_SIGNUP_DRAFT_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(OAUTH_SIGNUP_DRAFT_KEY)
      return null
    }
    return {
      role: draft.role,
      displayName: draft.displayName,
      phone: draft.phone,
      avatarDraft: readAvatarDraft(draft.avatarDraft),
      startedAt: draft.startedAt,
    }
  } catch {
    window.localStorage.removeItem(OAUTH_SIGNUP_DRAFT_KEY)
    return null
  }
}

export function clearOAuthSignupDraft() {
  window.localStorage.removeItem(OAUTH_SIGNUP_DRAFT_KEY)
}
