'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, ReactNode } from 'react'
import { ChevronDown, CircleHelp, LoaderCircle, MapPin, Truck, UserRound } from 'lucide-react'
import { StructuredAddressSearch } from '../../../components/structured-address-search'
import { friendlyActionError } from '@drape/shared/action-errors'
import { formatDate, formatMoney, formatRelative, dispatchBlockerCopy, deriveDispatchFulfillmentPresentation, deriveDispatchCustomerChargePresentation, isCompletedOrderStage, DispatchCustomerDecision, DispatchRunStatus } from '@drape/shared'
import { isVideoMediaUrl } from '@drape/shared/media-policy'
import { createClient } from '../../../lib/supabase'
import type { AccountOrder } from '../shared/account-data-contracts'
import { invokeAccountFunction } from '../shared/account-data-queries'
import { ActionNotice } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { MediaViewerDialog } from '../../../components/ui/media-viewer-dialog'
import { Textarea } from '../../../components/ui/textarea'

export function SummaryLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-ui-border bg-white p-4">
      <p className="text-xs font-semibold uppercase text-needle/72">{label}</p>
      <div className="mt-2 text-sm font-semibold text-ink">{value ?? 'Not set'}</div>
    </div>
  )
}

type AccountDispatchRun = {
  id: string
  order_id: string
  method: string
  status: DispatchRunStatus
  funding_status: string
  currency: string
  captured_allowance_amount: number
  actual_provider_cost_amount: number | null
  shortfall_subtotal_amount: number
  shortfall_tax_amount: number
  shortfall_fee_amount: number
  shortfall_total_amount: number
  customer_refund_amount: number
  customer_refund_tax_amount: number
  subsidy_restored_amount: number
  provider_name: string | null
  provider_quote_evidence: AccountDispatchEvidence[]
}

type AccountDispatchEvidence = {
  id: string
  signedUrl: string
  mimeType: string
  mediaType: 'IMAGE' | 'VIDEO' | string
  label: string
  expiresInSeconds: number
}

export type AccountDispatchState = {
  ok: boolean
  role: 'CUSTOMER' | 'TAILOR'
  paymentConfirmed?: boolean
  paymentReconciliationPending?: boolean
  currentMethod?: string | null
  canRequestDelivery?: boolean
  deliveryDetails?: {
    recipientName: string
    recipientPhone: string
    address: string
    city: string
    region: string
    postalCode: string
    countryCode: string
  }
  run: AccountDispatchRun | null
  parcels: Array<{
    id: string
    status: string
    provider_name: string | null
    tracking_number: string | null
    tracking_url: string | null
    eta_at: string | null
    last_location: {
      label?: string | null
      latitude?: number | null
      longitude?: number | null
    } | null
  }>
  events: Array<{
    id: string
    event_type: string
    customer_note: string | null
    occurred_at: string
    evidence_media: AccountDispatchEvidence[]
  }>
}

const accountDispatchStatusCopy: Record<DispatchRunStatus, { title: string; body: string }> = {
  QUOTE_REQUIRED: {
    title: 'Delivery price being confirmed',
    body: 'Drapeon is confirming the rider or carrier cost.',
  },
  AWAITING_CUSTOMER_DECISION: {
    title: 'Delivery choice needed',
    body: 'Review the provider price and choose how to continue.',
  },
  AWAITING_SHORTFALL_PAYMENT: {
    title: 'Extra delivery payment needed',
    body: 'Only the disclosed difference is due.',
  },
  READY_TO_BOOK: {
    title: 'Delivery funding ready',
    body: 'Drapeon can now book the rider or carrier.',
  },
  BOOKED: { title: 'Delivery booked', body: 'The rider or carrier has been arranged.' },
  IN_TRANSIT: { title: 'On the way', body: 'The latest delivery update appears below.' },
  DELIVERED: {
    title: 'Delivered',
    body: 'Delivery proof is recorded and reconciliation is underway.',
  },
  PICKUP_READY: {
    title: 'Ready for pickup',
    body: 'Use the collection instructions and code on this order.',
  },
  PICKED_UP: { title: 'Pickup complete', body: 'The collection handoff is recorded.' },
  CANCELLED: {
    title: 'Delivery cancelled',
    body: 'Any refundable delivery amount is returning automatically.',
  },
  EXCEPTION: {
    title: 'Delivery needs attention',
    body: 'Drapeon is resolving a provider or evidence issue.',
  },
  RECONCILED: {
    title: 'Delivery complete',
    body: 'Provider cost and customer funding are balanced.',
  },
}

