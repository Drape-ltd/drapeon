'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { MoneyInput } from '../../../components/money-input'
import { friendlyActionError } from '@drape/shared/action-errors'
import { normalizeAccountCurrency, formatMoney, MATERIAL_ADVANCE_DECLINE_REASONS, MATERIAL_ADVANCE_DECLINE_REASON_LABELS, materialAdvanceDeclineReasonLabel, materialReconciliationCopy, MaterialAdvanceDeclineReason, AccountCurrencyCode } from '@drape/shared'
import { isVideoMediaUrl } from '@drape/shared/media-policy'
import { createClient } from '../../../lib/supabase'
import { safeUserText } from '../../../lib/safe-display'
import type { AccountOrder, MaterialAdvance, OrderDetailRenderData } from '../shared/account-data-contracts'
import { invokeAccountFunction } from '../shared/account-data-queries'
import { ActionNotice, assertNoContactLeak, parseMinorUnits, uploadPrivateFile } from '../messages/account-messages-surface'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface } from '../../../components/ui/surface'
import { prepareOrderEvidenceFile } from './account-order-actions'

type StripeCardElement = {
  mount: (element: HTMLElement) => void
  unmount: () => void
  destroy?: () => void
}

type StripeElements = {
  create: (type: 'card', options?: Record<string, unknown>) => StripeCardElement
}

type StripePaymentIntent = {
  id?: string
  status?: string
}

export type StripeJs = {
  elements: (options?: Record<string, unknown>) => StripeElements
  confirmCardPayment: (
    clientSecret: string,
    options: { payment_method: { card: StripeCardElement } }
  ) => Promise<{ error?: { message?: string }; paymentIntent?: StripePaymentIntent }>
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs | null
  }
}

let stripeScriptPromise: Promise<void> | null = null

function stripePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ??
    ''
  ).trim()
}

function loadStripeScript() {
  if (typeof window === 'undefined')
    return Promise.reject(new Error('Stripe checkout needs a browser.'))
  if (window.Stripe) return Promise.resolve()
  if (!stripeScriptPromise) {
    stripeScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://js.stripe.com/v3/"]'
      )
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Stripe could not load.')), {
          once: true,
        })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Stripe could not load.'))
      document.head.appendChild(script)
    })
  }
  return stripeScriptPromise
}

