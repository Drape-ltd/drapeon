'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { CommunicationCenter } from '../../../components/communication-center'
import { friendlyActionError } from '@drape/shared/action-errors'
import { CONTACTS, normalizePhoneForStorage, buildWhatsAppSupportUrl, formatRelative, validatePhoneForProfile, validatePasswordStrength } from '@drape/shared'
import { validateDisplayName } from '@drape/shared/contact-filter'
import { PHONE_STORAGE_HINT } from '@drape/shared/phone'
import { createClient } from '../../../lib/supabase'
import { safeEntityName } from '../../../lib/safe-display'
import type { SettingsRenderData, SupportRenderData, SupportSurfaceData } from '../shared/account-data-contracts'
import { invokeAccountFunction, isTerminalOrder } from '../shared/account-data-queries'
import { ActionNotice, accountRoute, assertNoContactLeak, cleanLabel, orderTitle, partyName } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { NativeSelect } from '../../../components/ui/native-select'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Textarea } from '../../../components/ui/textarea'
import { StagePill, mailto } from '../payouts/account-payout-surfaces'
import { AvatarUploadPanel } from '../profile/account-profile-surface'

type ReauthProofPurpose =
  | 'ACCOUNT_DELETION'
  | 'EMAIL_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'PHONE_CHANGE'
  | 'PAYOUT_ACCOUNT_CHANGE'

async function issueWebReauthProof(password: string, purpose: ReauthProofPurpose) {
  const result = await invokeAccountFunction<{ proof?: string; expiresAt?: string }>(
    'reauth-proof-action',
    {
      action: 'issue-proof',
      password,
      purpose,
    }
  )
  if (!result.proof) throw new Error('Could not confirm your current password. Try again.')
  return result
}

const SUPPORT_CATEGORIES = [
  ['PAYMENT', 'Payment issue'],
  ['FIT', 'Fit or alteration issue'],
  ['DELIVERY_HANDOFF', 'Delivery or handoff issue'],
  ['ACCOUNT_SECURITY', 'Account or security issue'],
  ['TAILOR_PAYOUT', 'Tailor payout or setup issue'],
  ['GENERAL', 'Something else'],
] as const