const accountDispatchEventLabels: Record<string, string> = {
  QUOTE_RECORDED: 'Provider price confirmed',
  CHEAPER_OPTION_REQUESTED: 'Cheaper option requested',
  DISPATCH_OPTION_DECLINED: 'Delivery option declined',
  SHORTFALL_REQUESTED: 'Delivery payment requested',
  SHORTFALL_PAID: 'Delivery payment confirmed',
  PICKUP_SELECTED: 'Switched to pickup',
  BOOKED: 'Rider or carrier booked',
  CARRIER_ACCEPTED: 'Carrier accepted the parcel',
  COLLECTED: 'Parcel collected',
  AT_HUB: 'Parcel at carrier hub',
  IN_TRANSIT: 'Parcel in transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERY_ATTEMPTED: 'Delivery attempted',
  DELIVERED: 'Delivered',
  PICKUP_READY: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  RETURNING: 'Returning',
  RETURNED: 'Returned',
  CANCELLED: 'Delivery cancelled',
  REFUND_COMPLETED: 'Delivery refund completed',
  LOCAL_DELIVERY_REQUESTED: 'Local delivery requested',
  SHIPPING_REQUESTED: 'Shipping requested',
  EXCEPTION_RECORDED: 'Delivery issue recorded',
  RECONCILED: 'Delivery reconciled',
}

function AccountDispatchEvidenceGrid({
  items,
  label,
}: {
  items: AccountDispatchEvidence[]
  label: string
}) {
  if (items.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item, index) => {
        const video =
          item.mediaType === 'VIDEO' ||
          item.mimeType.startsWith('video/') ||
          isVideoMediaUrl(item.signedUrl)
        return (
          <MediaViewerDialog
            key={item.id}
            src={item.signedUrl}
            kind={video ? 'video' : 'image'}
            title={`${label} ${index + 1}`}
          >
            <button
              type="button"
              className="relative aspect-[4/3] overflow-hidden rounded-[8px] border border-ink/8 bg-bone text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
              aria-label={`Open ${label.toLowerCase()} ${index + 1}`}
            >
              {video ? (
                <video
                  src={item.signedUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="size-full object-cover"
                />
              ) : (
                <img
                  src={item.signedUrl}
                  alt={`${label} ${index + 1}`}
                  className="size-full object-cover"
                />
              )}
              <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">
                Open proof
              </span>
            </button>
          </MediaViewerDialog>
        )
      })}
    </div>
  )
}

