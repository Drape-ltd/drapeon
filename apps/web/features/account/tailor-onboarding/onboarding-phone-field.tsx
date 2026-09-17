'use client'

import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { readFunctionErrorMessage } from '../../../lib/function-errors'
import { PhoneVerificationPanel, type PhoneVerificationStage } from './phone-verification-panel'
import {
  EmailChallengeError,
  hasPasswordIdentity,
  sendReauthEmailChallenge,
  verifyReauthEmailChallenge,
  type EmailChallengeSession,
} from './reauth-email-challenge'

function maskEmail(value: string | null | undefined) {
  if (!value) return 'your account email'
  const [local = '', domain = ''] = value.toLowerCase().split('@')
  // Matches the server mask: a fixed, short run of stars reads far better than
  // one star per hidden character.
  const visible = local.slice(0, 2)
  const hidden = '*'.repeat(Math.min(4, Math.max(2, local.length - visible.length)))
  return `${visible}${hidden}@${domain}`
}

async function invokeAccount<T>(fn: string, body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke<T & { error?: string; message?: string }>(
    fn,
    { body }
  )
  const payload = (data ?? {}) as T & { error?: string; message?: string }
  if (error) {
    throw new Error(
      await readFunctionErrorMessage(
        error,
        payload.message || payload.error || 'That change could not be saved.'
      )
    )
  }
  if (payload.error) {
    throw new Error(payload.message || payload.error)
  }
  return payload
}

/**
 * The phone number, set and confirmed without leaving tailor setup.
 *
 * Replaces a row that showed "Phone needed" beside a link to /account/settings
 * — a route the account runtime redirects straight back to setup while the
 * profile is incomplete, so the link was a loop. The change itself required the
 * account password, which a Google or Apple tailor does not have.
 */
export function OnboardingPhoneField({
  session,
  displayName,
  role,
  onSaved,
}: {
  session: Session | null
  displayName: string
  role: 'CUSTOMER' | 'TAILOR'
  onSaved?: () => void
}) {
  const storedPhone = normalizePhoneForStorage(String(session?.user.user_metadata?.phone ?? ''))
  const [phone, setPhone] = useState(storedPhone)
  const [stage, setStage] = useState<PhoneVerificationStage>('view')
  const [challenge, setChallenge] = useState<EmailChallengeSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>(undefined)

  const canUsePassword = hasPasswordIdentity(session?.user.identities)
  const maskedEmail = challenge?.maskedEmail ?? maskEmail(session?.user.email)

  function validate() {
    const normalized = normalizePhoneForStorage(phone)
    if (!normalized) return 'Add a phone number for order updates and account recovery.'
    return validatePhoneForProfile(normalized)
  }

  async function savePhoneWithProof(proof: string) {
    await invokeAccount('account-profile-action', {
      action: 'update-personal-info',
      role,
      displayName,
      phone: normalizePhoneForStorage(phone),
      reauthProof: proof,
    })
    await createClient().auth.refreshSession()
    setStage('saved')
    setNotice(null)
    setError(null)
    setChallenge(null)
    onSaved?.()
  }

  async function sendCode() {
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      setStage('editing')
      return
    }
    setError(null)
    setStage('sending')
    try {
      const next = await sendReauthEmailChallenge('PHONE_CHANGE')
      setChallenge(next)
      setAttemptsRemaining(undefined)
      setStage('code-sent')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not send a confirmation code.')
      setStage('editing')
    }
  }

  async function verifyCode(code: string) {
    if (!challenge) return
    setError(null)
    setStage('verifying')
    try {
      const proof = await verifyReauthEmailChallenge({
        purpose: 'PHONE_CHANGE',
        challengeId: challenge.challengeId,
        code,
      })
      await savePhoneWithProof(proof)
    } catch (cause) {
      if (cause instanceof EmailChallengeError) setAttemptsRemaining(cause.attemptsRemaining)
      setError(cause instanceof Error ? cause.message : 'That code could not be confirmed.')
      setStage('code-sent')
    }
  }

  async function verifyPassword(password: string) {
    setError(null)
    setStage('verifying')
    try {
      const result = await invokeAccount<{ proof?: string }>('reauth-proof-action', {
        action: 'issue-proof',
        purpose: 'PHONE_CHANGE',
        password,
      })
      if (!result.proof) throw new Error('Could not confirm your password. Try again.')
      await savePhoneWithProof(result.proof)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm your password.')
      setStage('password')
    }
  }

  return (
    <PhoneVerificationPanel
      phone={phone}
      stage={stage}
      maskedEmail={maskedEmail}
      hasPasswordIdentity={canUsePassword}
      error={error}
      notice={notice}
      attemptsRemaining={attemptsRemaining}
      onPhoneChange={(value) => {
        setPhone(value)
        setError(null)
      }}
      onStageChange={(next) => {
        setError(null)
        setNotice(null)
        setStage(next)
      }}
      onSendCode={() => {
        void sendCode()
      }}
      onVerifyCode={(code) => {
        void verifyCode(code)
      }}
      onVerifyPassword={(password) => {
        void verifyPassword(password)
      }}
      onUsePassword={() => {
        const invalid = validate()
        if (invalid) {
          setError(invalid)
          return
        }
        setError(null)
        setStage('password')
      }}
    />
  )
}
