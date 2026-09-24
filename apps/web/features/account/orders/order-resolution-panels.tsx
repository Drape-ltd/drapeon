'use client'

import { useCallback, useEffect, useMemo, useRef, useState, ChangeEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { MoneyInput } from '../../../components/money-input'
import { friendlyActionError } from '@drape/shared/action-errors'
import { normalizeAccountCurrency, formatDatabaseEnumLabel, formatMoney, formatMoneyInputValue, COMMERCIAL_ADJUSTMENT_LABELS, COMMERCIAL_ADJUSTMENT_TYPES, COMMERCIAL_ADJUSTMENT_RESPONSIBILITIES, CommercialAdjustmentType, RETURN_REASONS, RETURN_REASON_LABELS, RESOLUTION_REMEDIES, ReturnReason, ResolutionRemedy, OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY, refundProviderTimingCopy, OpsPartialRefundOrderOutcome } from '@drape/shared'
import { ALLOWED_REVIEW_MEDIA_CONTENT_TYPES, MEDIA_LIMITS_BYTES, MEDIA_LIMITS_SECONDS, VIDEO_DURATION_LIMIT_MESSAGE } from '@drape/shared/media-policy'
import { createClient } from '../../../lib/supabase'
import type { AccountCommercialAdjustment, AccountOrder, OrderActorData, OrderDetailRenderData } from '../shared/account-data-contracts'
import { invokeAccountFunction } from '../shared/account-data-queries'
import { ActionNotice, MutedVideo, assertNoContactLeak, cleanLabel, extensionBackedMediaContentType, isVideoContentType, parseMinorUnits, portfolioVideoDuration, reencodeImageFile, uploadPrivateFile } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Textarea } from '../../../components/ui/textarea'
import { prepareOrderEvidenceFile, uploadPublicFile } from './account-order-actions'
import { splitList } from '../shop/account-shop-surface'
import { StripeCardAuthorization } from './material-advance-panel'
import { SummaryLine } from './account-dispatch-card'

export function isCustomerOrder(order: AccountOrder, data: Pick<OrderActorData, 'userId'>) {
  return order.customer_id === data.userId
}

const REVIEW_MEDIA_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.reviewVideo

const REVIEW_MEDIA_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.reviewVideo

const REVIEW_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_REVIEW_MEDIA_CONTENT_TYPES)

const MAX_REVIEW_MEDIA = 6

async function prepareReviewMediaFile(file: File) {
  const contentType = extensionBackedMediaContentType(file, REVIEW_MEDIA_CONTENT_TYPES)
  if (!contentType || !REVIEW_MEDIA_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      'That file type is not supported here. Please choose a photo or video from your device.'
    )
  }

  if (isVideoContentType(contentType)) {
    if (file.size > REVIEW_MEDIA_VIDEO_MAX_BYTES) {
      throw new Error(
        `Choose videos under ${Math.round(REVIEW_MEDIA_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
      )
    }
    const duration = await portfolioVideoDuration(file)
    if (Number.isFinite(duration) && duration > REVIEW_MEDIA_VIDEO_MAX_SECONDS) {
      throw new Error(VIDEO_DURATION_LIMIT_MESSAGE)
    }
    return new File([file], file.name, {
      type: contentType,
      lastModified: file.lastModified,
    })
  }

  if (file.size > MEDIA_LIMITS_BYTES.image) {
    throw new Error('Choose a photo under 10 MB.')
  }
  return reencodeImageFile(file)
}

const RESOLUTION_REMEDY_LABELS: Record<ResolutionRemedy, string> = {
  EXPLANATION: 'Explanation',
  ALTERATION: 'Alteration',
  REMAKE: 'Remake',
  PARTIAL_REFUND: 'Partial refund',
  FULL_REFUND: 'Full refund',
  RETURN_AND_REFUND: 'Return and refund',
  REJECTED: 'Reject request',
}

export function OrderTipPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'tips' | 'userId'>
  onRefresh: () => void
}) {
  const tip = data.tips[0] ?? null,
    actor =
      order.customer_id === data.userId
        ? 'CUSTOMER'
        : order.tailor_id === data.userId
          ? 'TAILOR'
          : null
  const currency = normalizeAccountCurrency(order.currency ?? order.quoted_currency) ?? 'USD'
  const suggestions = currency === 'NGN' ? ['1000', '2500', '5000'] : ['5', '10', '20']
  const [amount, setAmount] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState<string | null>(null),
    [stripe, setStripe] = useState<{
      tipId: string
      clientSecret: string
      providerReference: string
    } | null>(null)
  if (!actor || !['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage ?? '')) return null
  async function prepare() {
    const parsed =
      tip?.status === 'FAILED' && amount.trim() === '' ? tip.amount : parseMinorUnits(amount)
    if (!parsed) return setError('Enter a valid tip amount.')
    setBusy(true)
    setError(null)
    try {
      const result = await invokeAccountFunction<{
        confirmed?: boolean
        tipId: string
        provider: string
        providerReference: string
        authorizationUrl?: string | null
        clientSecret?: string | null
      }>('order-tip-action', {
        action: 'prepare',
        orderId: order.id,
        amount: parsed,
        currency,
        idempotencyKey: `web:tip:${order.id}:${parsed}`,
      })
      if (result.confirmed) {
        setSuccess('Tip already confirmed.')
        onRefresh()
        return
      }
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.provider === 'STRIPE' && result.clientSecret)
        setStripe({
          tipId: result.tipId,
          clientSecret: result.clientSecret,
          providerReference: result.providerReference,
        })
    } catch (cause) {
      setError(friendlyActionError(cause, 'The tip could not start.'))
    } finally {
      setBusy(false)
    }
  }
  if (tip)
    return (
      <Surface className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-needle">
              {actor === 'CUSTOMER' ? 'Your tip' : 'Customer tip'}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-ink">
              {formatMoney(tip.amount, tip.currency)}
            </h3>
            <p className="mt-2 text-sm text-ink/60">
              The full displayed amount is owed to the tailor and stays separate from the order.
            </p>
          </div>
          <div className="grid gap-2">
            <StatusChip status={tip.status} fallback="Tip" />
            {actor === 'CUSTOMER' && tip.status === 'FAILED' ? (
              <Button
                disabled={busy}
                onClick={() => {
                  void prepare()
                }}
              >
                Retry tip
              </Button>
            ) : null}
          </div>
        </div>
      </Surface>
    )
  if (actor === 'TAILOR') return null
  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Optional thank-you"
        title="Tip your tailor"
        description="Drapeon takes no commission from the displayed tip. It does not affect reviews, ranking, or order totals."
      />
      <div className="grid gap-3 p-5">
        <ActionNotice error={error} success={success} />
        <div className="flex flex-wrap gap-2">
          {suggestions.map((value) => {
            const formatted = formatMoneyInputValue(value)
            return (
              <button
                type="button"
                key={value}
                onClick={() => setAmount(formatted)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${amount === formatted ? 'border-needle bg-needle/10 text-needle' : 'border-ink/10 bg-bone text-ink'}`}
              >
                {currency} {formatted}
              </button>
            )
          })}
        </div>
        <MoneyInput
          id={`order-tip-${order.id}`}
          label="Custom tip"
          value={amount}
          onValueChange={setAmount}
          currency={currency}
        />
        <Button
          disabled={busy}
          onClick={() => {
            void prepare()
          }}
        >
          {busy ? 'Preparing…' : 'Send tip'}
        </Button>
        {stripe ? (
          <StripeCardAuthorization
            clientSecret={stripe.clientSecret}
            label={`Tip in ${currency}`}
            submitLabel="Authorize tip"
            onConfirm={async () => {
              await invokeAccountFunction('order-tip-action', {
                action: 'confirm',
                tipId: stripe.tipId,
                providerReference: stripe.providerReference,
              })
            }}
            onDone={() => {
              setStripe(null)
              onRefresh()
            }}
          />
        ) : null}
      </div>
    </Surface>
  )
}