export function AccountDrapeonDispatchCard({
  order,
  viewerRole,
  onRefresh,
  previewState,
}: {
  order: Pick<AccountOrder, 'id' | 'stage' | 'delivery_method'>
  viewerRole: 'CUSTOMER' | 'TAILOR'
  onRefresh: () => void
  previewState?: AccountDispatchState
}) {
  const completedOrder = isCompletedOrderStage(order.stage)
  const [state, setState] = useState<AccountDispatchState | null>(previewState ?? null)
  const [loading, setLoading] = useState(!previewState)
  const [busy, setBusy] = useState<DispatchCustomerDecision | null>(null)
  const [methodBusy, setMethodBusy] = useState<'LOCAL_DELIVERY' | 'SHIPPING' | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<'LOCAL_DELIVERY' | 'SHIPPING'>(
    'LOCAL_DELIVERY'
  )
  const [note, setNote] = useState('')
  const [deliveryDetails, setDeliveryDetails] = useState({
    recipientName: '',
    recipientPhone: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    countryCode: '',
  })
  const [deliveryDetailsDirty, setDeliveryDetailsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const dispatchDetailsRef = useRef<HTMLDetailsElement>(null)

  const refreshDispatch = useCallback(async () => {
    if (previewState) {
      setState(previewState)
      setLoading(false)
      return
    }
    if (completedOrder) {
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const result = await invokeAccountFunction<AccountDispatchState>('drapeon-dispatch-action', {
        action: 'get-state',
        orderId: order.id,
      })
      setState(result.ok ? result : null)
      if (!deliveryDetailsDirty && result.deliveryDetails)
        setDeliveryDetails(result.deliveryDetails)
    } catch (cause) {
      setLoadError(friendlyActionError(cause, 'Delivery status could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [completedOrder, deliveryDetailsDirty, order.id, previewState])

  useEffect(() => {
    if (previewState) return
    let active = true
    const initialRefresh = window.setTimeout(() => {
      if (active) void refreshDispatch()
    }, 0)
    const supabase = createClient()
    const channel = supabase
      .channel(`web:drapeon-dispatch:${order.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_fulfillment_runs',
          filter: `order_id=eq.${order.id}`,
        },
        () => {
          if (active) void refreshDispatch()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_fulfillment_parcels',
          filter: `order_id=eq.${order.id}`,
        },
        () => {
          if (active) void refreshDispatch()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_fulfillment_events',
          filter: `order_id=eq.${order.id}`,
        },
        () => {
          if (active) void refreshDispatch()
        }
      )
      .subscribe()
    return () => {
      active = false
      window.clearTimeout(initialRefresh)
      void supabase.removeChannel(channel)
    }
  }, [order.id, previewState, refreshDispatch])

  const run = state?.run ?? null
  const fulfillmentPresentation = deriveDispatchFulfillmentPresentation({
    orderMethod: state?.currentMethod ?? order.delivery_method,
    orderStage: order.stage,
    runMethod: run?.method,
    runStatus: run?.status,
  })
  if (completedOrder) return null
  if (loading && !run) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-14 w-full items-center gap-3 rounded-[8px] border border-needle/14 bg-white/86 px-4 py-3 shadow-sm"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-needle">
            Drapeon Dispatch
          </span>
          <span className="block text-sm font-semibold text-ink">Loading delivery status</span>
        </span>
      </div>
    )
  }
  if (loadError && !run) {
    return (
      <button
        type="button"
        className="flex min-h-14 w-full items-center gap-3 rounded-[8px] border border-rust/24 bg-rust/6 px-4 py-3 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
        onClick={() => {
          setLoading(true)
          void refreshDispatch()
        }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rust/10 text-rust">
          <CircleHelp className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-needle">
            Drapeon Dispatch
          </span>
          <span className="block text-sm font-semibold text-ink">Delivery status unavailable</span>
        </span>
        <span className="text-xs font-semibold text-needle">Retry</span>
      </button>
    )
  }
  async function requestDelivery(method: 'LOCAL_DELIVERY' | 'SHIPPING') {
    if (methodBusy) return
    const preparedDetails = {
      ...deliveryDetails,
      recipientName: deliveryDetails.recipientName.trim(),
      recipientPhone: deliveryDetails.recipientPhone.trim(),
      address: deliveryDetails.address.trim(),
      countryCode: deliveryDetails.countryCode.trim().toUpperCase(),
    }
    if (
      !preparedDetails.recipientName ||
      !preparedDetails.recipientPhone ||
      !preparedDetails.address ||
      preparedDetails.countryCode.length !== 2
    ) {
      setError(
        'Add the recipient and phone number, then choose an address from the search results.'
      )
      return
    }
    setMethodBusy(method)
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{ acknowledgement?: string }>(
        'drapeon-dispatch-action',
        {
          action: 'request-method-change',
          orderId: order.id,
          method,
          note: note.trim() || null,
          deliveryDetails: preparedDetails,
          idempotencyKey: `web:dispatch-method:${order.id}:${method}:${Date.now()}`,
        }
      )
      setNote('')
      setDeliveryDetailsDirty(false)
      setSuccess(result.acknowledgement ?? 'Your delivery request is saved.')
      await refreshDispatch()
      onRefresh()
    } catch (cause) {
      setError(
        friendlyActionError(
          cause,
          'Confirm the delivery address and recipient details, then try again.'
        )
      )
    } finally {
      setMethodBusy(null)
    }
  }

  const deliveryDetailsEditor = (
    <div
      className="grid gap-4 rounded-[8px] border border-ink/8 bg-white p-4 shadow-sm"
      style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
          <UserRound className="size-4" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink">Who should receive it?</span>
          <span className="block text-xs text-ink/55">
            Used by the rider or carrier for this order.
          </span>
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="sr-only">Recipient name</span>
          <input
            value={deliveryDetails.recipientName}
            onChange={(event) => {
              setDeliveryDetailsDirty(true)
              setDeliveryDetails((current) => ({ ...current, recipientName: event.target.value }))
            }}
            autoComplete="name"
            placeholder="Recipient name"
            aria-label="Recipient name"
            className="min-h-12 rounded-[8px] border border-ui-border bg-white px-3 text-base text-ink outline-none focus:border-needle/50"
          />
        </label>
        <PhoneNumberField
          value={deliveryDetails.recipientPhone}
          onValueChange={(recipientPhone) => {
            setDeliveryDetailsDirty(true)
            setDeliveryDetails((current) => ({ ...current, recipientPhone }))
          }}
          placeholder="Phone number"
          aria-label="Recipient phone number"
        />
      </div>
      <div className="h-px bg-ink/8" />
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
          <MapPin className="size-4" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink">Where is it going?</span>
          <span className="block text-xs text-ink/55">
            Search once. City, region, and country fill automatically.
          </span>
        </span>
      </div>
      <div>
        {deliveryDetails.address && deliveryDetails.countryCode.length === 2 ? (
          <div className="flex min-h-16 items-center gap-3 rounded-[8px] border border-needle/30 bg-needle/6 px-3 py-2.5">
            <MapPin className="size-4 shrink-0 text-needle" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-ink">
              {deliveryDetails.address}
            </span>
            <button
              type="button"
              className="min-h-10 shrink-0 px-2 text-xs font-bold text-needle"
              onClick={() => {
                setDeliveryDetailsDirty(true)
                setDeliveryDetails((current) => ({
                  ...current,
                  address: '',
                  city: '',
                  region: '',
                  postalCode: '',
                  countryCode: '',
                }))
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <StructuredAddressSearch
            onSelect={(selected) => {
              setDeliveryDetailsDirty(true)
              setDeliveryDetails((current) => ({
                ...current,
                address: selected.displayValue,
                city: selected.city,
                region: selected.stateRegion,
                postalCode: selected.postcode,
                countryCode: selected.countryCode ?? '',
              }))
            }}
          />
        )}
      </div>
    </div>
  )

  const deliveryMethodPicker = (
    <div className="grid gap-2">
      <div
        role="radiogroup"
        aria-label="Choose delivery method"
        className="grid grid-cols-2 gap-1 rounded-[8px] border border-ui-border bg-white p-1"
      >
        {(
          [
            ['LOCAL_DELIVERY', 'Local delivery'],
            ['SHIPPING', 'Shipping'],
          ] as const
        ).map(([value, label]) => {
          const selected = selectedMethod === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`min-h-11 rounded-[6px] px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35 ${selected ? 'bg-needle text-white' : 'text-needle hover:bg-needle/6'}`}
              onClick={() => setSelectedMethod(value)}
            >
              {label}
            </button>
          )
        })}
      </div>
      <p className="text-xs leading-5 text-ink/55">
        {selectedMethod === 'LOCAL_DELIVERY'
          ? 'For a nearby rider or local delivery provider.'
          : 'For a carrier shipping across regions or countries.'}
      </p>
    </div>
  )

  if (!run) {
    if (
      viewerRole !== 'CUSTOMER' ||
      state?.currentMethod !== 'LOCAL_COLLECTION' ||
      !state.canRequestDelivery
    )
      return null
    return (
      <details className="group w-full rounded-[8px] border border-needle/14 bg-white/86 shadow-sm">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
            <Truck className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-needle">
              Fulfilment
            </span>
            <span className="block text-sm font-semibold text-ink">
              Need delivery instead of pickup?
            </span>
          </span>
          <ChevronDown
            className="size-4 text-ink/45 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="grid gap-3 border-t border-ink/8 p-4">
          <div className="rounded-[8px] border border-needle/14 bg-needle/6 px-3 py-2.5">
            <p className="text-sm font-semibold text-ink">Replace pickup with delivery</p>
            <p className="mt-0.5 text-xs leading-5 text-ink/58">
              Saving this request retires the collection code. You will see provider proof and any
              price difference before payment.
            </p>
          </div>
          {deliveryMethodPicker}
          {deliveryDetailsEditor}
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Optional delivery note"
          />
          <ActionNotice error={error} success={success} />
          <Button
            disabled={!!methodBusy}
            onClick={() => {
              void requestDelivery(selectedMethod)
            }}
          >
            {methodBusy === selectedMethod
              ? 'Requesting…'
              : selectedMethod === 'LOCAL_DELIVERY'
                ? 'Request local delivery'
                : 'Request shipping'}
          </Button>
        </div>
      </details>
    )
  }
  const parcel = state?.parcels[0] ?? null
  const currentLocation =
    parcel?.last_location?.label?.trim() ||
    (typeof parcel?.last_location?.latitude === 'number' &&
    typeof parcel?.last_location?.longitude === 'number'
      ? `${parcel.last_location.latitude.toFixed(4)}, ${parcel.last_location.longitude.toFixed(4)}`
      : null)
  const decisionNeeded = viewerRole === 'CUSTOMER' && run.status === 'AWAITING_CUSTOMER_DECISION'
  const pickupRecoveryAvailable =
    viewerRole === 'CUSTOMER' &&
    ['QUOTE_REQUIRED', 'AWAITING_SHORTFALL_PAYMENT', 'READY_TO_BOOK'].includes(run.status)
  const paymentNeeded =
    viewerRole === 'CUSTOMER' &&
    run.status === 'AWAITING_SHORTFALL_PAYMENT' &&
    !state?.paymentConfirmed
  const paymentUpdating = run.status === 'AWAITING_SHORTFALL_PAYMENT' && !!state?.paymentConfirmed
  const chargePresentation = deriveDispatchCustomerChargePresentation(run.captured_allowance_amount)
  const presentation = paymentUpdating
    ? {
        title: 'Delivery payment received',
        body: 'Drapeon Dispatch is confirming the provider record. You will not be charged again.',
      }
    : fulfillmentPresentation.replacementPending && run.status === 'QUOTE_REQUIRED'
      ? {
          title: 'Delivery requested',
          body: 'Delivery has replaced pickup. Drapeon is confirming the provider price and proof.',
        }
      : run.status === 'AWAITING_SHORTFALL_PAYMENT'
        ? {
            title: chargePresentation.paymentStatusTitle,
            body: chargePresentation.paymentStatusBody,
          }
        : accountDispatchStatusCopy[run.status]
  const refund = run.customer_refund_amount + run.customer_refund_tax_amount
  const deliveryQuoteIsCurrent = !['PICKUP_READY', 'CANCELLED'].includes(run.status)

  async function decide(decision: DispatchCustomerDecision) {
    if (busy) return
    setBusy(decision)
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{ acknowledgement?: string }>(
        'drapeon-dispatch-action',
        {
          action: 'decide-quote',
          orderId: order.id,
          decision,
          note: note.trim() || null,
          idempotencyKey: `web:dispatch:${order.id}:${decision}:${Date.now()}`,
        }
      )
      setNote('')
      setSuccess(result.acknowledgement ?? 'Your delivery choice is saved.')
      await refreshDispatch()
      onRefresh()
      if (decision === 'SWITCH_TO_PICKUP') dispatchDetailsRef.current?.removeAttribute('open')
    } catch (cause) {
      setError(
        friendlyActionError(cause, 'The delivery choice could not be saved. Refresh and try again.')
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <details
      ref={dispatchDetailsRef}
      className={`group w-full rounded-[8px] border bg-white/86 shadow-sm ${decisionNeeded || paymentNeeded || run.status === 'EXCEPTION' ? 'border-rust/24' : 'border-needle/14'}`}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
          <Truck className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-needle">
            Drapeon Dispatch
          </span>
          <span className="block truncate text-sm font-semibold text-ink">
            {presentation.title}
          </span>
        </span>
        {decisionNeeded || paymentNeeded ? (
          <span className="size-2 rounded-full bg-rust" aria-hidden="true" />
        ) : null}
        <ChevronDown
          className="size-4 shrink-0 text-ink/45 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="grid gap-4 border-t border-ink/8 p-4">
        {loadError ? (
          <ActionNotice
            error="Latest delivery update could not load. Retry from the collapsed delivery row."
            success={null}
          />
        ) : null}
        <div className="rounded-[8px] bg-needle/8 p-4">
          <h3 className="text-lg font-semibold text-ink">{presentation.title}</h3>
          <p className="mt-1 text-sm leading-6 text-ink/62">{presentation.body}</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {parcel?.provider_name || run.provider_name ? (
              <SummaryLine
                label="Provider"
                value={parcel?.provider_name ?? run.provider_name ?? ''}
              />
            ) : null}
            {parcel?.tracking_number ? (
              <SummaryLine label="Tracking" value={parcel.tracking_number} />
            ) : null}
            {parcel?.eta_at ? (
              <SummaryLine
                label="Estimated arrival"
                value={formatDate(parcel.eta_at) ?? 'Pending'}
              />
            ) : null}
            {currentLocation ? (
              <SummaryLine label="Current location" value={currentLocation} />
            ) : null}
          </div>
        </div>

        {deliveryQuoteIsCurrent && run.actual_provider_cost_amount != null ? (
          <div className="grid gap-2 rounded-[8px] border border-ink/8 p-4 text-sm">
            <h3 className="mb-1 font-semibold text-ink">Delivery price</h3>
            <AccountDispatchEvidenceGrid
              items={run.provider_quote_evidence ?? []}
              label="Provider quote proof"
            />
            {chargePresentation.isTopUp ? (
              <SummaryLine
                label="Protected delivery allowance"
                value={formatMoney(run.captured_allowance_amount, run.currency)}
              />
            ) : null}
            <SummaryLine
              label="Provider price"
              value={formatMoney(run.actual_provider_cost_amount, run.currency)}
            />
            {chargePresentation.isTopUp && run.shortfall_subtotal_amount > 0 ? (
              <SummaryLine
                label={chargePresentation.subtotalLabel}
                value={formatMoney(run.shortfall_subtotal_amount, run.currency)}
              />
            ) : null}
            {run.shortfall_tax_amount > 0 ? (
              <SummaryLine
                label={chargePresentation.taxLabel}
                value={formatMoney(run.shortfall_tax_amount, run.currency)}
              />
            ) : null}
            {run.shortfall_fee_amount > 0 ? (
              <SummaryLine
                label="Payment fee"
                value={formatMoney(run.shortfall_fee_amount, run.currency)}
              />
            ) : null}
            {run.shortfall_total_amount > 0 ? (
              <SummaryLine
                label="Due now"
                value={<strong>{formatMoney(run.shortfall_total_amount, run.currency)}</strong>}
              />
            ) : null}
            {refund > 0 ? (
              <SummaryLine
                label="Returning to customer"
                value={<strong>{formatMoney(refund, run.currency)}</strong>}
              />
            ) : null}
            <p className="pt-1 text-xs leading-5 text-ink/52">
              Delivery money is separate from the tailor&apos;s earnings.
            </p>
          </div>
        ) : null}

        <ActionNotice error={error} success={success} />

        {paymentUpdating ? (
          <p
            role="status"
            className="rounded-[8px] border border-needle/14 bg-needle/6 p-4 text-sm leading-6 text-ink/66"
          >
            Delivery payment received. Drapeon Dispatch is reconciling the provider confirmation;
            you will not be charged again.
          </p>
        ) : null}

        {decisionNeeded ? (
          <div className="grid gap-3">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Optional note for Drapeon Dispatch"
            />
            <p className="text-sm leading-6 text-ink/62">{chargePresentation.decisionBody}</p>
            <Button
              disabled={!!busy}
              onClick={() => {
                void decide('PAY_SHORTFALL')
              }}
            >
              {busy === 'PAY_SHORTFALL'
                ? 'Saving…'
                : `Pay ${formatMoney(run.shortfall_total_amount, run.currency)} ${chargePresentation.actionSuffix}`}
            </Button>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => {
                  void decide('REQUEST_CHEAPER_OPTION')
                }}
              >
                Find a cheaper option
              </Button>
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => {
                  void decide('SWITCH_TO_PICKUP')
                }}
              >
                Switch to pickup
              </Button>
              <Button
                variant="destructive"
                disabled={!!busy}
                onClick={() => {
                  void decide('DECLINE_DISPATCH')
                }}
              >
                Decline delivery
              </Button>
            </div>
          </div>
        ) : null}

        {pickupRecoveryAvailable ? (
          <div className="grid gap-2 rounded-[8px] border border-ink/8 p-4">
            <h3 className="font-semibold text-ink">Prefer pickup?</h3>
            <p className="text-sm leading-6 text-ink/62">
              Switch back before the provider is booked. Delivery stops, any eligible delivery money
              is returned, and a fresh pickup code appears when the order is ready.
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={!!busy}
                onClick={() => {
                  void decide('SWITCH_TO_PICKUP')
                }}
              >
                Switch back to pickup
              </Button>
            </div>
          </div>
        ) : null}

        {paymentNeeded ? (
          <div className="rounded-[8px] border border-needle/14 bg-needle/6 p-4">
            <h3 className="font-semibold text-ink">{chargePresentation.paymentTitle}</h3>
            <p className="mt-1 text-sm leading-6 text-ink/62">{chargePresentation.paymentBody}</p>
            <div className="mt-3">
              <Link
                href={`/account/checkout/${order.id}?phase=FULFILLMENT`}
                className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-needle/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
              >
                Review delivery payment
              </Link>
            </div>
          </div>
        ) : null}

        {viewerRole === 'CUSTOMER' &&
        state?.canRequestDelivery &&
        ['PICKUP_READY', 'CANCELLED'].includes(run.status) ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/14 bg-needle/6 p-4">
            <div>
              <h3 className="font-semibold text-ink">Need delivery instead?</h3>
              <p className="mt-1 text-sm leading-6 text-ink/62">
                Add the order-specific destination, then request a provider quote. Saving the
                request retires the collection code.
              </p>
            </div>
            {deliveryMethodPicker}
            {deliveryDetailsEditor}
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="Optional delivery note"
            />
            <Button
              disabled={!!methodBusy}
              onClick={() => {
                void requestDelivery(selectedMethod)
              }}
            >
              {methodBusy === selectedMethod
                ? 'Requesting…'
                : selectedMethod === 'LOCAL_DELIVERY'
                  ? 'Request local delivery'
                  : 'Request shipping'}
            </Button>
          </div>
        ) : null}

        {run.status === 'EXCEPTION' ? (
          <p className="rounded-[8px] border border-rust/18 bg-rust/8 p-4 text-sm leading-6 text-ink/66">
            {dispatchBlockerCopy('OPEN_FULFILLMENT_EXCEPTION').action} Drapeon records the provider
            outcome before retrying money movement.
          </p>
        ) : null}

        {(state?.events.length ?? 0) > 0 ? (
          <div className="grid gap-3">
            <h3 className="font-semibold text-ink">Delivery history</h3>
            {state?.events.map((event) => (
              <div
                key={event.id}
                className="grid grid-cols-[8px_1fr] gap-3 border-t border-ink/8 pt-3"
              >
                <span className="mt-1.5 size-2 rounded-full bg-needle" aria-hidden="true" />
                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {accountDispatchEventLabels[event.event_type] ?? 'Delivery updated'}
                  </p>
                  {event.customer_note ? (
                    <p className="text-sm text-ink/60">{event.customer_note}</p>
                  ) : null}
                  <AccountDispatchEvidenceGrid
                    items={event.evidence_media ?? []}
                    label="Delivery update proof"
                  />
                  <p className="text-xs text-ink/45">
                    {formatRelative(event.occurred_at)} · shown in your timezone
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  )
}
