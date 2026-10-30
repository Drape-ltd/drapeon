'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Landmark, ShieldCheck, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONTACTS,
  countryFlag,
  formatDatabaseEnumLabel,
  formatDate,
  isLegacyPayoutSetupUnavailable,
  LEGACY_PAYOUT_SETUP_COMING_SOON_COPY,
  type PayoutSetupOption,
  PHONE_COUNTRIES,
  settlementScheduleDisclosure,
} from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { type AccountRouteIdentity, AccountRouteRuntime } from '../account-route-runtime'

type Profile = {
  id: string
  currency: string | null
  payout_currency: string | null
  payout_provider: string | null
  payout_reverification_required: boolean | null
  payout_account_type: string | null
  payout_account_verified: boolean | null
  payout_bank_name: string | null
  payout_account_name: string | null
  payout_account_masked: string | null
  payout_country_code: string | null
  manual_bank_entry: boolean | null
  manual_bank_name: string | null
  manual_bank_verification_status: string | null
  paystack_recipient_code: string | null
  stripe_connect_account_id: string | null
  stripe_payout_destination: {
    countryCode: string
    payoutCurrency: string
    transfersEnabled: boolean
    payoutsEnabled: boolean
    firstWithdrawalReviewStatus: 'PENDING' | 'CLEARED' | 'BLOCKED'
    active: boolean
    capabilityCheckedAt: string | null
  } | null
  bachs_payout_destination: {
    countryCode: string
    payoutCurrency: string
    transfersEnabled: boolean
    payoutsEnabled: boolean
    firstWithdrawalReviewStatus: 'PENDING' | 'CLEARED' | 'BLOCKED'
    active: boolean
    onboardingDueCount: number | null
    onboardingPendingCount: number | null
    onboardingCheckedAt: string | null
  } | null
}
type Pending = {
  id: string
  status: 'PENDING'
  submittedAt: string | null
  confirmationStatus: 'PENDING' | 'CONFIRMED'
  lifecycleState: 'AWAITING_CONFIRMATION' | 'SECURITY_HOLD' | 'OPS_REVIEW'
  confirmationExpiresAt: string | null
  holdUntil: string | null
  requestedDestination: {
    payoutProvider: string | null
    payoutCurrency: string | null
    payoutBankName: string | null
    payoutAccountName: string | null
    payoutAccountMasked: string | null
    payoutAccountVerified: boolean
  } | null
}
type Notice = { tone: 'error' | 'success'; text: string } | null
const input =
  'h-10 w-full rounded-[8px] border border-ui-border bg-white px-3 text-sm outline-none focus:border-needle focus:ring-2 focus:ring-needle/15'
const primary =
  'h-10 rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white disabled:opacity-45'
const secondary =
  'h-10 rounded-[8px] border border-ui-border bg-white px-4 text-sm font-semibold text-ink hover:border-needle/40 disabled:opacity-45'