export function StripeCardAuthorization({
  clientSecret,
  label,
  submitLabel,
  onConfirm,
  onDone,
}: {
  clientSecret: string
  label: string
  submitLabel: string
  onConfirm: (paymentIntentId: string) => Promise<void>
  onDone: () => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stripeRef = useRef<StripeJs | null>(null)
  const cardRef = useRef<StripeCardElement | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let mountedCard: StripeCardElement | null = null

    async function mountCard() {
      setReady(false)
      setError(null)
      const publishableKey = stripePublishableKey()
      if (!publishableKey) {
        setError('Stripe web checkout needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.')
        return
      }
      try {
        await loadStripeScript()
        if (!active || !window.Stripe || !mountRef.current) return
        const stripe = window.Stripe(publishableKey)
        if (!stripe) {
          setError('Stripe checkout could not initialize.')
          return
        }
        const elements = stripe.elements()
        const card = elements.create('card', {
          hidePostalCode: true,
          style: {
            base: {
              color: '#1d1d1b',
              fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              fontSize: '16px',
              '::placeholder': { color: '#8b8a83' },
            },
            invalid: { color: '#d9542f' },
          },
        })
        card.mount(mountRef.current)
        stripeRef.current = stripe
        cardRef.current = card
        mountedCard = card
        if (active) setReady(true)
      } catch (mountError) {
        if (active) setError(friendlyActionError(mountError, 'Stripe checkout could not load.'))
      }
    }

    void mountCard()

    return () => {
      active = false
      setReady(false)
      mountedCard?.unmount()
      mountedCard?.destroy?.()
      if (cardRef.current === mountedCard) cardRef.current = null
      stripeRef.current = null
    }
  }, [clientSecret])

  async function confirmCard() {
    setError(null)
    setSuccess(null)
    const stripe = stripeRef.current
    const card = cardRef.current
    if (!stripe || !card) {
      setError('Stripe checkout is still loading.')
      return
    }
    setBusy(true)
    try {
      const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } })
      if (result.error) {
        setError(
          result.error.message ?? 'Card authorization failed. Check the card details and try again.'
        )
        return
      }
      const paymentIntentId = result.paymentIntent?.id
      if (!paymentIntentId) {
        setError('Stripe authorized the card but did not return a payment reference.')
        return
      }
      await onConfirm(paymentIntentId)
      setSuccess('Payment confirmed. The order record is updating now.')
      onDone()
    } catch (confirmError) {
      setError(
        friendlyActionError(
          confirmError,
          'Payment could not be confirmed. Refresh the order before trying again.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/72">
          Stripe card
        </p>
        <h3 className="mt-1 text-xl font-semibold text-ink">{label}</h3>
      </div>
      <div
        ref={mountRef}
        className="min-h-12 rounded-full border border-ink/10 bg-bone px-4 py-3"
      />
      <ActionNotice error={error} success={success} />
      <button
        type="button"
        onClick={confirmCard}
        disabled={busy || !ready}
        className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
      >
        {busy ? 'Confirming...' : ready ? submitLabel : 'Loading Stripe...'}
      </button>
      <p className="text-xs leading-5 text-ink/52">
        Card details are handled by Stripe. Drapeon never sees or stores the card number.
      </p>
    </div>
  )
}

export function MaterialAdvancePanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'materialAdvances' | 'userId'>
  onRefresh: () => void
}) {
  const searchParams = useSearchParams()
  const advances = data.materialAdvances.filter((advance) => advance.order_id === order.id)
  const focusedAdvanceId = searchParams.get('advanceId')?.trim() || null
  const focusedAdvanceRef = useRef<string | null>(null)
  const isTailor = order.tailor_id === data.userId
  const isCustomer = order.customer_id === data.userId
  const hasActiveAdvance = advances.some(
    (advance) =>
      ['REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW', 'BLOCKED'].includes(
        advance.status ?? ''
      ) ||
      (advance.status === 'RELEASED' && !advance.reconciled_at) ||
      advance.reconciliation_status === 'OPS_REVIEW'
  )
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [estimateFile, setEstimateFile] = useState<File | null>(null)
  const [currency, setCurrency] = useState<AccountCurrencyCode>(
    normalizeAccountCurrency(order.currency ?? order.quoted_currency) ?? 'USD'
  )
  const [responseNote, setResponseNote] = useState('')
  const [decliningAdvanceId, setDecliningAdvanceId] = useState<string | null>(null)
  const [declineReason, setDeclineReason] =
    useState<MaterialAdvanceDeclineReason>('FIND_CHEAPER_OPTION')
  const [receiptNote, setReceiptNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [acquiredFile, setAcquiredFile] = useState<File | null>(null)
  const [actualSpent, setActualSpent] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [stripeAdvancePayment, setStripeAdvancePayment] = useState<{
    advanceId: string
    clientSecret: string
    amount?: number | null
    currency?: string | null
  } | null>(null)
  const [evidencePreview, setEvidencePreview] = useState<{
    url: string
    label: string
    video: boolean
  } | null>(null)
  const [fabricAllowanceRemaining, setFabricAllowanceRemaining] = useState<number | null>(null)
  const fundedFabric = order.fabric_funding_policy_version === 'fabric-funding-2026-08-01-v1'

  useEffect(() => {
    if (!fundedFabric) return
    void createClient()
      .from('order_fabric_funding_allocations')
      .select('funded_amount,released_amount,refunded_amount')
      .eq('order_id', order.id)
      .maybeSingle()
      .then(({ data: allocation }) => {
        setFabricAllowanceRemaining(
          allocation
            ? Math.max(
                (allocation.funded_amount ?? 0) -
                  (allocation.released_amount ?? 0) -
                  (allocation.refunded_amount ?? 0),
                0
              )
            : null
        )
      })
  }, [fundedFabric, order.id])

  useEffect(() => {
    if (
      !focusedAdvanceId ||
      focusedAdvanceRef.current === focusedAdvanceId ||
      !advances.some((advance) => advance.id === focusedAdvanceId)
    )
      return
    focusedAdvanceRef.current = focusedAdvanceId
    requestAnimationFrame(() => {
      const target = document.getElementById(`material-advance-${focusedAdvanceId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
  }, [advances, focusedAdvanceId])

  async function requestAdvance() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(
      [title, description].join('\n'),
      "Material advance requests can't include contact details."
    )
    const parsedAmount = parseMinorUnits(amount)
    if (leak) {
      setError(leak)
      return
    }
    if (!title.trim() || description.trim().length < 10 || !parsedAmount || !estimateFile) {
      setError('Add a title, clear reason, valid amount, and supplier estimate or photo.')
      return
    }
    setBusy('request')
    try {
      const estimatePath = await uploadPrivateFile(
        'commercial-evidence',
        `${order.id}/materials`,
        await prepareOrderEvidenceFile(estimateFile)
      )
      const needsAdjustment =
        fundedFabric && fabricAllowanceRemaining != null && parsedAmount > fabricAllowanceRemaining
      await invokeAccountFunction(
        needsAdjustment ? 'commercial-adjustment-action' : 'material-advance-action',
        {
          action: needsAdjustment ? 'propose-fabric-funding-change' : 'request-advance',
          orderId: order.id,
          title: title.trim(),
          description: description.trim(),
          ...(needsAdjustment
            ? { requestedReleaseAmount: parsedAmount }
            : { amount: parsedAmount }),
          currency,
          estimateStorageBucket: 'commercial-evidence',
          estimateStoragePath: estimatePath,
          ...(needsAdjustment
            ? {
                idempotencyKey: `web:fabric-adjustment:${order.id}:${estimatePath}:${parsedAmount}`,
              }
            : {}),
        }
      )
      setTitle('')
      setDescription('')
      setAmount('')
      setEstimateFile(null)
      setSuccess(
        needsAdjustment
          ? 'The fabric shortfall was sent as a recorded order change. No release exists until the customer accepts and the additional payment is confirmed.'
          : fundedFabric
            ? 'Fabric release sent to the customer for approval. This does not charge them again.'
            : 'Material advance sent to the customer for approval.'
      )
      onRefresh()
    } catch (advanceError) {
      setError(
        friendlyActionError(
          advanceError,
          'Material advance could not be requested. Check payment state and amount limits.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function respondAdvance(advance: MaterialAdvance, decision: 'APPROVE' | 'DECLINE') {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(
      responseNote,
      "Material advance responses can't include contact details."
    )
    if (leak) {
      setError(leak)
      return
    }
    if (decision === 'DECLINE' && declineReason === 'OTHER' && responseNote.trim().length < 5) {
      setError('Add a short explanation when choosing Something else.')
      return
    }
    setBusy(`${decision}:${advance.id}`)
    try {
      await invokeAccountFunction('material-advance-action', {
        action: 'respond-advance',
        advanceId: advance.id,
        decision,
        declineReason: decision === 'DECLINE' ? declineReason : undefined,
        note: responseNote.trim() || undefined,
      })
      setResponseNote('')
      setDecliningAdvanceId(null)
      setDeclineReason('FIND_CHEAPER_OPTION')
      setSuccess(
        decision === 'APPROVE'
          ? advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE'
            ? 'Fabric release approved from the allowance already paid at checkout. Money Desk review is next; there is no second charge.'
            : 'Material advance approved. Payment is now available.'
          : 'Material advance declined.'
      )
      onRefresh()
    } catch (responseError) {
      setError(
        friendlyActionError(
          responseError,
          'Material advance response could not save. Refresh and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function payAdvance(advance: MaterialAdvance) {
    setError(null)
    setSuccess(null)
    setStripeAdvancePayment(null)
    setBusy(`pay:${advance.id}`)
    try {
      const result = await invokeAccountFunction<{
        authorizationUrl?: string | null
        clientSecret?: string | null
        provider?: string | null
        amount?: number | null
        currency?: string | null
      }>('material-advance-action', {
        action: 'prepare-payment',
        advanceId: advance.id,
      })
      onRefresh()
      if (result.authorizationUrl) {
        setSuccess('Opening secure material advance checkout.')
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.clientSecret) {
        setStripeAdvancePayment({
          advanceId: advance.id,
          clientSecret: result.clientSecret,
          amount: result.amount ?? advance.amount,
          currency: result.currency ?? advance.currency,
        })
        setSuccess('Material advance card payment is ready. Enter card details below.')
        return
      }
      setSuccess('Material advance payment is processing. Do not start a duplicate payment.')
    } catch (paymentError) {
      setError(friendlyActionError(paymentError, 'Material advance payment could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function uploadReceipt(advance: MaterialAdvance) {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(receiptNote, "Receipt notes can't include contact details.")
    if (leak) {
      setError(leak)
      return
    }
    if (!receiptFile) {
      setError('Choose receipt or supplier proof first.')
      return
    }
    if (advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' && !acquiredFile) {
      setError('Add a separate photo of the exact approved fabric now in hand.')
      return
    }
    const parsedActualSpent = parseMinorUnits(actualSpent)
    if (!parsedActualSpent) {
      setError('Enter the exact amount shown on the final receipt.')
      return
    }
    setBusy(`receipt:${advance.id}`)
    try {
      const receiptPath = await uploadPrivateFile(
        'commercial-evidence',
        `${order.id}/materials`,
        await prepareOrderEvidenceFile(receiptFile)
      )
      const acquiredPath = acquiredFile
        ? await uploadPrivateFile(
            'commercial-evidence',
            `${order.id}/materials-acquired`,
            await prepareOrderEvidenceFile(acquiredFile)
          )
        : null
      await invokeAccountFunction('material-advance-action', {
        action: 'upload-receipt',
        advanceId: advance.id,
        receiptStorageBucket: 'commercial-evidence',
        receiptStoragePath: receiptPath,
        ...(acquiredPath
          ? { acquiredStorageBucket: 'commercial-evidence', acquiredStoragePath: acquiredPath }
          : {}),
        actualSpentAmount: parsedActualSpent,
        note: receiptNote.trim() || undefined,
      })
      setReceiptFile(null)
      setAcquiredFile(null)
      setReceiptNote('')
      setActualSpent('')
      setSuccess(
        parsedActualSpent === advance.amount
          ? 'Receipt reconciled. The final cost matches the approved advance.'
          : 'Receipt saved. Drapeon Ops will review the unused balance or overage.'
      )
      onRefresh()
    } catch (receiptError) {
      setError(
        friendlyActionError(
          receiptError,
          'Receipt proof could not upload. Try again with a clear photo or MP4/MOV video up to 60 seconds.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function openEvidence(advance: MaterialAdvance, kind: 'estimate' | 'receipt' | 'acquired') {
    setError(null)
    const bucket =
      kind === 'estimate'
        ? advance.estimate_storage_bucket
        : kind === 'receipt'
          ? advance.receipt_storage_bucket
          : advance.acquired_storage_bucket
    const path =
      kind === 'estimate'
        ? advance.estimate_storage_path
        : kind === 'receipt'
          ? advance.receipt_storage_path
          : advance.acquired_storage_path
    if (!bucket || !path) return setError('This protected evidence is not available yet.')
    const { data: signed, error: signedError } = await createClient()
      .storage.from(bucket)
      .createSignedUrl(path, 10 * 60)
    if (signedError || !signed?.signedUrl)
      return setError('Protected evidence could not open. Refresh and try again.')
    setEvidencePreview({
      url: signed.signedUrl,
      label:
        kind === 'estimate'
          ? 'Supplier proof'
          : kind === 'receipt'
            ? 'Final receipt'
            : 'Acquired fabric',
      video: isVideoMediaUrl(path),
    })
  }

  if (!isTailor && !isCustomer && advances.length === 0) return null

  return (
    <Surface className="overflow-hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Fabric and material funding
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Protected material costs</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-ink/62">
          Funded-fabric claims use the allowance already paid at checkout; legacy add-ons remain
          separate. Every release still requires exact customer approval and Money Desk review.
        </p>
      </div>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {advances.length === 0 ? (
          <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
            No material advance is open on this order.
          </p>
        ) : (
          advances.map((advance) => {
            const reconciliationCopy = materialReconciliationCopy({
              outcome: advance.reconciliation_outcome,
              resolution: advance.reconciliation_resolution,
              customerRefundAmount: advance.customer_refund_amount,
              unapprovedOverageAmount: advance.unapproved_overage_amount,
              actorRole: isTailor ? 'TAILOR' : 'CUSTOMER',
            })
            return (
              <article
                id={`material-advance-${advance.id}`}
                tabIndex={-1}
                key={advance.id}
                className={`scroll-mt-24 rounded-[8px] border bg-bone/60 p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-needle/35 ${focusedAdvanceId === advance.id ? 'border-needle/35 bg-needle/6' : 'border-ink/8'}`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-ink">
                      {safeUserText(advance.title, 'Material advance')}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-ink/62">
                      {safeUserText(advance.description, 'Material cost requested.')}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      <span>{formatMoney(advance.amount, advance.currency)}</span>
                      <StatusChip status={advance.status} fallback="Requested" />
                      <StatusChip status={advance.release_status} fallback="Release pending" />
                    </div>
                    {advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' ? (
                      <p className="mt-3 rounded-[8px] border border-needle/12 bg-needle/8 p-3 text-sm leading-6 text-ink/68">
                        Claim against the protected fabric allowance · no second customer charge.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {advance.estimate_storage_bucket && advance.estimate_storage_path ? (
                      <button
                        type="button"
                        onClick={() => {
                          void openEvidence(advance, 'estimate')
                        }}
                        className="text-sm font-semibold text-needle"
                      >
                        View proof
                      </button>
                    ) : null}
                    {advance.receipt_storage_path ? (
                      <button
                        type="button"
                        onClick={() => {
                          void openEvidence(advance, 'receipt')
                        }}
                        className="text-sm font-semibold text-needle"
                      >
                        View final receipt
                      </button>
                    ) : null}
                    {advance.acquired_storage_path ? (
                      <button
                        type="button"
                        onClick={() => {
                          void openEvidence(advance, 'acquired')
                        }}
                        className="text-sm font-semibold text-needle"
                      >
                        View acquired fabric
                      </button>
                    ) : null}
                  </div>
                </div>
                {!advance.estimate_storage_bucket || !advance.estimate_storage_path ? (
                  <div className="mt-4 rounded-[8px] border border-rust/20 bg-rust/6 p-3">
                    <p className="text-sm font-semibold text-rust-700">
                      Supplier proof unavailable
                    </p>
                    <p className="mt-1 text-sm leading-6 text-ink/62">
                      This request cannot be approved. Ask the tailor to resubmit it with an
                      estimate or supplier photo.
                    </p>
                  </div>
                ) : null}
                {advance.customer_response_reason ? (
                  <p className="mt-3 text-sm text-ink/62">
                    Decision reason:{' '}
                    {materialAdvanceDeclineReasonLabel(advance.customer_response_reason) ??
                      'Not specified'}
                  </p>
                ) : null}
                {reconciliationCopy ? (
                  <div
                    role="status"
                    className={`mt-4 rounded-[8px] border p-3 ${reconciliationCopy.tone === 'success' ? 'border-needle/18 bg-needle/8' : 'border-rust/18 bg-rust/6'}`}
                  >
                    <p className="text-sm font-semibold text-ink">{reconciliationCopy.title}</p>
                    <p className="mt-1 text-sm leading-6 text-ink/64">{reconciliationCopy.body}</p>
                    {Number(advance.customer_refund_amount ?? 0) > 0 ? (
                      <p className="mt-2 text-sm font-semibold text-ink">
                        Customer refund ·{' '}
                        {formatMoney(advance.customer_refund_amount, advance.currency)}
                      </p>
                    ) : null}
                    {Number(advance.unapproved_overage_amount ?? 0) > 0 ? (
                      <p className="mt-2 text-sm font-semibold text-ink">
                        Unapproved overage ·{' '}
                        {formatMoney(advance.unapproved_overage_amount, advance.currency)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {isCustomer && advance.status === 'REQUESTED' ? (
                  <div className="mt-4 grid gap-3 border-t border-ink/6 pt-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => respondAdvance(advance, 'APPROVE')}
                        disabled={
                          !!busy ||
                          !advance.estimate_storage_bucket ||
                          !advance.estimate_storage_path
                        }
                        className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                      >
                        {busy === `APPROVE:${advance.id}` ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecliningAdvanceId(
                            decliningAdvanceId === advance.id ? null : advance.id
                          )
                          setResponseNote('')
                          setDeclineReason('FIND_CHEAPER_OPTION')
                        }}
                        disabled={!!busy}
                        className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38"
                      >
                        Decline
                      </button>
                    </div>
                    {decliningAdvanceId === advance.id ? (
                      <div className="grid gap-3 rounded-[8px] border border-rust/16 bg-white p-4">
                        <label className="grid gap-2 text-sm font-semibold text-ink">
                          Why are you declining?
                          <NativeSelect
                            value={declineReason}
                            onChange={(event) =>
                              setDeclineReason(event.target.value as MaterialAdvanceDeclineReason)
                            }
                          >
                            {MATERIAL_ADVANCE_DECLINE_REASONS.map((reason) => (
                              <option key={reason} value={reason}>
                                {MATERIAL_ADVANCE_DECLINE_REASON_LABELS[reason]}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                        <textarea
                          value={responseNote}
                          onChange={(event) => setResponseNote(event.target.value)}
                          rows={3}
                          maxLength={300}
                          placeholder={
                            declineReason === 'OTHER'
                              ? 'Explain why you are declining.'
                              : 'Optional note for the tailor'
                          }
                          className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                        />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => respondAdvance(advance, 'DECLINE')}
                            disabled={!!busy}
                            className="inline-flex justify-center rounded-[8px] bg-rust px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                          >
                            {busy === `DECLINE:${advance.id}` ? 'Declining...' : 'Confirm decline'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDecliningAdvanceId(null)}
                            disabled={!!busy}
                            className="inline-flex justify-center rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isCustomer &&
                ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(advance.status ?? '') ? (
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => payAdvance(advance)}
                      disabled={!!busy}
                      className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                    >
                      {busy === `pay:${advance.id}`
                        ? 'Preparing...'
                        : advance.status === 'PAYMENT_FAILED'
                          ? 'Retry material payment'
                          : 'Pay material advance'}
                    </button>
                    {stripeAdvancePayment?.advanceId === advance.id ? (
                      <StripeCardAuthorization
                        clientSecret={stripeAdvancePayment.clientSecret}
                        label={formatMoney(
                          stripeAdvancePayment.amount ?? advance.amount,
                          stripeAdvancePayment.currency ?? advance.currency
                        )}
                        submitLabel="Authorize material payment"
                        onConfirm={async (paymentIntentId) => {
                          await invokeAccountFunction('material-advance-action', {
                            action: 'confirm-payment',
                            advanceId: advance.id,
                            paymentIntentId,
                          })
                        }}
                        onDone={() => {
                          setStripeAdvancePayment(null)
                          onRefresh()
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
                {isTailor && advance.status === 'RELEASED' && !advance.reconciled_at ? (
                  <div className="mt-4 grid gap-3 border-t border-ink/6 pt-4">
                    <label className="grid gap-2 text-sm font-semibold text-ink">
                      Final supplier receipt
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                        capture="environment"
                        onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                        className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal text-ink"
                      />
                    </label>
                    {advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' ? (
                      <label className="grid gap-2 text-sm font-semibold text-ink">
                        Acquired fabric proof
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          capture="environment"
                          onChange={(event) => setAcquiredFile(event.target.files?.[0] ?? null)}
                          className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal text-ink"
                        />
                        <span className="text-xs font-normal leading-5 text-ink/55">
                          A separate photo showing the exact approved fabric is now in hand.
                        </span>
                      </label>
                    ) : null}
                    <MoneyInput
                      id={`material-spent-${advance.id}`}
                      label="Actual spent"
                      value={actualSpent}
                      onValueChange={setActualSpent}
                      currency={normalizeAccountCurrency(advance.currency) ?? currency}
                      required
                    />
                    <textarea
                      value={receiptNote}
                      onChange={(event) => setReceiptNote(event.target.value)}
                      rows={2}
                      placeholder="Optional receipt note"
                      className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                    />
                    <button
                      type="button"
                      onClick={() => uploadReceipt(advance)}
                      disabled={!!busy}
                      className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                    >
                      {busy === `receipt:${advance.id}` ? 'Uploading...' : 'Upload receipt proof'}
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })
        )}
        {isTailor && (order.order_kind ?? 'CUSTOM') === 'CUSTOM' && !hasActiveAdvance ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/12 bg-needle/8 p-4">
            <h3 className="text-xl font-semibold text-ink">
              {order.fabric_funding_policy_version === 'fabric-funding-2026-08-01-v1'
                ? 'Request fabric release'
                : 'Request a material advance'}
            </h3>
            {order.fabric_funding_policy_version === 'fabric-funding-2026-08-01-v1' ? (
              <p className="text-sm leading-6 text-ink/62">
                Enter the exact supported amount for the fabric the customer approved. It comes from
                the allowance already paid at checkout and goes to Money Desk after customer
                approval.
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-[1fr_0.55fr_0.4fr]">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Aso-oke embroidery deposit"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
              <MoneyInput
                id={`material-request-${order.id}`}
                label="Requested amount"
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                required
              />
              <select
                value={currency}
                onChange={(event) =>
                  setCurrency(normalizeAccountCurrency(event.target.value) ?? currency)
                }
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Explain the material cost and why it is needed before production continues."
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
            <label className="grid gap-2 text-sm font-semibold text-ink">
              Supplier estimate or item photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) => setEstimateFile(event.target.files?.[0] ?? null)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal text-ink"
              />
            </label>
            {fundedFabric &&
            fabricAllowanceRemaining != null &&
            parseMinorUnits(amount) != null &&
            parseMinorUnits(amount)! > fabricAllowanceRemaining ? (
              <div
                role="alert"
                className="rounded-[8px] border border-rust/20 bg-rust/6 p-3 text-sm leading-6 text-ink/68"
              >
                <strong className="block text-ink">Additional approval required</strong>
                Requested {formatMoney(parseMinorUnits(amount)!, currency)} · allowance left{' '}
                {formatMoney(fabricAllowanceRemaining, currency)} · additional fabric funding{' '}
                {formatMoney(parseMinorUnits(amount)! - fabricAllowanceRemaining, currency)} before
                tax.
              </div>
            ) : fundedFabric && fabricAllowanceRemaining != null ? (
              <p className="text-sm text-ink/62">
                Protected allowance remaining: {formatMoney(fabricAllowanceRemaining, currency)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={requestAdvance}
              disabled={busy === 'request'}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
            >
              {busy === 'request'
                ? 'Requesting...'
                : fundedFabric &&
                    fabricAllowanceRemaining != null &&
                    parseMinorUnits(amount) != null &&
                    parseMinorUnits(amount)! > fabricAllowanceRemaining
                  ? 'Send fabric funding change'
                  : fundedFabric
                    ? 'Request fabric release'
                    : 'Request advance'}
            </button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={!!evidencePreview}
        onOpenChange={(open) => {
          if (!open) setEvidencePreview(null)
        }}
      >
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{evidencePreview?.label ?? 'Protected evidence'}</DialogTitle>
            <DialogDescription>
              Private order evidence. This link expires automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[72vh] overflow-auto bg-bone p-4">
            {evidencePreview?.video ? (
              <video
                src={evidencePreview.url}
                controls
                playsInline
                className="mx-auto max-h-[66vh] w-full rounded-[8px] bg-black object-contain"
              />
            ) : evidencePreview ? (
              <img
                src={evidencePreview.url}
                alt={evidencePreview.label}
                className="mx-auto max-h-[66vh] w-full rounded-[8px] object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Surface>
  )
}
