'use client'

import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { normalizePhoneForStorage, validatePhoneForProfile } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { readFunctionErrorMessage } from '../../../lib/function-errors'
import { PhoneSetupPanel, type PhoneSetupStage } from './phone-verification-panel'

async function invokeAccount<T>(fn: string, body: Record<string, unknown>) {
  const { data, error } = await createClient().functions.invoke<
    T & { error?: string; message?: string }
  >(fn, { body })
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
 * Collects the private phone number without leaving tailor setup.
 *
 * Replaces a row that showed "Phone needed" beside a link to /account/settings
 * — a route the account runtime redirects straight back to setup while the
 * profile is incomplete, so the link was a loop. Phone ownership is verified
 * later, only when a protected feature actually needs it.
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
  const [stage, setStage] = useState<PhoneSetupStage>('view')
  const [error, setError] = useState<string | null>(null)

  function validate() {
    const normalized = normalizePhoneForStorage(phone)
    if (!normalized) return 'Add a phone number for order updates and account recovery.'
    return validatePhoneForProfile(normalized)
  }

  async function savePhone() {
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      setStage('editing')
      return
    }
    setError(null)
    setStage('saving')
    try {
      const normalizedPhone = normalizePhoneForStorage(phone)
      const availability = await invokeAccount<{ available?: boolean }>('account-profile-action', {
        action: 'check-phone-availability',
        phone: normalizedPhone,
      })
      if (availability.available !== true) {
        throw new Error('That phone number is already connected to another Drapeon account.')
      }
      await invokeAccount('account-profile-action', {
        action: 'update-personal-info',
        role,
        displayName,
        phone: normalizedPhone,
      })
      await createClient().auth.refreshSession()
      setPhone(normalizedPhone)
      setStage('saved')
      setError(null)
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That phone number could not be saved.')
      setStage('editing')
    }
  }

  return (
    <PhoneSetupPanel
      phone={phone}
      stage={stage}
      error={error}
      onPhoneChange={(value) => {
        setPhone(value)
        setError(null)
      }}
      onStageChange={(next) => {
        setError(null)
        setStage(next)
      }}
      onSave={() => {
        void savePhone()
      }}
    />
  )
}