type AccountOpsRefundResolution = {
  id: string
  amount: number
  currency: string
  status: string
  order_outcome: OpsPartialRefundOrderOutcome
  resume_stage: string | null
  failure_summary: string | null
}

export function OpsRefundStatusPanel({
  order,
  data,
  previewResolution,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'userId' | 'payments'>
  previewResolution?: AccountOpsRefundResolution
}) {
  const [resolution, setResolution] = useState<AccountOpsRefundResolution | null>(
    previewResolution ?? null
  )
  const supabase = useMemo(() => createClient(), [])
  const refresh = useCallback(async () => {
    const { data: row } = await supabase
      .from('order_refund_resolutions')
      .select('id,amount,currency,status,order_outcome,resume_stage,failure_summary')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setResolution(row as AccountOpsRefundResolution | null)
  }, [order.id, supabase])
  useEffect(() => {
    if (previewResolution) return
    const initialRefresh = window.setTimeout(() => {
      void refresh()
    }, 0)
    const channel = supabase
      .channel(`web-refund-status:${order.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_refund_resolutions',
          filter: `order_id=eq.${order.id}`,
        },
        () => {
          void refresh()
        }
      )
      .subscribe()
    return () => {
      window.clearTimeout(initialRefresh)
      void supabase.removeChannel(channel)
    }
  }, [order.id, previewResolution, refresh, supabase])
  if (!resolution) return null
  const actorRole = order.customer_id === data.userId ? 'CUSTOMER' : 'TAILOR'
  const payment = data.payments.find(
    (row) => row.order_id === order.id && row.phase === 'INITIAL_ORDER'
  )
  const timing = refundProviderTimingCopy({ provider: payment?.provider, audience: actorRole })
  const outcome = OPS_PARTIAL_REFUND_ORDER_OUTCOME_COPY[resolution.order_outcome]
  const statusLabel =
    resolution.status === 'SUCCEEDED'
      ? 'Refund sent'
      : ['FAILED', 'BLOCKED'].includes(resolution.status)
        ? 'Refund needs review'
        : resolution.status === 'PROCESSING'
          ? 'Refund processing'
          : 'Refund awaiting approval'
  return (
    <section
      className="rounded-[8px] border border-needle/18 bg-mint/35 p-5 shadow-sm"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
            {statusLabel}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-ink">
            {formatMoney(resolution.amount, resolution.currency)}
          </h2>
        </div>
        <span className="rounded-full border border-needle/18 bg-white px-3 py-1 text-xs font-semibold text-needle">
          {timing.label}
        </span>
      </div>
      <p className="mt-4 text-sm leading-7 text-ink/68">{timing.detail}</p>
      <div className="mt-4 border-t border-needle/12 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/48">
          What happens to this order
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">
          {outcome.label}
          {resolution.order_outcome === 'CONTINUE_ORDER' && resolution.resume_stage
            ? ` · ${formatDatabaseEnumLabel(resolution.resume_stage)}`
            : ''}
        </p>
      </div>
      {actorRole === 'TAILOR' ? (
        <p className="mt-3 text-xs leading-5 text-ink/52">
          The customer refund follows the customer’s payment provider. Your payout provider is
          handled separately.
        </p>
      ) : null}
      {resolution.failure_summary ? (
        <p className="mt-3 text-sm text-rust">{resolution.failure_summary}</p>
      ) : null}
    </section>
  )
}

export function ReturnResolutionPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'returnRequests' | 'resolutionProposals' | 'userId'>
  onRefresh: () => void
}) {
  const actorRole =
    order.customer_id === data.userId
      ? 'CUSTOMER'
      : order.tailor_id === data.userId
        ? 'TAILOR'
        : null
  const active =
    data.returnRequests.find((item) => !['RESOLVED', 'CANCELLED'].includes(item.status)) ?? null
  const latestProposal = active
    ? (data.resolutionProposals
        .filter((item) => item.return_request_id === active.id)
        .sort((a, b) => b.version - a.version)[0] ?? null)
    : null
  const [expanded, setExpanded] = useState(false),
    [reason, setReason] = useState<ReturnReason>('QUALITY_WORKMANSHIP'),
    [remedy, setRemedy] = useState<ResolutionRemedy>('ALTERATION'),
    [summary, setSummary] = useState(''),
    [amount, setAmount] = useState(''),
    [note, setNote] = useState(''),
    [evidence, setEvidence] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState<string | null>(null)
  const actionNonce = useRef(0)
  if (!actorRole) return null
  const canOpen =
    actorRole === 'CUSTOMER' && ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage ?? '')
  if (!active && !canOpen) return null
  const currency = normalizeAccountCurrency(order.currency ?? order.quoted_currency) ?? 'USD'
  const availableOpenRemedies: ResolutionRemedy[] = RESOLUTION_REMEDIES.filter(
    (value) => value !== 'REJECTED'
  )
  const moneyRemedy = ['PARTIAL_REFUND', 'FULL_REFUND', 'RETURN_AND_REFUND'].includes(remedy)
  function nextActionKey(scope: string) {
    actionNonce.current += 1
    return `${scope}:${actionNonce.current}`
  }
  async function open() {
    setError(null)
    setSuccess(null)
    const parsed = moneyRemedy ? parseMinorUnits(amount) : null
    if (summary.trim().length < 10 || (moneyRemedy && !parsed))
      return setError(
        'Add a clear summary and the exact requested amount when asking for a refund.'
      )
    setBusy(true)
    try {
      const evidenceRows = [] as Array<Record<string, unknown>>
      if (evidence) {
        const path = await uploadPrivateFile(
          'commercial-evidence',
          `${order.id}/returns`,
          await prepareOrderEvidenceFile(evidence)
        )
        evidenceRows.push({
          storageBucket: 'commercial-evidence',
          storageObjectPath: path,
          evidenceType: 'RETURN_EVIDENCE',
          mimeType: evidence.type || undefined,
        })
      }
      await invokeAccountFunction('return-resolution-action', {
        action: 'open',
        orderId: order.id,
        reason,
        requestedRemedy: remedy,
        summary: summary.trim(),
        requestedAmount: parsed,
        currency: parsed ? currency : null,
        evidence: evidenceRows,
        idempotencyKey: nextActionKey(`web:return:${order.id}`),
      })
      setSummary('')
      setAmount('')
      setEvidence(null)
      setExpanded(false)
      setSuccess('Protected resolution opened and sent to the other party.')
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'The resolution could not be opened.'))
    } finally {
      setBusy(false)
    }
  }
  async function propose() {
    if (!active || note.trim().length < 3) return setError('Briefly explain the proposal.')
    const parsed = moneyRemedy ? parseMinorUnits(amount) : null
    if (moneyRemedy && !parsed) return setError('Enter the exact proposed refund amount.')
    setBusy(true)
    setError(null)
    try {
      await invokeAccountFunction('return-resolution-action', {
        action: 'propose',
        returnRequestId: active.id,
        remedy,
        amount: parsed,
        currency: parsed ? currency : null,
        returnRequired:
          remedy === 'RETURN_AND_REFUND' ||
          (remedy === 'FULL_REFUND' && active.reason_code !== 'NOT_RECEIVED'),
        shippingResponsibility: remedy === 'RETURN_AND_REFUND' ? 'UNRESOLVED' : null,
        note: note.trim(),
        idempotencyKey: nextActionKey(`web:proposal:${active.id}`),
      })
      setNote('')
      setAmount('')
      setSuccess('Proposal sent for an authenticated decision.')
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'The proposal could not be sent.'))
    } finally {
      setBusy(false)
    }
  }
  async function decide(decision: 'ACCEPTED' | 'DECLINED') {
    if (!latestProposal) return
    setBusy(true)
    setError(null)
    try {
      await invokeAccountFunction('return-resolution-action', {
        action: 'decide',
        proposalId: latestProposal.id,
        decision,
        note: '',
        idempotencyKey: nextActionKey(`web:decision:${latestProposal.id}:${decision}`),
      })
      setSuccess(`Proposal ${decision.toLowerCase()}.`)
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'The proposal could not be updated.'))
    } finally {
      setBusy(false)
    }
  }
  const needsDecision =
    latestProposal?.status === 'OPEN' && latestProposal.proposed_by_role !== actorRole
  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Protected resolution"
        title="Returns and remedies"
        description="Agree on the remedy here. Email mirrors the case, while refunds still require evidence and Money Desk approval."
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        {active ? (
          <article className="grid gap-3 rounded-[8px] border border-ink/10 bg-bone/45 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-needle">
                  {active.reference}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink">
                  {RETURN_REASON_LABELS[active.reason_code]}
                </h3>
              </div>
              <StatusChip status={active.status} fallback="Resolution" />
            </div>
            <p className="text-sm leading-6 text-ink/68">{active.summary}</p>
            <div className="rounded-[8px] bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-needle">
                {formatDatabaseEnumLabel(active.eligibility_status)}
              </p>
              <p className="mt-1 text-sm leading-6 text-ink/60">{active.eligibility_reason}</p>
            </div>
            {latestProposal ? (
              <div className="rounded-[8px] border border-ink/8 bg-white p-4">
                <div className="flex justify-between gap-3">
                  <strong>{RESOLUTION_REMEDY_LABELS[latestProposal.remedy]}</strong>
                  <StatusChip status={latestProposal.status} fallback="Proposal" />
                </div>
                {latestProposal.amount && latestProposal.currency ? (
                  <p className="mt-2 font-semibold text-ink">
                    {formatMoney(latestProposal.amount, latestProposal.currency)}
                  </p>
                ) : null}
                <p className="mt-2 text-sm leading-6 text-ink/62">{latestProposal.note}</p>
                {latestProposal.return_required ? (
                  <p className="mt-2 text-xs font-semibold text-rust">
                    A physical return is part of this proposal.
                  </p>
                ) : null}
              </div>
            ) : null}
            {needsDecision ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  disabled={busy}
                  onClick={() => {
                    void decide('ACCEPTED')
                  }}
                >
                  Accept proposal
                </Button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void decide('DECLINED')
                  }}
                  className="rounded-full border border-ink/12 bg-white px-4 py-2.5 text-sm font-semibold"
                >
                  Decline
                </button>
              </div>
            ) : null}
            {!latestProposal || ['DECLINED', 'SUPERSEDED'].includes(latestProposal.status) ? (
              <div className="grid gap-3 border-t border-ink/8 pt-4">
                <h4 className="font-semibold text-ink">Offer a clear next step</h4>
                <NativeSelect
                  value={remedy}
                  onChange={(event) => setRemedy(event.target.value as ResolutionRemedy)}
                >
                  {RESOLUTION_REMEDIES.map((value) => (
                    <option key={value} value={value}>
                      {RESOLUTION_REMEDY_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
                {moneyRemedy ? (
                  <MoneyInput
                    id={`resolution-proposal-${order.id}`}
                    label="Resolution amount"
                    value={amount}
                    onValueChange={setAmount}
                    currency={currency}
                  />
                ) : null}
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="What are you offering and what happens next?"
                />
                <Button
                  disabled={busy}
                  onClick={() => {
                    void propose()
                  }}
                >
                  {busy ? 'Sending…' : 'Send proposal'}
                </Button>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-ink/48">
              Accepting records the agreement; it does not move money. Any required return and
              refund remain protected.
            </p>
          </article>
        ) : expanded ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/14 bg-needle/7 p-4">
            <NativeSelect
              value={reason}
              onChange={(event) => setReason(event.target.value as ReturnReason)}
            >
              {RETURN_REASONS.map((value) => (
                <option key={value} value={value}>
                  {RETURN_REASON_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={remedy}
              onChange={(event) => setRemedy(event.target.value as ResolutionRemedy)}
            >
              {availableOpenRemedies.map((value) => (
                <option key={value} value={value}>
                  {RESOLUTION_REMEDY_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
            {moneyRemedy ? (
              <MoneyInput
                id={`resolution-request-${order.id}`}
                label="Requested refund amount"
                value={amount}
                onValueChange={setAmount}
                currency={currency}
              />
            ) : null}
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Describe what happened, what you expected, and the evidence you have."
            />
            <label className="text-sm font-semibold text-ink">
              Evidence (optional)
              <input
                type="file"
                accept="image/*,video/*,application/pdf"
                onChange={(event) => setEvidence(event.target.files?.[0] ?? null)}
                className="mt-2 block w-full text-sm font-normal"
              />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  void open()
                }}
              >
                {busy ? 'Opening…' : 'Open protected case'}
              </Button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-full border border-ink/12 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center justify-between rounded-[8px] border border-ink/10 bg-bone/50 p-4 text-left"
          >
            <span>
              <strong className="block text-ink">Request a resolution</strong>
              <span className="mt-1 block text-sm text-ink/58">
                Ask Drapeon to review an issue with an order you received.
              </span>
            </span>
            <ChevronRight className="size-5 text-needle" />
          </button>
        )}
      </div>
    </Surface>
  )
}

export function CommercialAdjustmentPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'commercialAdjustments' | 'userId'>
  onRefresh: () => void
}) {
  const adjustments = useMemo(
    () => data.commercialAdjustments.filter((item) => item.order_id === order.id),
    [data.commercialAdjustments, order.id]
  )
  const actorRole =
    order.customer_id === data.userId
      ? 'CUSTOMER'
      : order.tailor_id === data.userId
        ? 'TAILOR'
        : null
  const [type, setType] = useState<CommercialAdjustmentType>('SCOPE')
  const [summary, setSummary] = useState('')
  const [reason, setReason] = useState('')
  const [responsibility, setResponsibility] = useState('UNRESOLVED')
  const [amount, setAmount] = useState('')
  const [deadline, setDeadline] = useState('')
  const [extensionReason, setExtensionReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [fabricLinks, setFabricLinks] = useState<
    Record<
      string,
      {
        requested_release_amount: number
        remaining_allowance_snapshot: number
        shortfall_amount: number
        material_advance_id: string | null
      }
    >
  >({})
  const [stripePayment, setStripePayment] = useState<{
    adjustmentId: string
    clientSecret: string
    amount: number
    currency: string
  } | null>(null)
  const hasOpen = adjustments.some((item) =>
    ['PROPOSED', 'PAYMENT_PENDING', 'PAID', 'OPS_REVIEW'].includes(item.status)
  )
  const hasOpenExtension = adjustments.some(
    (item) =>
      item.adjustment_type === 'DEADLINE_EXTENSION' &&
      ['PROPOSED', 'ACCEPTED', 'PAYMENT_PENDING', 'PAID', 'OPS_REVIEW'].includes(item.status)
  )
  const extensionAvailable =
    actorRole === 'TAILOR' &&
    !hasOpenExtension &&
    ![
      'PENDING_QUOTE',
      'CONSULTATION',
      'QUOTE_SENT',
      'PAYMENT_PENDING',
      'PAYMENT_FAILED',
      'DELIVERED',
      'COLLECTED',
      'COMPLETE',
      'CANCELLED',
      'DECLINED',
      'EXPIRED',
    ].includes(order.stage ?? '')

  useEffect(() => {
    const ids = adjustments.map((item) => item.id)
    if (ids.length === 0) return
    void createClient()
      .from('fabric_release_adjustment_links')
      .select(
        'adjustment_id,requested_release_amount,remaining_allowance_snapshot,shortfall_amount,material_advance_id'
      )
      .in('adjustment_id', ids)
      .then(({ data: rows }) =>
        setFabricLinks(Object.fromEntries((rows ?? []).map((row) => [row.adjustment_id, row])))
      )
  }, [adjustments])

  async function proposeExtension() {
    setError(null)
    setSuccess(null)
    if (!deadline || extensionReason.trim().length < 10)
      return setError('Choose the exact new deadline and clearly explain why more time is needed.')
    const proposed = new Date(deadline)
    if (!Number.isFinite(proposed.getTime()) || proposed.getTime() <= Date.now())
      return setError('Choose a valid future deadline.')
    setBusy('extension')
    try {
      await invokeAccountFunction('commercial-adjustment-action', {
        action: 'propose',
        orderId: order.id,
        type: 'DEADLINE_EXTENSION',
        summary: `Request more time until ${new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(proposed)}`,
        reason: extensionReason.trim(),
        responsibility: 'TAILOR',
        amountDelta: 0,
        currency: order.currency ?? order.quoted_currency ?? 'USD',
        proposedDeadline: proposed.toISOString(),
        evidenceIds: [],
        idempotencyKey: `web:extension:${order.id}:${proposed.toISOString()}`,
      })
      setDeadline('')
      setExtensionReason('')
      setSuccess('Extension request sent for the customer to accept or decline.')
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'The extension request could not be sent.'))
    } finally {
      setBusy(null)
    }
  }

  async function propose() {
    setError(null)
    setSuccess(null)
    const parsedAmount =
      amount.trim() && Number.parseFloat(amount.replace(/,/g, '')) !== 0
        ? parseMinorUnits(amount)
        : 0
    const leak = assertNoContactLeak(
      [summary, reason].join('\n'),
      "Order changes can't include contact details."
    )
    if (leak) return setError(leak)
    if (summary.trim().length < 10 || reason.trim().length < 10 || parsedAmount == null)
      return setError('Add a clear summary, reason, and valid price impact.')
    if (type === 'DEADLINE_EXTENSION' && !deadline)
      return setError('Choose the exact proposed deadline, including local time.')
    setBusy('propose')
    try {
      await invokeAccountFunction('commercial-adjustment-action', {
        action: 'propose',
        orderId: order.id,
        type,
        summary: summary.trim(),
        reason: reason.trim(),
        responsibility,
        amountDelta: parsedAmount ?? 0,
        currency: order.currency ?? order.quoted_currency ?? 'USD',
        proposedDeadline: deadline ? new Date(deadline).toISOString() : null,
        evidenceIds: [],
        idempotencyKey: `web:${order.id}:${type}:${Date.now()}`,
      })
      setSummary('')
      setReason('')
      setAmount('')
      setDeadline('')
      setSuccess('The change was sent for a recorded counterpart decision.')
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'The order change could not be proposed.'))
    } finally {
      setBusy(null)
    }
  }

  async function update(
    item: AccountCommercialAdjustment,
    action: 'respond' | 'complete',
    decision?: 'ACCEPTED' | 'DECLINED' | 'CANCELLED'
  ) {
    setError(null)
    setSuccess(null)
    setBusy(`${action}:${decision ?? ''}:${item.id}`)
    try {
      await invokeAccountFunction('commercial-adjustment-action', {
        action,
        adjustmentId: item.id,
        ...(decision ? { decision } : {}),
      })
      setSuccess(
        action === 'complete' ? 'Added work marked complete.' : `Change ${decision?.toLowerCase()}.`
      )
      onRefresh()
    } catch (cause) {
      setError(friendlyActionError(cause, 'The order change could not be updated.'))
    } finally {
      setBusy(null)
    }
  }

  async function pay(item: AccountCommercialAdjustment) {
    setError(null)
    setSuccess(null)
    setBusy(`pay:${item.id}`)
    setStripePayment(null)
    try {
      const result = await invokeAccountFunction<{
        authorizationUrl?: string | null
        clientSecret?: string | null
        amount: number
        currency: string
      }>('commercial-adjustment-action', { action: 'prepare-payment', adjustmentId: item.id })
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.clientSecret)
        setStripePayment({
          adjustmentId: item.id,
          clientSecret: result.clientSecret,
          amount: result.amount,
          currency: result.currency,
        })
      else setSuccess('Payment is processing. Do not start a duplicate payment.')
    } catch (cause) {
      setError(friendlyActionError(cause, 'The additional payment could not start.'))
    } finally {
      setBusy(null)
    }
  }

  if (!actorRole) return null
  return (
    <Surface className="overflow-hidden">
      <SurfaceHeader
        eyebrow="Recorded amendments"
        title="Order changes"
        description="Price, scope, responsibility, and deadline changes stay separate from the accepted order until both parties decide."
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        {extensionAvailable ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/14 bg-needle/8 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-needle">
                Timeline protection
              </p>
              <h3 className="mt-1 text-lg font-semibold text-ink">Request more time</h3>
              <p className="mt-1 text-sm leading-6 text-ink/60">
                Propose an exact new deadline. The current date remains authoritative until the
                customer accepts.
              </p>
            </div>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              Exact proposed deadline
              <input
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal"
              />
            </label>
            <Textarea
              value={extensionReason}
              onChange={(event) => setExtensionReason(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What changed, what remains, and how will you meet the new date?"
            />
            <Button
              onClick={() => {
                void proposeExtension()
              }}
              disabled={busy === 'extension'}
            >
              {busy === 'extension' ? 'Sending…' : 'Send for customer decision'}
            </Button>
          </div>
        ) : null}
        {adjustments.map((item) => {
          const isCounterpart = item.status === 'PROPOSED' && item.proposed_by_role !== actorRole
          const isProposer = item.status === 'PROPOSED' && item.proposed_by_role === actorRole
          const fabricLink = fabricLinks[item.id]
          return (
            <article
              key={item.id}
              className="grid gap-3 rounded-[8px] border border-ink/10 bg-bone/45 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
                    {item.reference}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-ink">
                    {COMMERCIAL_ADJUSTMENT_LABELS[item.adjustment_type]}
                  </h3>
                </div>
                <StatusChip status={item.status} fallback="Order change" />
              </div>
              <div>
                <p className="font-semibold text-ink">{item.summary}</p>
                <p className="mt-1 text-sm leading-6 text-ink/62">{item.reason}</p>
              </div>
              <div className="grid gap-2 rounded-[8px] bg-white p-3 text-sm sm:grid-cols-3">
                {fabricLink ? (
                  <SummaryLine
                    label="Supplier cost"
                    value={formatMoney(fabricLink.requested_release_amount, item.currency)}
                  />
                ) : null}
                {fabricLink ? (
                  <SummaryLine
                    label="Allowance protected"
                    value={formatMoney(fabricLink.remaining_allowance_snapshot, item.currency)}
                  />
                ) : null}
                {fabricLink ? (
                  <SummaryLine
                    label="Fabric shortfall before tax"
                    value={formatMoney(fabricLink.shortfall_amount, item.currency)}
                  />
                ) : null}
                <SummaryLine
                  label="Price impact"
                  value={
                    item.amount_delta
                      ? `+${formatMoney(item.amount_delta, item.currency)}`
                      : 'No change'
                  }
                />
                <SummaryLine label="Responsibility" value={cleanLabel(item.responsibility)} />
                <SummaryLine
                  label="Deadline"
                  value={
                    item.proposed_deadline
                      ? new Intl.DateTimeFormat(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZoneName: 'short',
                        }).format(new Date(item.proposed_deadline))
                      : 'No change'
                  }
                />
              </div>
              {fabricLink ? (
                <p className="rounded-[8px] border border-needle/14 bg-needle/8 p-3 text-sm leading-6 text-ink/68">
                  {fabricLink.material_advance_id
                    ? 'Payment confirmed. The exact fabric release is now waiting in the protected approval lane.'
                    : 'Accepting does not release funds. The fabric claim opens only after the additional payment is provider-confirmed.'}
                </p>
              ) : null}
              {isCounterpart ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={() => {
                      void update(item, 'respond', 'ACCEPTED')
                    }}
                    disabled={!!busy}
                  >
                    {item.requires_payment ? 'Accept and continue to payment' : 'Accept change'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      void update(item, 'respond', 'DECLINED')
                    }}
                    disabled={!!busy}
                    className="rounded-full border border-ink/12 bg-white px-4 py-2.5 text-sm font-semibold text-ink"
                  >
                    Decline
                  </button>
                </div>
              ) : null}
              {isProposer ? (
                <button
                  type="button"
                  onClick={() => {
                    void update(item, 'respond', 'CANCELLED')
                  }}
                  disabled={!!busy}
                  className="justify-self-start text-sm font-semibold text-rust"
                >
                  Cancel proposal
                </button>
              ) : null}
              {actorRole === 'CUSTOMER' && item.status === 'PAYMENT_PENDING' ? (
                <Button
                  onClick={() => {
                    void pay(item)
                  }}
                  disabled={!!busy}
                >
                  Pay {formatMoney(item.amount_delta, item.currency)}
                </Button>
              ) : null}
              {stripePayment?.adjustmentId === item.id ? (
                <StripeCardAuthorization
                  clientSecret={stripePayment.clientSecret}
                  label={formatMoney(stripePayment.amount, stripePayment.currency)}
                  submitLabel="Authorize order change"
                  onConfirm={async (paymentIntentId) => {
                    await invokeAccountFunction('commercial-adjustment-action', {
                      action: 'confirm-payment',
                      adjustmentId: item.id,
                      paymentIntentId,
                    })
                  }}
                  onDone={() => {
                    setStripePayment(null)
                    onRefresh()
                  }}
                />
              ) : null}
              {actorRole === 'TAILOR' &&
              ['ACCEPTED', 'PAID'].includes(item.status) &&
              [
                'SCOPE',
                'MATERIAL',
                'RUSH_WORK',
                'FIT_REVISION',
                'CORRECTION',
                'OTHER_REVIEWED',
              ].includes(item.adjustment_type) ? (
                <Button
                  onClick={() => {
                    void update(item, 'complete')
                  }}
                  disabled={!!busy}
                >
                  Mark added work complete
                </Button>
              ) : null}
            </article>
          )
        })}
        {!hasOpen ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/12 bg-needle/8 p-4">
            <h3 className="text-lg font-semibold text-ink">Propose a formal change</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <NativeSelect
                value={type}
                onChange={(event) => setType(event.target.value as CommercialAdjustmentType)}
              >
                {COMMERCIAL_ADJUSTMENT_TYPES.filter((value) => value !== 'DEADLINE_EXTENSION').map(
                  (value) => (
                    <option key={value} value={value}>
                      {COMMERCIAL_ADJUSTMENT_LABELS[value]}
                    </option>
                  )
                )}
              </NativeSelect>
              <NativeSelect
                value={responsibility}
                onChange={(event) => setResponsibility(event.target.value)}
              >
                {COMMERCIAL_ADJUSTMENT_RESPONSIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {cleanLabel(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What is changing?"
              maxLength={500}
            />
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Why is this needed, and what happens if it is declined?"
              maxLength={1000}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <MoneyInput
                id={`adjustment-amount-${order.id}`}
                label="Additional amount"
                value={amount}
                onValueChange={setAmount}
                currency={
                  normalizeAccountCurrency(order.currency ?? order.quoted_currency) ?? 'USD'
                }
                allowZero
                hint="Enter zero when the change has no price impact."
              />
              <label className="grid gap-1 text-sm font-semibold text-ink">
                Exact proposed deadline
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal"
                />
              </label>
            </div>
            <Button
              onClick={() => {
                void propose()
              }}
              disabled={busy === 'propose'}
            >
              {busy === 'propose' ? 'Sending…' : 'Send for decision'}
            </Button>
          </div>
        ) : null}
      </div>
    </Surface>
  )
}

type ReviewMediaDraft = {
  id: string
  file: File
  previewUrl: string
  type: 'image' | 'video'
}

export function OrderReviewPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'reviews' | 'userId' | 'customerProfile' | 'tailorProfile'>
  onRefresh: () => void
}) {
  const existingReview = data.reviews.find((review) => review.order_id === order.id)
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('Fit matched, Clear communication')
  const [reviewMediaDrafts, setReviewMediaDrafts] = useState<ReviewMediaDraft[]>([])
  const reviewMediaDraftsRef = useRef<ReviewMediaDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const readyForReview =
    isCustomerOrder(order, data) &&
    ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage ?? '')

  useEffect(() => {
    reviewMediaDraftsRef.current = reviewMediaDrafts
  }, [reviewMediaDrafts])

  useEffect(
    () => () => {
      for (const draft of reviewMediaDraftsRef.current) URL.revokeObjectURL(draft.previewUrl)
    },
    []
  )

  if (!readyForReview) return null

  if (existingReview) {
    return (
      <section className="rounded-[8px] border border-needle/12 bg-needle/8 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          Review submitted
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">Thanks for rating this order.</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          Your review helps future customers understand the tailor’s fit, communication, and
          delivery reliability.
        </p>
      </section>
    )
  }

  async function handleReviewMediaFiles(event: ChangeEvent<HTMLInputElement>) {
    setError(null)
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length === 0) return

    const remainingSlots = MAX_REVIEW_MEDIA - reviewMediaDraftsRef.current.length
    if (remainingSlots <= 0) {
      setError('You can add up to ' + MAX_REVIEW_MEDIA + ' photos or videos to a review.')
      return
    }

    const accepted: ReviewMediaDraft[] = []
    const rejected: string[] = []
    for (const file of files.slice(0, remainingSlots)) {
      try {
        const prepared = await prepareReviewMediaFile(file)
        const normalizedType = prepared.type.split(';')[0]?.trim().toLowerCase()
        accepted.push({
          id: [prepared.name, prepared.size, Date.now(), accepted.length].join(':'),
          file: prepared,
          previewUrl: URL.createObjectURL(prepared),
          type: isVideoContentType(normalizedType) ? 'video' : 'image',
        })
      } catch (mediaError) {
        rejected.push(
          mediaError instanceof Error
            ? mediaError.message
            : 'That media file could not be prepared.'
        )
      }
    }

    if (accepted.length > 0) {
      setReviewMediaDrafts((current) => [...current, ...accepted].slice(0, MAX_REVIEW_MEDIA))
    }
    if (rejected.length > 0) {
      setError(Array.from(new Set(rejected)).join(' '))
    }
  }

  function removeReviewMediaDraft(id: string) {
    setReviewMediaDrafts((current) => {
      const removed = current.find((draft) => draft.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((draft) => draft.id !== id)
    })
  }

  async function submitReview() {
    setError(null)
    setSuccess(null)
    const leak = assertNoContactLeak(
      [body, tags].join('\n'),
      "Reviews can't include contact details."
    )
    if (leak) {
      setError(leak)
      return
    }
    const reviewerName =
      data.customerProfile?.display_name || data.tailorProfile?.display_name || 'Drapeon customer'
    setBusy(true)
    try {
      if (reviewMediaDraftsRef.current.length > 0 && !data.userId) {
        throw new Error('Sign in again before attaching review media.')
      }
      const mediaUrls: string[] = []
      for (const draft of reviewMediaDraftsRef.current) {
        mediaUrls.push(
          await uploadPublicFile(
            'review-media',
            'reviews/' + order.id + '/' + data.userId,
            draft.file
          )
        )
      }
      await invokeAccountFunction('review-action', {
        action: 'submit-tailor-review',
        orderId: order.id,
        reviewerName,
        rating,
        body: body.trim() || undefined,
        tags: splitList(tags),
        mediaUrls,
      })
      setSuccess('Review submitted. It may be held briefly if moderation needs to check the text.')
      setBody('')
      setReviewMediaDrafts((current) => {
        for (const draft of current) URL.revokeObjectURL(draft.previewUrl)
        return []
      })
      onRefresh()
    } catch (reviewError) {
      setError(friendlyActionError(reviewError, 'Review could not be submitted.'))
    } finally {
      setBusy(false)
    }
  }

  const ratingLabels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent']
  return (
    <section className="overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm">
      <div className="bg-needle/6 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          Leave a review
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-ink">Rate this tailor</h2>
        <p className="mt-1.5 text-sm leading-6 text-ink/62">
          Your review helps future customers understand fit quality, communication, and delivery.
        </p>
      </div>
      <div className="p-6">
        <div className="grid gap-5">
          <ActionNotice error={error} success={success} />
          <div>
            <p className="text-sm font-semibold text-ink">Rating</p>
            <div className="mt-2 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className={`p-0.5 text-3xl leading-none transition ${star <= rating ? 'text-amber-400' : 'text-ink/16 hover:text-amber-200'}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-sm font-semibold text-ink/52">{ratingLabels[rating]}</span>
            </div>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">
              Tags <span className="font-normal text-ink/40">(comma-separated)</span>
            </span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Fit matched, Clear communication"
              className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">
              Review <span className="font-normal text-ink/40">(optional)</span>
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Share your experience..."
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
          </label>
          <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-bone/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">Photos or video</p>
                <p className="mt-0.5 text-xs text-ink/48">
                  Add up to {MAX_REVIEW_MEDIA}. Videos must be 30 seconds or less.
                </p>
              </div>
              <label
                className={`inline-flex cursor-pointer items-center rounded-full border border-needle/20 px-4 py-2 text-sm font-semibold text-needle transition hover:bg-needle/8 ${reviewMediaDrafts.length >= MAX_REVIEW_MEDIA || busy ? 'pointer-events-none opacity-45' : ''}`}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  multiple
                  className="sr-only"
                  disabled={reviewMediaDrafts.length >= MAX_REVIEW_MEDIA || busy}
                  onChange={(event) => {
                    void handleReviewMediaFiles(event)
                  }}
                />
                {reviewMediaDrafts.length > 0 ? 'Add more' : 'Add media'}
              </label>
            </div>
            {reviewMediaDrafts.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {reviewMediaDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[8px] bg-ink/8"
                  >
                    {draft.type === 'video' ? (
                      <MutedVideo
                        src={draft.previewUrl}
                        className="h-full w-full object-cover"
                        autoPlay={false}
                        loop={false}
                        showMuteToggle={false}
                      />
                    ) : (
                      <img
                        src={draft.previewUrl}
                        alt="Review attachment preview"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeReviewMediaDraft(draft.id)}
                      className="absolute right-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold text-ink shadow-sm"
                      aria-label="Remove review media"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={submitReview}
            disabled={busy}
            className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
          >
            {busy ? 'Submitting...' : 'Submit review'}
          </button>
        </div>
      </div>
    </section>
  )
}
