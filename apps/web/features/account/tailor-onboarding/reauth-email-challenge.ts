'use client'

import { createClient } from '../../../lib/supabase'

export type ReauthPurpose =
  | 'ACCOUNT_DELETION'
  | 'EMAIL_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'PHONE_CHANGE'
  | 'PAYOUT_ACCOUNT_CHANGE'

export type EmailChallengeSession = {
  challengeId: string
  maskedEmail: string
  expiresAt: string
}

type ChallengeResponse = {
  ok?: boolean
  error?: string
  message?: string
  challengeId?: string
  maskedEmail?: string
  expiresAt?: string
  proof?: string
  attemptsRemaining?: number
}

export class EmailChallengeError extends Error {
  readonly attemptsRemaining?: number
  constructor(message: string, attemptsRemaining?: number) {
    super(message)
    this.name = 'EmailChallengeError'
    this.attemptsRemaining = attemptsRemaining
  }
}

async function invoke(body: Record<string, unknown>): Promise<ChallengeResponse> {
  const { data, error } = await createClient().functions.invoke<ChallengeResponse>(
    'reauth-proof-action',
    { body }
  )
  const payload = data ?? {}
  if (error || payload.error) {
    throw new EmailChallengeError(
      payload.message || payload.error || error?.message || 'That step could not be completed.',
      typeof payload.attemptsRemaining === 'number' ? payload.attemptsRemaining : undefined
    )
  }
  return payload
}

/**
 * Sends a six-digit confirmation code to the account email.
 *
 * This is the path for accounts with no password — Google and Apple signups —
 * and it costs nothing to send, unlike an SMS code.
 */
export async function sendReauthEmailChallenge(purpose: ReauthPurpose): Promise<EmailChallengeSession> {
  const payload = await invoke({ action: 'issue-email-challenge', purpose })
  if (!payload.challengeId) {
    throw new EmailChallengeError('We could not start that confirmation. Please try again.')
  }
  return {
    challengeId: payload.challengeId,
    maskedEmail: payload.maskedEmail ?? 'your account email',
    expiresAt: payload.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
  }
}

/**
 * Exchanges a correct code for the same short-lived proof the password path
 * issues, so downstream functions need no special case for social accounts.
 */
export async function verifyReauthEmailChallenge(input: {
  purpose: ReauthPurpose
  challengeId: string
  code: string
}): Promise<string> {
  const payload = await invoke({
    action: 'verify-email-challenge',
    purpose: input.purpose,
    challengeId: input.challengeId,
    code: input.code,
  })
  if (!payload.proof) {
    throw new EmailChallengeError('That code could not be confirmed. Send a new one.')
  }
  return payload.proof
}

/**
 * True when the account can still be confirmed with a password. Social-only
 * accounts have no `email` identity, so the password path is not offered.
 */
export function hasPasswordIdentity(identities: Array<{ provider?: string }> | null | undefined) {
  return Boolean(identities?.some((identity) => identity.provider === 'email'))
}