function GeneralSupportForm({
  data,
  onRefresh,
}: {
  data: SupportSurfaceData
  onRefresh: () => void
}) {
  const searchParams = useSearchParams()
  const linkedOrderId = searchParams.get('orderId')
  const orderOptions = data.orders.slice(0, 12)
  const [category, setCategory] = useState<(typeof SUPPORT_CATEGORIES)[number][0]>('PAYMENT')
  const [orderId, setOrderId] = useState(
    linkedOrderId && data.orders.some((order) => order.id === linkedOrderId) ? linkedOrderId : ''
  )
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function submitSupport() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(
      [subject, description].join('\n'),
      "Support requests can't include phone numbers, email addresses, social handles, or off-platform contact details."
    )
    if (leak) {
      setError(leak)
      return
    }
    if (subject.trim().length < 3 || description.trim().length < 10) {
      setError('Add a short subject and enough detail for ops to understand what happened.')
      return
    }
    setBusy(true)
    try {
      const result = await invokeAccountFunction<{ ok?: boolean; issueNumber?: number | null }>(
        'account-support-action',
        {
          action: 'submit-support',
          category,
          orderId: orderId || undefined,
          subject: subject.trim(),
          description: description.trim(),
        }
      )
      setSubject('')
      setDescription('')
      setSuccess(
        result.issueNumber
          ? `Support request opened as #${String(result.issueNumber).padStart(4, '0')}.`
          : 'Support request opened for ops review.'
      )
      onRefresh()
    } catch (supportError) {
      setError(
        friendlyActionError(
          supportError,
          `Support could not open from web. Email ${CONTACTS.support} if this keeps happening.`
        )
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Support"
        title="Ask Drapeon for help"
        description="Open a protected support request from web. Attach an order when the issue is about payment, fit, delivery, payout, or production."
      />
      <div className="grid gap-3 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <NativeSelect
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as (typeof SUPPORT_CATEGORIES)[number][0])
            }
          >
            {SUPPORT_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            <option value="">No order attached</option>
            {orderOptions.map((order) => (
              <option key={order.id} value={order.id}>
                {order.reference ?? orderTitle(order)} · {cleanLabel(order.stage)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={120}
          placeholder="Short subject"
        />
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={1500}
          placeholder="Tell us what happened inside Drapeon. Keep phone numbers, emails, and social handles out of the request."
        />
        <Button onClick={submitSupport} disabled={busy}>
          {busy ? 'Opening support...' : 'Open support request'}
        </Button>
      </div>
    </Surface>
  )
}

function SupportIssueForm({
  data,
  onRefresh,
}: {
  data: SupportSurfaceData
  onRefresh: () => void
}) {
  const searchParams = useSearchParams()
  const linkedOrderId = searchParams.get('orderId')
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order))
  const [orderId, setOrderId] = useState(
    linkedOrderId && activeOrders.some((order) => order.id === linkedOrderId)
      ? linkedOrderId
      : (activeOrders[0]?.id ?? '')
  )
  const [issueType, setIssueType] = useState('NEED_DRAPE_HELP')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function reportIssue() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(description, "Support notes can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!orderId || description.trim().length < 10) {
      setError('Choose an order and add a short description.')
      return
    }
    setBusy(true)
    try {
      await invokeAccountFunction('handoff-support-action', {
        action: 'report-issue',
        orderId,
        issueType,
        description: description.trim(),
      })
      setDescription('')
      setSuccess('Handoff issue opened on this order.')
      onRefresh()
    } catch (supportError) {
      setError(
        friendlyActionError(
          supportError,
          'Handoff support is only available once pickup or delivery is in progress. Use email for other issues.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  if (activeOrders.length === 0) return null

  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Protected support"
        title="Open handoff help"
        description="This creates a real order handoff issue when pickup or delivery is active. Use the support request above for payment, fit, account, and payout questions."
      />
      <div className="grid gap-3 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-2">
          <NativeSelect value={orderId} onChange={(event) => setOrderId(event.target.value)}>
            {activeOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.reference ?? orderTitle(order)} · {cleanLabel(order.stage)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={issueType} onChange={(event) => setIssueType(event.target.value)}>
            <option value="AT_PICKUP">At pickup</option>
            <option value="CANT_FIND_LOCATION">Cannot find location</option>
            <option value="COUNTERPART_NOT_RESPONDING">Other party not responding</option>
            <option value="ORDER_NOT_READY">Order not ready</option>
            <option value="COURIER_OR_DELIVERY_ISSUE">Courier or delivery issue</option>
            <option value="NEED_DRAPE_HELP">Need Drapeon help</option>
          </NativeSelect>
        </div>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="Describe what happened inside Drapeon. Do not include phone numbers or handles."
        />
        <Button onClick={reportIssue} disabled={busy}>
          {busy ? 'Opening help...' : 'Open handoff help'}
        </Button>
      </div>
    </Surface>
  )
}

function ProfileSettingsEditor({
  data,
  session,
  onRefresh,
}: {
  data: SettingsRenderData
  session: Session | null
  onRefresh: () => void
}) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const currentDisplayName =
    data.customerProfile?.display_name ||
    data.tailorProfile?.display_name ||
    data.tailorProfile?.business_name ||
    ''
  const currentCurrency = data.accountCurrency || data.tailorProfile?.currency || 'USD'
  const [displayName, setDisplayName] = useState(currentDisplayName)
  const [currency, setCurrency] = useState(currentCurrency)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function saveDisplayName() {
    setError(null)
    setSuccess(null)
    const displayNameError = validateDisplayName(displayName)
    if (displayNameError) {
      setError(displayNameError)
      return
    }
    setBusy('name')
    try {
      await invokeAccountFunction('account-profile-action', {
        action: 'update-display-name',
        role,
        displayName: displayName.trim(),
      })
      setSuccess('Display name updated.')
      onRefresh()
    } catch (nameError) {
      setError(friendlyActionError(nameError, 'Display name could not save. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  async function saveCurrency() {
    setError(null)
    setSuccess(null)
    setBusy('currency')
    try {
      const result = await invokeAccountFunction<{ priceRangeConverted?: boolean }>('account-profile-action', {
        action: 'update-currency',
        role,
        currency,
      })
      setSuccess(result.priceRangeConverted
        ? 'Currency updated. Your public price guide was converted; existing orders, earnings, and payout setup are unchanged.'
        : 'Currency preference updated. Existing orders, earnings, and payout setup are unchanged.')
      onRefresh()
    } catch (currencyError) {
      setError(friendlyActionError(currencyError, 'Currency could not save. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Editable on web"
        title="Profile basics"
        description="Update how your account is identified and which currency drives visible prices."
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your public display name"
            />
          </Field>
          <Button onClick={saveDisplayName} disabled={busy === 'name'}>
            {busy === 'name' ? 'Saving...' : 'Save name'}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Currency">
            <NativeSelect value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button onClick={saveCurrency} disabled={busy === 'currency'}>
            {busy === 'currency' ? 'Saving...' : 'Save currency'}
          </Button>
        </div>
        <p className="text-sm leading-6 text-ink/60">
          Phone changes, OTP, payout setup, and account deletion stay behind the stronger guarded
          flows.
        </p>
      </div>
    </Surface>
  )
}

function PhoneSettingsPanel({
  session,
  role,
  displayName,
  onRefresh,
}: {
  session: Session | null
  role: 'CUSTOMER' | 'TAILOR'
  displayName: string
  onRefresh: () => void
}) {
  const currentPhone = normalizePhoneForStorage(String(session?.user.user_metadata?.phone ?? ''))
  const [phone, setPhone] = useState(currentPhone)
  const [password, setPassword] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const normalizedPhone = normalizePhoneForStorage(phone)
  const changed = normalizedPhone !== currentPhone

  if (!session) return null

  async function savePhone() {
    setError(null)
    setSuccess(null)
    const phoneError = validatePhoneForProfile(normalizedPhone)
    if (phoneError) {
      setError(phoneError)
      return
    }
    if (!changed) {
      setEditing(false)
      return
    }
    if (!password) {
      setError('Enter your current password to confirm this security-sensitive change.')
      return
    }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(password, 'PHONE_CHANGE')
      await invokeAccountFunction('account-profile-action', {
        action: 'update-personal-info',
        role,
        displayName,
        phone: normalizedPhone,
        reauthProof: proof.proof,
      })
      await createClient().auth.refreshSession()
      setPassword('')
      setEditing(false)
      setSuccess('Phone number updated securely.')
      onRefresh()
    } catch (cause) {
      setError(
        friendlyActionError(
          cause,
          'Phone number could not update. Confirm your password and try again.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="grid justify-items-start gap-2 sm:justify-items-end">
        {success ? (
          <p role="status" className="text-xs font-semibold text-needle">
            {success}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(true)
            setError(null)
            setSuccess(null)
          }}
        >
          {currentPhone ? 'Change phone number' : 'Add phone number'} <ChevronRight />
        </Button>
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label="Phone number settings"
      className="grid w-full max-w-md gap-3 text-left"
    >
      <PhoneNumberField
        value={phone}
        onValueChange={setPhone}
        hint={PHONE_STORAGE_HINT}
        error={error}
        onClearError={() => setError(null)}
        aria-label="Account phone number"
      />
      <Input
        type="password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value)
          setError(null)
        }}
        placeholder="Current password"
        autoComplete="current-password"
      />
      <p className="text-xs leading-5 text-ink/52">
        Phone changes require a fresh password check. Drapeon stores the normalized international
        number and never exposes it on your public profile.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            void savePhone()
          }}
          disabled={busy || !changed}
        >
          {busy ? 'Confirming…' : 'Save phone'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setPhone(currentPhone)
            setPassword('')
            setError(null)
            setEditing(false)
          }}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function PasswordChangePanel({ session }: { session: Session | null }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!session) return null
  const sessionEmail = session.user.email

  async function changePassword() {
    setError(null)
    setSuccess(null)
    if (!currentPassword) {
      setError('Enter your current password first.')
      return
    }
    const passwordError = validatePasswordStrength(newPassword, { forbiddenValues: [sessionEmail] })
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'PASSWORD_CHANGE')
      const result = await invokeAccountFunction<{ emailQueued?: boolean }>(
        'account-security-action',
        {
          action: 'change-password',
          reauthProof: proof.proof,
          newPassword,
        }
      )
      setSuccess(
        result.emailQueued
          ? 'Password updated. We sent a security receipt to your email.'
          : 'Password updated. Use it next time you sign in.'
      )
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setShow(false)
    } catch (err) {
      setError(
        friendlyActionError(
          err,
          'Password could not update. Confirm your current password and try again.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  if (!show) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setShow(true)}>
        Change password <ChevronRight />
      </Button>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <Input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (8+ chars)"
        />
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={changePassword} disabled={busy}>
          {busy ? 'Updating...' : 'Update password'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setShow(false)
            setCurrentPassword('')
            setNewPassword('')
            setConfirm('')
            setError(null)
            setSuccess(null)
          }}
        >
          Cancel
        </Button>
        <Button asChild variant="link">
          <Link href="/account/recovery">Forgot current password</Link>
        </Button>
      </div>
    </div>
  )
}

function EmailChangePanel({ session }: { session: Session | null }) {
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const currentEmail = session?.user.email

  if (!session) return null

  async function changeEmail() {
    setError(null)
    setSuccess(null)
    if (!newEmail.trim() || !newEmail.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    if (newEmail.trim().toLowerCase() === currentEmail?.toLowerCase()) {
      setError('That is already your current email.')
      return
    }
    if (!currentPassword) {
      setError('Enter your current password first.')
      return
    }
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'EMAIL_CHANGE')
      const result = await invokeAccountFunction<{
        currentEmailQueued?: boolean
        newEmailQueued?: boolean
      }>('account-security-action', {
        action: 'start-email-change',
        reauthProof: proof.proof,
        newEmail: newEmail.trim(),
      })
      setSuccess(
        result.currentEmailQueued === false || result.newEmailQueued === false
          ? 'Email change started, but one confirmation email may be delayed. Check both inboxes before retrying.'
          : `Confirmation sent to ${newEmail.trim()} and ${currentEmail}. Click both links to complete the change.`
      )
      setNewEmail('')
      setCurrentPassword('')
      setShow(false)
    } catch (err) {
      setError(
        friendlyActionError(
          err,
          'Email could not update. Confirm your current password and try again.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  if (!show) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setShow(true)}>
        Change email <ChevronRight />
      </Button>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <Input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
      />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="New email address"
        />
        <Button onClick={changeEmail} disabled={busy}>
          {busy ? 'Sending...' : 'Send confirmation'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setShow(false)
            setNewEmail('')
            setCurrentPassword('')
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
      <p className="text-xs text-ink/44">
        Drapeon sends confirmation to both addresses. You must click both links.
      </p>
    </div>
  )
}

function SessionPanel({ session }: { session: Session | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const lastSignIn = session?.user.last_sign_in_at

  if (!session) return null

  async function signOutOtherDevices() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const { error: err } = await createClient().auth.signOut({ scope: 'others' })
      if (err) throw err
      setSuccess('All other sessions ended. You remain signed in on this device.')
    } catch (err) {
      setError(friendlyActionError(err, 'Could not sign out other devices. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      {lastSignIn ? (
        <p className="text-xs text-ink/44">Last sign-in: {formatRelative(lastSignIn)}</p>
      ) : null}
      <ActionNotice error={error} success={success} />
      <Button
        variant="outline"
        onClick={signOutOtherDevices}
        disabled={busy}
        className="w-fit border-rust/20 text-rust hover:bg-rust/5"
      >
        {busy ? 'Signing out...' : 'Sign out all other devices'}
      </Button>
    </div>
  )
}

function AccountDeletionPanel({
  session,
  onRefresh,
}: {
  session: Session | null
  onRefresh: () => void
}) {
  type DeletionRequestState = {
    id: string
    status: string
    createdAt: string
    activeOrderCount: number
  }
  const [confirm, setConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [requestState, setRequestState] = useState<DeletionRequestState | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!session) {
        setStatusLoading(false)
        setRequestState(null)
        return
      }
      setStatusLoading(true)
      setStatusError(null)
      void invokeAccountFunction<{ request?: DeletionRequestState | null }>(
        'request-account-deletion',
        { action: 'STATUS' }
      )
        .then((result) => {
          if (!cancelled) setRequestState(result.request ?? null)
        })
        .catch((err) => {
          if (!cancelled)
            setStatusError(
              friendlyActionError(err, 'Could not confirm the current deletion request status.')
            )
        })
        .finally(() => {
          if (!cancelled) setStatusLoading(false)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [session])

  if (!session) return null

  async function requestDeletion() {
    if (confirm.toLowerCase() !== 'delete') {
      setError('Type "delete" exactly to confirm.')
      return
    }
    if (!currentPassword) {
      setError('Enter your current password first.')
      return
    }
    setError(null)
    setSuccess(null)
    setBusy(true)
    try {
      const proof = await issueWebReauthProof(currentPassword, 'ACCOUNT_DELETION')
      const result = await invokeAccountFunction<{
        alreadyPending?: boolean
        activeOrderCount?: number
        deletionPath?: 'OPS_REVIEW_ACTIVE_ORDERS' | 'OPS_REVIEW_STANDARD'
        request?: DeletionRequestState | null
      }>('request-account-deletion', {
        action: 'SUBMIT',
        source: 'WEB_APP',
        confirmationText: 'DELETE',
        reauthProof: proof.proof,
        reason: reason.trim() || undefined,
      })
      setSuccess(
        result.alreadyPending
          ? 'A deletion request is already pending for this account.'
          : result.activeOrderCount && result.activeOrderCount > 0
            ? `Deletion request submitted. Drapeon will resolve ${result.activeOrderCount} active order${result.activeOrderCount === 1 ? '' : 's'} before deletion proceeds.`
            : 'Deletion request submitted. Drapeon will confirm privacy review by email.'
      )
      setConfirm('')
      setCurrentPassword('')
      setReason('')
      setRequestState(result.request ?? null)
      onRefresh()
    } catch (err) {
      setError(
        friendlyActionError(
          err,
          `Deletion request could not submit. Email ${CONTACTS.privacy} directly.`
        )
      )
    } finally {
      setBusy(false)
    }
  }

  if (statusLoading) {
    return <p className="text-sm text-ink/50">Checking for an existing deletion request…</p>
  }

  if (statusError) {
    return (
      <div className="grid gap-3">
        <div className="rounded-2xl border border-rust/20 bg-rust/[0.04] p-5">
          <p className="text-sm font-semibold text-rust">We couldn’t confirm your request status</p>
          <p className="mt-2 text-sm leading-6 text-ink/60">
            Drapeon will not start another deletion request until this check succeeds.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()} className="w-fit">
          Try again
        </Button>
      </div>
    )
  }

  if (requestState) {
    const submittedAt = new Date(requestState.createdAt)
    const submittedLabel = Number.isNaN(submittedAt.getTime())
      ? requestState.createdAt
      : submittedAt.toLocaleString()
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-rust/20 bg-rust/[0.04] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">
            Request received
          </p>
          <h3 className="mt-2 font-display text-xl font-semibold text-ink">
            Your deletion request is in review.
          </h3>
          <p className="mt-2 text-sm leading-6 text-ink/60">
            We’ll send updates by email and in-app notification. You cannot start another request
            while this one is active.
          </p>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink/45">Status</dt>
              <dd className="font-semibold capitalize text-ink">
                {requestState.status.replaceAll('_', ' ').toLowerCase()}
              </dd>
            </div>
            <div>
              <dt className="text-ink/45">Submitted</dt>
              <dd className="font-semibold text-ink">{submittedLabel}</dd>
            </div>
            <div>
              <dt className="text-ink/45">Active orders</dt>
              <dd className="font-semibold text-ink">{requestState.activeOrderCount}</dd>
            </div>
          </dl>
          <p className="mt-4 break-all font-mono text-xs text-ink/40">Request {requestState.id}</p>
        </div>
        <p className="text-xs text-ink/50">
          Need to add context? Email {CONTACTS.privacy} from your account email.
        </p>
        <ActionNotice error={error} success={success} />
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p className="text-xs text-ink/50">
        This starts the guarded account deletion workflow. Active orders, disputes, payouts, or
        legal retention obligations must be resolved first. Type{' '}
        <span className="font-mono font-semibold text-rust">delete</span> and confirm your current
        password.
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Optional note for privacy review"
        className="border-rust/20 focus:border-rust focus:ring-rust/10"
      />
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder='Type "delete" to confirm'
          className="border-rust/20 focus:border-rust focus:ring-rust/10"
        />
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="border-rust/20 focus:border-rust focus:ring-rust/10"
        />
        <Button
          onClick={requestDeletion}
          disabled={busy || confirm.toLowerCase() !== 'delete' || !currentPassword}
          variant="destructive"
        >
          {busy ? 'Submitting...' : 'Request deletion'}
        </Button>
      </div>
      <ActionNotice error={error} success={success} />
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader title={title} />
      <div className="divide-y divide-ui-border">{children}</div>
    </Surface>
  )
}

function SettingsRow({
  label,
  sublabel,
  children,
}: {
  label: string
  sublabel?: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        {sublabel ? <p className="mt-0.5 text-xs text-ink/48">{sublabel}</p> : null}
      </div>
      {children ? <div className="sm:text-right">{children}</div> : null}
    </div>
  )
}

export function RenderSettings({
  data,
  session,
  onRefresh,
}: {
  data: SettingsRenderData
  session: Session | null
  onRefresh: () => void
}) {
  const role = data.tailorProfile ? 'TAILOR' : 'CUSTOMER'
  const metadataDisplayName =
    typeof session?.user.user_metadata?.display_name === 'string'
      ? session.user.user_metadata.display_name
      : typeof session?.user.user_metadata?.full_name === 'string'
        ? session.user.user_metadata.full_name
        : null
  const displayName = safeEntityName(
    data.customerProfile?.display_name ||
      data.tailorProfile?.business_name ||
      data.tailorProfile?.display_name ||
      metadataDisplayName,
    'Drapeon member'
  )
  const currency =
    data.accountCurrency || data.tailorProfile?.currency || data.orderCurrencies[0] || 'USD'

  return (
    <div className="grid gap-5">
      {/* ── Profile ── */}
      <SettingsSection title="Profile">
        <div className="px-5 py-4">
          <AvatarUploadPanel data={data} session={session} onRefresh={onRefresh} />
        </div>
        <div className="px-5 py-4">
          <ProfileSettingsEditor
            key={`${data.customerProfile?.display_name ?? ''}:${data.tailorProfile?.display_name ?? ''}:${data.tailorProfile?.business_name ?? ''}:${data.accountCurrency ?? data.tailorProfile?.currency ?? ''}`}
            data={data}
            session={session}
            onRefresh={onRefresh}
          />
        </div>
        <SettingsRow
          label="Workspace"
          sublabel={
            role === 'TAILOR'
              ? 'Tailor workspace active. Customer tools remain available.'
              : 'Customer account active. Tailor access requires setup.'
          }
        >
          {role === 'TAILOR' ? (
            <Link href="/account/work" className="text-sm font-semibold text-needle">
              Open work queue →
            </Link>
          ) : (
            <Link href="/account/choose-role?next=%2Faccount%2Fprofile%3Fsetup%3D1" className="text-sm font-semibold text-needle">
              Apply as a tailor →
            </Link>
          )}
        </SettingsRow>
      </SettingsSection>

      {/* ── Security ── */}
      <SettingsSection title="Security">
        <SettingsRow
          label="Password"
          sublabel="Change the password used to sign in. You'll need to be signed in to update it."
        >
          <PasswordChangePanel session={session} />
        </SettingsRow>
        <SettingsRow label="Email address" sublabel={session?.user.email ?? 'Email unavailable'}>
          <EmailChangePanel session={session} />
        </SettingsRow>
        <SettingsRow
          label="Phone number"
          sublabel={
            normalizePhoneForStorage(String(session?.user.user_metadata?.phone ?? '')) ||
            'No phone number saved'
          }
        >
          <PhoneSettingsPanel
            session={session}
            role={role}
            displayName={displayName}
            onRefresh={onRefresh}
          />
        </SettingsRow>
        <SettingsRow
          label="Two-factor and OTP"
          sublabel="Phone OTP and SSO reauth are managed through the app or recovery flow."
        >
          <Link href="/account/recovery" className="text-sm font-semibold text-needle">
            Account recovery →
          </Link>
        </SettingsRow>
        <SettingsRow label="Active sessions">
          <SessionPanel session={session} />
        </SettingsRow>
      </SettingsSection>

      {/* ── Preferences ── */}
      <SettingsSection title="Preferences">
        <SettingsRow
          label="Currency"
          sublabel="Used for price display. Checkout still routes by order and provider."
        />
        <div className="px-5 pb-5">
          <CommunicationCenter session={session} />
        </div>
      </SettingsSection>

      {/* ── Account & data ── */}
      <SettingsSection title="Account and data">
        <SettingsRow
          label="Privacy and data"
          sublabel="Measurements, order records, and messages are protected account data. Data access requests go to privacy@."
        >
          <a
            href={`mailto:${CONTACTS.privacy}?subject=Data access request`}
            className="text-sm font-semibold text-needle"
          >
            {CONTACTS.privacy} →
          </a>
        </SettingsRow>
        <SettingsRow
          label="Payout setup"
          sublabel={
            role === 'TAILOR'
              ? 'Stripe Connect and Paystack automated payout routes.'
              : 'Payout setup is for tailor accounts.'
          }
        >
          {role === 'TAILOR' ? (
            <Link href="/account/payout" className="text-sm font-semibold text-needle">
              Payout setup →
            </Link>
          ) : null}
        </SettingsRow>
        <div
          id="delete-account"
          className="scroll-mt-28 border-t border-rust/8 bg-rust/4 px-5 py-4"
        >
          <p className="mb-3 text-sm font-semibold text-rust">Delete account</p>
          <AccountDeletionPanel session={session} onRefresh={onRefresh} />
        </div>
      </SettingsSection>
    </div>
  )
}

export function RenderSupport({ data, onRefresh }: { data: SupportRenderData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const activeOrders = data.orders.filter((order) => !isTerminalOrder(order)).slice(0, 5)

  const issueRoutes: Array<[string, string, string]> = isTailor
    ? [
        ['Payout or earnings issue', CONTACTS.payouts, 'Tailor payout help'],
        ['Order or customer dispute', CONTACTS.support, 'Order dispute help'],
        ['Account or security issue', CONTACTS.security, 'Account security help'],
        ['Platform or listing question', CONTACTS.support, 'Platform help'],
      ]
    : [
        ['Payment issue', CONTACTS.support, 'Payment help'],
        ['Fit issue', CONTACTS.support, 'Fit help'],
        ['Delivery or handoff issue', CONTACTS.support, 'Delivery help'],
        ['Account or security issue', CONTACTS.security, 'Account security help'],
        ['Tailor payout or setup issue', CONTACTS.payouts, 'Tailor payout help'],
      ]

  const tailorFaqItems: Array<[string, string]> = [
    [
      'How do I respond to a custom order brief?',
      'Go to Orders and open the brief. Tap "Send quote" to enter your price, estimated completion date, and a note. You can also request a consultation before quoting. Respond within 48 hours — customers see a response timer on their end.',
    ],
    [
      'How does payout work?',
      'New orders release the protected tailor amount in verified stages: carrier or Drapeon custody, settled delivery, and the final protection window. Local collection uses authenticated handoff stages. Open concerns pause unreleased money, and each eligible amount passes Drapeon review before it reaches your verified Stripe or Paystack account. Your order shows the exact progress.',
    ],
    [
      'Why is my payout showing "blocked"?',
      'Blocked payouts are held pending dispute resolution, identity checks, or a missing reverification step. Go to Payout to check the status. If the block is unclear, email payouts@drapeon.co with your order reference.',
    ],
    [
      'How do I change my availability?',
      'Go to Profile, open Selling setup, and use "Edit setup on web." Availability can be set to Open, Limited, or Fully booked, and changes affect how you appear in customer search.',
    ],
    [
      'How do I mark an order as dispatched?',
      'Open the order in Orders, scroll to the Actions section, and select the dispatch stage. You will need to enter a fulfillment method and optionally a tracking number. Collection and self-delivery orders use different stage flows.',
    ],
    [
      'How do I handle a scope change from a customer?',
      'Customers can request scope changes on active briefs. Go to the order in Orders — an action card will appear asking you to approve or decline the change. You can adjust the price and timeline before accepting.',
    ],
    [
      'Why is my account or listing restricted?',
      'Restrictions are triggered by unresolved disputes, payment failures, or trust review requirements. Open a support request using "Account or security issue" below and ops will review within 1 business day.',
    ],
  ]

  const customerFaqItems: Array<[string, string]> = [
    [
      'How do I cancel an order?',
      'Orders can be cancelled from the order detail page before production begins. Once a tailor has confirmed and started production, cancellation requires ops review. Open a support request with the order attached and select "Payment issue" as the category.',
    ],
    [
      'When will I get my refund?',
      'Refunds are processed within 3–7 business days after an order is cancelled or a dispute is resolved in your favour. Payout timing depends on your bank or card provider. Open a support request if a refund has not appeared after 10 days.',
    ],
    [
      'How do I change my delivery address?',
      'Delivery address changes must happen before a tailor marks the order dispatched. Open the order in Messages and ask the tailor directly, or open a support request so ops can update it.',
    ],
    [
      'My item arrived with a fit issue — what do I do?',
      'Message the tailor through the order thread first. Most fit issues are resolved with a free alteration. If the tailor is unresponsive, open a support request with "Fit or alteration issue" and attach the order. Drapeon ops will step in.',
    ],
    [
      'How do I set up payout as a tailor?',
      'Go to Payout in the account navigation. Stripe Connect handles GBP, USD, EUR, and CAD. Paystack handles NGN, GHS, and KES. Manual bank entry requires ops verification — email payouts@drapeon.co if your bank is not listed.',
    ],
    [
      'Why is my account restricted?',
      'Accounts can be restricted for unresolved disputes, payment failures, or trust review requirements. Open a support request with "Account or security issue" and ops will review within 1 business day.',
    ],
    [
      'How do I update my measurements?',
      'Use Measurements on web to add or edit manual profiles and custom tape points. Drapeon Vision body scans still run in the mobile app.',
    ],
  ]

  const faqItems = isTailor ? tailorFaqItems : customerFaqItems

  return (
    <div className="grid gap-5">
      {/* ── FAQ ── */}
      <Surface className="overflow-hidden">
        <SurfaceHeader
          title="Common questions"
          description="Operational answers for orders, payment, fulfillment, and account access."
        />
        {faqItems.map(([question, answer], index) => (
          <details key={question} className={`group ${index > 0 ? 'border-t border-ink/6' : ''}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
              <span className="text-sm font-semibold text-ink">{question}</span>
              <ChevronDown className="size-4 shrink-0 text-ink/36 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-ink/6 bg-bone/40 px-5 py-4">
              <p className="text-sm leading-6 text-ink/62">{answer}</p>
            </div>
          </details>
        ))}
      </Surface>

      {/* ── Support request form ── */}
      <GeneralSupportForm data={data} onRefresh={onRefresh} />

      {/* ── Handoff help (only when active orders exist) ── */}
      <SupportIssueForm data={data} onRefresh={onRefresh} />

      {/* ── Order-aware help ── */}
      {activeOrders.length > 0 ? (
        <Surface className="overflow-hidden">
          <SurfaceHeader
            title="Your active orders"
            description="Select an order to get help specific to its payment, stage, or delivery."
          />
          {activeOrders.map((order, index) => (
            <div
              key={order.id}
              className={`flex items-center gap-4 px-5 py-4 ${index > 0 ? 'border-t border-ink/6' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <StagePill stage={order.stage} />
                  <span className="text-xs text-ink/46">{partyName(order, data.userId)}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm">
                  <Link href={accountRoute(`/account/orders/${order.id}`)}>View order</Link>
                </Button>
                <Button asChild size="sm">
                  <a
                    href={mailto(
                      CONTACTS.support,
                      `Help with order: ${order.reference ?? order.id}`
                    )}
                  >
                    Email support
                  </a>
                </Button>
                <a
                  href={buildWhatsAppSupportUrl(
                    `Hi Drapeon, I need help with order ${order.reference ?? order.id}.`
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center rounded-[8px] border border-needle/15 bg-white px-3 text-xs font-semibold text-needle"
                >
                  WhatsApp
                </a>
              </div>
            </div>
          ))}
        </Surface>
      ) : null}

      {/* ── Direct contact routes ── */}
      <Surface className="overflow-hidden">
        <SurfaceHeader
          title="Direct contacts"
          description="Route the issue to the right support inbox."
        />
        <a
          href={buildWhatsAppSupportUrl(
            isTailor ? 'Hi Drapeon, I need tailor support.' : 'Hi Drapeon, I need customer support.'
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 px-5 py-4 transition hover:bg-ink/3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">WhatsApp support</p>
            <p className="mt-0.5 text-xs font-semibold text-needle">Message Drapeon directly</p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-ui-subtle" />
        </a>
        {issueRoutes.map(([title, email, subject]) => (
          <a
            key={title}
            href={mailto(email, subject)}
            className="flex items-center gap-4 border-t border-ink/6 px-5 py-4 transition hover:bg-ink/3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-xs font-semibold text-needle">{email}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-ui-subtle" />
          </a>
        ))}
        <div className="border-t border-ink/6 px-5 py-4">
          <p className="text-xs text-ink/44">
            Response within 1 business day for most issues. Active order disputes are reviewed
            within 4 hours.
          </p>
        </div>
      </Surface>
    </div>
  )
}
