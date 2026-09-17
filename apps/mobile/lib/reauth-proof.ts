import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export type ReauthProofPurpose =
  | 'ACCOUNT_DELETION'
  | 'EMAIL_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'PHONE_CHANGE'
  | 'PAYOUT_ACCOUNT_CHANGE'

export type ReauthEmailChallenge = {
  challengeId: string
  maskedEmail: string
  expiresAt: string
}

export async function issueReauthProof(input: {
  password: string
  purpose: ReauthProofPurpose
}): Promise<{
  error: string | null
  proof?: string
  expiresAt?: string
}> {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    proof?: string
    expiresAt?: string
  }>('reauth-proof-action', {
    body: {
      action: 'issue-proof',
      password: input.password,
      purpose: input.purpose,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not confirm your password yet.'
        : await readFunctionErrorMessage(error, 'We could not confirm your password right now.'),
    }
  }

  if (!data?.proof) {
    return { error: 'We could not confirm your password right now.' }
  }

  return {
    error: null,
    proof: data.proof,
    expiresAt: data.expiresAt,
  }
}

export async function sendReauthEmailChallenge(
  purpose: ReauthProofPurpose
): Promise<{ error: string | null; challenge?: ReauthEmailChallenge }> {
  const { data, error } = await invokeFunction<{
    challengeId?: string
    maskedEmail?: string
    expiresAt?: string
  }>('reauth-proof-action', {
    body: { action: 'issue-email-challenge', purpose },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not send the confirmation code yet.'
        : await readFunctionErrorMessage(
            error,
            'We could not send the confirmation code right now.'
          ),
    }
  }
  if (!data?.challengeId) {
    return { error: 'We could not start that confirmation. Please try again.' }
  }

  return {
    error: null,
    challenge: {
      challengeId: data.challengeId,
      maskedEmail: data.maskedEmail ?? 'your account email',
      expiresAt: data.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  }
}

export async function verifyReauthEmailChallenge(input: {
  purpose: ReauthProofPurpose
  challengeId: string
  code: string
}): Promise<{ error: string | null; proof?: string; expiresAt?: string }> {
  const { data, error } = await invokeFunction<{
    proof?: string
    expiresAt?: string
  }>('reauth-proof-action', {
    body: {
      action: 'verify-email-challenge',
      purpose: input.purpose,
      challengeId: input.challengeId,
      code: input.code,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not verify the code yet.'
        : await readFunctionErrorMessage(error, 'That code could not be confirmed.'),
    }
  }
  if (!data?.proof) {
    return { error: 'That code could not be confirmed. Send a new one.' }
  }

  return { error: null, proof: data.proof, expiresAt: data.expiresAt }
}