async function message(error: unknown) {
  try {
    const response = (error as { context?: Response }).context
    const body = response
      ? ((await response.clone().json()) as {
          message?: string
          error?: string
        })
      : null
    return body?.message || body?.error || null
  } catch {
    return null
  }
}
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke('payout-account-action', { body })
  if (error) {
    throw new Error((await message(error)) || 'Payout action could not finish.')
  }
  const payload = (data ?? {}) as Record<string, unknown>
  if (payload.error) throw new Error(String(payload.message || payload.error))
  return payload as T
}
function status(profile: Profile) {
  if (profile.payout_reverification_required) return 'Reverification needed'
  if (profile.stripe_payout_destination) {
    if (profile.stripe_payout_destination.firstWithdrawalReviewStatus === 'PENDING')
      return 'Payout review in progress'
    if (profile.stripe_payout_destination.firstWithdrawalReviewStatus === 'BLOCKED')
      return 'Stripe destination blocked'
    return profile.stripe_payout_destination.active ? 'Ready' : 'Stripe verification needed'
  }
  if (profile.bachs_payout_destination) {
    if (profile.bachs_payout_destination.firstWithdrawalReviewStatus === 'PENDING')
      return 'Bachs first payout review'
    if (profile.bachs_payout_destination.firstWithdrawalReviewStatus === 'BLOCKED')
      return 'Bachs destination blocked'
    return profile.bachs_payout_destination.active ? 'Ready' : 'Bachs verification needed'
  }
  if (profile.payout_account_verified) return 'Ready'
  if (profile.manual_bank_entry) {
    return `Manual bank ${formatDatabaseEnumLabel(
      profile.manual_bank_verification_status,
      'pending review'
    ).toLowerCase()}`
  }
  if (profile.stripe_connect_account_id) return 'Stripe review needed'
  if (profile.paystack_recipient_code) return 'Paystack review needed'
  return 'Setup required'
}
function Section({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow?: string
  title: string
  body?: string
  children: React.ReactNode
}) {
  return (
    <section className="app-surface overflow-hidden">
      <header className="border-b border-ui-border px-5 py-4">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">{eyebrow}</p>
        ) : null}
        <h2 className="mt-1 text-xl font-semibold">{title}</h2>
        {body ? <p className="mt-2 text-sm leading-6 text-ink/58">{body}</p> : null}
      </header>
      {children}
    </section>
  )
}
function Alert({ notice }: { notice: Notice }) {
  return notice ? (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[8px] border p-3 text-sm ${
        notice.tone === 'error'
          ? 'border-rust/20 bg-rust/8 text-rust'
          : 'border-needle/20 bg-needle/8 text-needle'
      }`}
    >
      {notice.text}
    </p>
  ) : null
}

function PayoutContent({ userId, identity }: { userId: string; identity: AccountRouteIdentity }) {
  const router = useRouter()
  const params = useSearchParams()
  const returnHandled = useRef(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [payoutSetupOptions, setPayoutSetupOptions] = useState<PayoutSetupOption[]>([])
  const [payoutSetupOptionsStatus, setPayoutSetupOptionsStatus] = useState<
    'AVAILABLE' | 'NONE' | 'UNAVAILABLE'
  >('UNAVAILABLE')
  const [payoutCurrency, setPayoutCurrency] = useState('USD')
  const [country, setCountry] = useState('US')
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  useEffect(() => {
    let active = true
    if (identity.role !== 'TAILOR') {
      queueMicrotask(() => {
        if (active) setLoadState('ready')
      })
      return
    }
    queueMicrotask(() => {
      if (active) setLoadState('loading')
    })
    const supabase = createClient()
    void supabase
      .from('tailor_profiles')
      .select(
        'id, currency, payout_currency, payout_provider, payout_reverification_required, payout_account_type, payout_account_verified'
      )
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setLoadState(error ? 'error' : 'ready')
          return
        }
        const base = data as Pick<
          Profile,
          | 'id'
          | 'currency'
          | 'payout_currency'
          | 'payout_provider'
          | 'payout_reverification_required'
          | 'payout_account_type'
          | 'payout_account_verified'
        >
        setProfile(
          (current) =>
            current || {
              ...base,
              payout_bank_name: null,
              payout_account_name: null,
              payout_account_masked: null,
              payout_country_code: null,
              manual_bank_entry: null,
              manual_bank_name: null,
              manual_bank_verification_status: null,
              paystack_recipient_code: null,
              stripe_connect_account_id: null,
              stripe_payout_destination: null,
              bachs_payout_destination: null,
            }
        )
        setPayoutCurrency(base.payout_currency || base.currency || 'USD')
        setLoadState('ready')
      })
    void invoke<{
      profile?: {
        id: string
        payoutCurrency?: string | null
        payoutProvider?: string | null
        payoutReverificationRequired?: boolean
        payoutAccountType?: string | null
        payoutAccountVerified?: boolean
        payoutBankName?: string | null
        payoutAccountName?: string | null
        payoutAccountMasked?: string | null
        payoutCountryCode?: string | null
        manualBankEntry?: boolean
        manualBankName?: string | null
        manualBankVerificationStatus?: string | null
        paystackRecipientCode?: string | null
        stripeConnectAccountId?: string | null
        stripePayoutDestination?: Profile['stripe_payout_destination']
        bachsPayoutDestination?: Profile['bachs_payout_destination']
      }
      pendingPayoutChange?: Pending | null
      payoutSetupOptions?: PayoutSetupOption[]
      payoutSetupOptionsStatus?: 'AVAILABLE' | 'NONE' | 'UNAVAILABLE'
    }>({ action: 'get-status' })
      .then((result) => {
        if (!active) return
        const secure = result.profile
        const next: Profile | null = secure
          ? {
              id: secure.id,
              currency: secure.payoutCurrency || null,
              payout_currency: secure.payoutCurrency || null,
              payout_provider: secure.payoutProvider || null,
              payout_reverification_required: secure.payoutReverificationRequired === true,
              payout_account_type: secure.payoutAccountType || null,
              payout_account_verified: secure.payoutAccountVerified === true,
              payout_bank_name: secure.payoutBankName || null,
              payout_account_name: secure.payoutAccountName || null,
              payout_account_masked: secure.payoutAccountMasked || null,
              payout_country_code: secure.payoutCountryCode || null,
              manual_bank_entry: secure.manualBankEntry === true,
              manual_bank_name: secure.manualBankName || null,
              manual_bank_verification_status: secure.manualBankVerificationStatus || null,
              paystack_recipient_code: secure.paystackRecipientCode || null,
              stripe_connect_account_id: secure.stripeConnectAccountId || null,
              stripe_payout_destination: secure.stripePayoutDestination ?? null,
              bachs_payout_destination: secure.bachsPayoutDestination ?? null,
            }
          : null
        setProfile(next)
        setPending(result.pendingPayoutChange || null)
        const setupOptions = result.payoutSetupOptions ?? []
        setPayoutSetupOptions(setupOptions)
        setPayoutSetupOptionsStatus(result.payoutSetupOptionsStatus ?? 'UNAVAILABLE')
        const selected =
          setupOptions.find(
            (option) =>
              option.payoutCurrency === next?.payout_currency &&
              option.tailorCountryCode === next?.payout_country_code?.toUpperCase()
          ) ?? setupOptions[0]
        setPayoutCurrency(selected?.payoutCurrency ?? next?.payout_currency ?? '')
        setCountry(selected?.tailorCountryCode ?? next?.payout_country_code ?? '')
        setSelectedRouteId(selected?.routeId ?? null)
        setLoadState('ready')
      })
      .catch(() => {
        if (active) {
          setNotice({
            tone: 'error',
            text: 'Secure destination details are taking longer to refresh. Your saved destination has not changed.',
          })
        }
      })
    return () => {
      active = false
    }
  }, [identity.role, revision, userId])
  const loadPending = useCallback(async () => {
    try {
      const result = await invoke<{ pendingPayoutChange?: Pending | null }>({
        action: 'get-status',
      })
      setPending(result.pendingPayoutChange || null)
    } catch {
      setNotice({
        tone: 'error',
        text: 'Current payout details remain active, but replacement status could not refresh.',
      })
    }
  }, [])
  useEffect(() => {
    if (profile) {
      queueMicrotask(() => {
        void loadPending()
      })
    }
  }, [loadPending, profile])
  useEffect(() => {
    if (!profile?.id || identity.role !== 'TAILOR') return
    const client = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRevision((value) => value + 1), 180)
    }
    const channel = client
      .channel(`web-payout:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tailor_profiles',
          filter: `id=eq.${profile.id}`,
        },
        refresh
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payout_change_requests',
          filter: `tailor_user_id=eq.${userId}`,
        },
        refresh
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [identity.role, profile?.id, userId])
  const setupOption =
    payoutSetupOptions.find(
      (option) =>
        option.routeId === selectedRouteId &&
        option.payoutCurrency === payoutCurrency &&
        option.tailorCountryCode === country
    ) ?? null
  const legacyPayoutSetupUnavailable = isLegacyPayoutSetupUnavailable({
    currency: payoutCurrency,
    countryCode: country,
  })
  const stripe = setupOption?.provider === 'STRIPE'
  const refreshStripe = useCallback(
    async (fromReturn = false) => {
      setBusy('refresh-stripe')
      setNotice(null)
      try {
        const result = await invoke<{
          pendingReview?: boolean
          firstReleaseReviewPending?: boolean
          confirmationRequired?: boolean
          account?: { payoutAccountVerified?: boolean } | null
        }>({ action: 'refresh-stripe-connect-status' })
        await loadPending()
        setRevision((v) => v + 1)
        setNotice({
          tone: 'success',
          text: result.confirmationRequired
            ? 'Replacement verified. Confirm it below; your current destination remains active until then.'
            : result.firstReleaseReviewPending
              ? 'Payout review in progress. You can take paid orders once this review clears.'
              : result.pendingReview
                ? 'Stripe still needs more information.'
                : result.account?.payoutAccountVerified
                  ? 'Stripe payout account verified and active.'
                  : 'Stripe status refreshed.',
        })
      } catch (cause) {
        setNotice({
          tone: 'error',
          text: cause instanceof Error ? cause.message : 'Stripe status could not refresh.',
        })
      } finally {
        setBusy(null)
        if (fromReturn) router.replace('/account/payout', { scroll: false })
      }
    },
    [loadPending, router]
  )
  const setup = params.get('setup')
  const returnedRouteId = params.get('routeId')
  useEffect(() => {
    if (!profile || returnHandled.current || (setup !== 'complete' && setup !== 'refresh')) return
    returnHandled.current = true
    void refreshStripe(true)
  }, [profile, refreshStripe, setup])
  async function startStripe() {
    if (!setupOption) {
      setNotice({
        tone: 'error',
        text: 'Payout setup is not available for this country and currency yet.',
      })
      return
    }
    setBusy('stripe')
    setNotice(null)
    try {
      const origin = window.location.origin
      const result = await invoke<{ onboarding?: { url?: string | null } }>({
        action: 'start-stripe-connect',
        payoutCurrency,
        countryCode: country,
        returnUrl: `${origin}/account/payout?setup=complete`,
        refreshUrl: `${origin}/account/payout?setup=refresh`,
      })
      if (result.onboarding?.url) {
        window.location.assign(result.onboarding.url)
        return
      }
      setNotice({ tone: 'success', text: 'Stripe onboarding started.' })
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Stripe onboarding could not start.',
      })
    } finally {
      setBusy(null)
    }
  }
  async function startBachs() {
    if (!setupOption?.routeId) {
      setNotice({
        tone: 'error',
        text: 'Bachs payout setup is not available for this route yet.',
      })
      return
    }
    setBusy('bachs')
    setNotice(null)
    try {
      const origin = window.location.origin
      const routeQuery = encodeURIComponent(setupOption.routeId)
      const result = await invoke<{
        onboarding?: { url?: string | null }
        pendingReview?: boolean
      }>({
        action: 'start-bachs-connect',
        routeId: setupOption.routeId,
        returnUrl: `${origin}/account/payout?setup=bachs-return&routeId=${routeQuery}`,
        refreshUrl: `${origin}/account/payout?setup=bachs-refresh&routeId=${routeQuery}`,
      })
      if (result.onboarding?.url) {
        window.location.assign(result.onboarding.url)
        return
      }
      setNotice({
        tone: 'success',
        text: result.pendingReview
          ? 'Bachs setup is being checked. Please refresh status shortly.'
          : 'Bachs onboarding is ready.',
      })
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Bachs onboarding could not start.',
      })
    } finally {
      setBusy(null)
    }
  }
  const refreshBachs = useCallback(
    async (routeId: string, fromReturn = false) => {
      setBusy('refresh-bachs')
      setNotice(null)
      try {
        const result = await invoke<{
          pendingReview?: boolean
          account?: {
            destinationActive?: boolean
            firstWithdrawalReviewStatus?: string
          } | null
        }>({ action: 'refresh-bachs-connect-status', routeId })
        await loadPending()
        setRevision((value) => value + 1)
        setNotice({
          tone: 'success',
          text: result.pendingReview
            ? 'Bachs is still reviewing account details.'
            : result.account?.destinationActive
              ? 'Bachs account is connected. Drapeon will review the first payout release before it is sent.'
              : 'Bachs status refreshed. Finish any remaining verification with Bachs.',
        })
      } catch (cause) {
        setNotice({
          tone: 'error',
          text: cause instanceof Error ? cause.message : 'Bachs status could not refresh.',
        })
      } finally {
        setBusy(null)
        if (fromReturn) router.replace('/account/payout', { scroll: false })
      }
    },
    [loadPending, router]
  )
  useEffect(() => {
    if (
      !profile ||
      returnHandled.current ||
      (setup !== 'bachs-return' && setup !== 'bachs-refresh') ||
      !returnedRouteId
    )
      return
    returnHandled.current = true
    void refreshBachs(returnedRouteId, true)
  }, [profile, refreshBachs, returnedRouteId, setup])
  async function decide(action: 'confirm-payout-change' | 'cancel-payout-change') {
    if (!pending) return
    setBusy(action)
    setNotice(null)
    try {
      const result = await invoke<{ lifecycleState?: 'ACTIVATED' | 'OPS_REVIEW' }>({
        action,
        requestId: pending.id,
      })
      setNotice({
        tone: 'success',
        text:
          action === 'cancel-payout-change'
            ? 'Payout change cancelled. Your current destination was not changed.'
            : result.lifecycleState === 'ACTIVATED'
              ? 'New payout destination is active.'
              : 'Review started. Your current destination remains active.',
      })
      await loadPending()
      setRevision((v) => v + 1)
    } catch (cause) {
      setNotice({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Payout change could not finish.',
      })
    } finally {
      setBusy(null)
    }
  }
  if (loadState === 'loading') {
    return (
      <section className="app-surface p-6" aria-busy="true">
        Loading payout setup…
      </section>
    )
  }
  if (loadState === 'error') {
    return (
      <section className="app-surface p-6" role="alert">
        <h2 className="text-xl font-semibold">Payout setup unavailable</h2>
        <p className="mt-2 text-sm text-ink/58">Your saved destination has not changed.</p>
        <button className={`${primary} mt-4`} onClick={() => setRevision((v) => v + 1)}>
          Try again
        </button>
      </section>
    )
  }
  if (!profile) {
    return (
      <section className="app-surface p-6">
        <h2 className="text-xl font-semibold">Payout setup needs a tailor profile.</h2>
        <p className="mt-2 text-sm text-ink/58">
          Customer accounts do not receive tailor earnings.
        </p>
        <Link
          href="/account/profile?setup=1"
          className="mt-4 inline-flex text-sm font-semibold text-needle"
        >
          Set up a tailor profile
        </Link>
      </section>
    )
  }
  return (
    <div className="grid gap-5 pb-10">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Status', status(profile)],
          [
            'Provider',
            profile.bachs_payout_destination
              ? 'Bachs'
              : formatDatabaseEnumLabel(
                  profile.payout_provider || profile.payout_account_type,
                  'Not set'
                ),
          ],
          [
            'Currency',
            profile.bachs_payout_destination?.payoutCurrency ||
              profile.payout_currency ||
              'Not set',
          ],
          [
            'Release',
            (profile.bachs_payout_destination?.active ||
              profile.stripe_payout_destination?.active ||
              (!profile.bachs_payout_destination &&
                !profile.stripe_payout_destination &&
                profile.payout_account_verified)) &&
            !profile.payout_reverification_required
              ? 'Ready when eligible'
              : 'Verification needed',
          ],
        ].map(([label, value]) => (
          <div key={label} className="app-surface p-4">
            <WalletCards className="size-4 text-needle" />
            <p className="mt-3 text-xs text-ink/48">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </section>
      {profile.stripe_payout_destination?.firstWithdrawalReviewStatus === 'PENDING' ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Payout review in progress.</span> You can take paid orders
          once this review clears.
        </p>
      ) : null}
      <Alert notice={notice} />
      <Section
        eyebrow="Current destination"
        title="Where earnings are sent"
        body="The active verified destination stays in place until a replacement is confirmed and approved."
      >
        <dl className="divide-y divide-ui-border px-5">
          {[
            ['Bank', profile.payout_bank_name || profile.manual_bank_name || 'Not set'],
            ['Account', profile.payout_account_masked || 'Not set'],
            ['Account name', profile.payout_account_name || 'Not set'],
            ...(profile.paystack_recipient_code
              ? [['Legacy Paystack recipient', 'Saved for existing orders']]
              : []),
            ['Stripe Connect', profile.stripe_connect_account_id ? 'Connected' : 'Not started'],
            [
              'Bachs connected account',
              profile.bachs_payout_destination
                ? `${profile.bachs_payout_destination.countryCode} · ${profile.bachs_payout_destination.onboardingDueCount ? 'action needed in Bachs' : profile.bachs_payout_destination.onboardingPendingCount ? 'Bachs review in progress' : profile.bachs_payout_destination.transfersEnabled && profile.bachs_payout_destination.payoutsEnabled ? 'capabilities ready' : 'verification needed'}`
                : 'Not started',
            ],
            [
              'Manual bank',
              profile.manual_bank_entry
                ? formatDatabaseEnumLabel(profile.manual_bank_verification_status, 'Pending review')
                : 'Not used',
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-3">
              <dt className="text-xs font-semibold text-ink/45">{label}</dt>
              <dd className="text-right text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {pending?.requestedDestination ? (
        <Section
          eyebrow={
            pending.lifecycleState === 'AWAITING_CONFIRMATION'
              ? 'Confirmation required'
              : pending.lifecycleState === 'SECURITY_HOLD'
                ? 'Activating replacement'
                : 'Drapeon review'
          }
          title={
            pending.lifecycleState === 'AWAITING_CONFIRMATION'
              ? 'Confirm this payout change'
              : 'Your current destination stays active'
          }
          body={
            pending.lifecycleState === 'AWAITING_CONFIRMATION'
              ? 'Review and confirm within 48 hours. Nothing changes until you confirm.'
              : 'Drapeon is checking the replacement and will record the terminal outcome.'
          }
        >
          <dl className="divide-y divide-ui-border px-5">
            {[
              [
                'Provider',
                formatDatabaseEnumLabel(
                  pending.requestedDestination.payoutProvider,
                  'Not recorded'
                ),
              ],
              ['Currency', pending.requestedDestination.payoutCurrency || 'Not recorded'],
              ['Bank', pending.requestedDestination.payoutBankName || 'Not recorded'],
              ['Account name', pending.requestedDestination.payoutAccountName || 'Not recorded'],
              ['Account', pending.requestedDestination.payoutAccountMasked || 'Not recorded'],
              [
                'Provider check',
                pending.requestedDestination.payoutAccountVerified ? 'Verified' : 'Incomplete',
              ],
              ['Submitted', formatDate(pending.submittedAt, { fallback: 'Recorded' })],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-3">
                <dt className="text-xs font-semibold text-ink/45">{label}</dt>
                <dd className="text-right text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {pending.lifecycleState === 'AWAITING_CONFIRMATION' ? (
            <div className="flex flex-wrap gap-3 border-t border-ui-border p-5">
              <button
                className={primary}
                disabled={busy !== null}
                onClick={() => void decide('confirm-payout-change')}
              >
                {busy === 'confirm-payout-change' ? 'Confirming…' : 'Confirm this change'}
              </button>
              <button
                className={secondary}
                disabled={busy !== null}
                onClick={() => void decide('cancel-payout-change')}
              >
                Cancel request
              </button>
            </div>
          ) : null}
        </Section>
      ) : null}
      <Section
        eyebrow="Provider setup"
        title="Use an automated payout route"
        body="Available payout country and currency pairs come from Drapeon’s configured routes. Existing orders and earnings are not affected."
      >
        <div className="grid gap-5 p-5">
          <p className="rounded-[8px] border border-ui-border bg-bone/35 p-4 text-sm leading-6 text-ink/70">
            <span className="font-semibold text-ink">When earnings are released.</span>
            {settlementScheduleDisclosure()}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">
              Payout route
              <select
                className={input}
                value={
                  setupOption
                    ? `${setupOption.tailorCountryCode}:${setupOption.payoutCurrency}:${
                        setupOption.routeId ?? setupOption.provider
                      }`
                    : ''
                }
                disabled={!payoutSetupOptions.length}
                onChange={(e) => {
                  const next = payoutSetupOptions.find(
                    (option) =>
                      `${option.tailorCountryCode}:${option.payoutCurrency}:${
                        option.routeId ?? option.provider
                      }` === e.target.value
                  )
                  if (!next) return
                  setPayoutCurrency(next.payoutCurrency)
                  setCountry(next.tailorCountryCode)
                  setSelectedRouteId(next.routeId ?? null)
                }}
              >
                {!setupOption ? (
                  <option value="">
                    {payoutSetupOptions.length
                      ? 'Choose a configured route'
                      : 'No configured routes'}
                  </option>
                ) : null}
                {payoutSetupOptions.map((option) => (
                  <option
                    key={`${option.tailorCountryCode}:${option.payoutCurrency}:${
                      option.routeId ?? option.provider
                    }`}
                    value={`${option.tailorCountryCode}:${option.payoutCurrency}:${
                      option.routeId ?? option.provider
                    }`}
                  >
                    {countryFlag(option.tailorCountryCode)}{' '}
                    {PHONE_COUNTRIES.find((item) => item.code === option.tailorCountryCode)?.name ??
                      option.tailorCountryCode}{' '}
                    · {option.payoutCurrency} · {option.provider === 'BACHS' ? 'Bachs' : 'Stripe'}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              {setupOption?.provider === 'BACHS' ? (
                <button
                  className={`${primary} w-full`}
                  disabled={busy !== null || !setupOption.routeId}
                  onClick={() => void startBachs()}
                >
                  {busy === 'bachs' ? 'Opening Bachs…' : 'Continue to Bachs'}
                </button>
              ) : stripe ? (
                <button
                  className={`${primary} w-full`}
                  disabled={busy !== null || !setupOption}
                  onClick={() => void startStripe()}
                >
                  {busy === 'stripe' ? 'Opening Stripe…' : 'Start Stripe Connect'}
                </button>
              ) : (
                <button className={`${secondary} w-full`} disabled>
                  Payout setup is coming soon
                </button>
              )}
            </div>
          </div>
          {payoutSetupOptionsStatus === 'NONE' || payoutSetupOptionsStatus === 'UNAVAILABLE' ? (
            <p
              role="status"
              className="rounded-[8px] border border-needle/20 bg-needle/8 p-4 text-sm leading-6 text-ink/70"
            >
              {payoutSetupOptionsStatus === 'NONE'
                ? legacyPayoutSetupUnavailable
                  ? LEGACY_PAYOUT_SETUP_COMING_SOON_COPY
                  : 'No payout route is currently available for setup. Existing orders and earnings are not affected.'
                : 'Payout routes could not be loaded right now. Try again later; no payout details were changed.'}
            </p>
          ) : null}
          {setupOption?.provider === 'BACHS' ? (
            <div className="rounded-[8px] border border-needle/20 bg-needle/8 p-4 text-sm leading-6 text-ink/70">
              <p className="font-semibold text-ink">Bachs payout setup</p>
              <p className="mt-1">
                Bachs securely collects your account and verification details. Drapeon stores your
                payout destination status, not identity documents. Before your first transfer,
                Drapeon reviews the payout release; this does not delay withdrawals after funds
                reach your Bachs balance.
              </p>
            </div>
          ) : stripe ? (
            <div className="rounded-[8px] border border-needle/20 bg-needle/8 p-4 text-sm leading-6 text-ink/70">
              <p className="font-semibold text-ink">Before choosing Stripe</p>
              <p className="mt-1">
                Choosing {payoutCurrency} does not create a foreign bank account or change your
                business country. Continue only if Stripe supports your country and you can verify
                an eligible bank account. Existing orders and earnings keep their original currency.
              </p>
            </div>
          ) : null}
          {profile.stripe_connect_account_id ? (
            <button
              className={`${secondary} w-fit`}
              disabled={busy !== null}
              onClick={() => void refreshStripe()}
            >
              {busy === 'refresh-stripe' ? 'Refreshing…' : 'Refresh Stripe status'}
            </button>
          ) : null}
          {setupOption?.provider === 'BACHS' && setupOption.routeId ? (
            <button
              className={`${secondary} w-fit`}
              disabled={busy !== null}
              onClick={() => void refreshBachs(setupOption.routeId!)}
            >
              {busy === 'refresh-bachs' ? 'Refreshing…' : 'Refresh Bachs status'}
            </button>
          ) : null}
        </div>
      </Section>
      <Section
        eyebrow="Manual bank entry"
        title="Unsupported bank? Contact payout support"
        body="Manual bank details need a controlled review and recorded payout path before they can be used."
      >
        <div className="p-5">
          <a
            href={`mailto:${CONTACTS.payouts}?subject=Manual payout setup question`}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-rust/20 px-4 text-sm font-semibold text-rust"
          >
            <Landmark className="size-4" />
            Contact payouts
          </a>
        </div>
      </Section>
      <p className="flex items-center gap-2 text-xs text-ink/45">
        <ShieldCheck className="size-4 text-needle" />
        Drapeon stores provider references and status, not online-banking credentials.
      </p>
    </div>
  )
}
export function PayoutWorkspace() {
  return (
    <AccountRouteRuntime surface="payout">
      {({ session, identity }) => <PayoutContent userId={session.user.id} identity={identity} />}
    </AccountRouteRuntime>
  )
}
