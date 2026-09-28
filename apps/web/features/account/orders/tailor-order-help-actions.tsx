'use client'

import type { Dispatch, SetStateAction } from 'react'
import { DisclosurePanel } from '../messages/message-foundation'
import {
  TAILOR_CANCELLATION_REASON_OPTIONS,
  TAILOR_DELIVERY_REASON_OPTIONS,
} from './order-action-helpers'

type CancellationReason = (typeof TAILOR_CANCELLATION_REASON_OPTIONS)[number]['value']
type DeliveryReason = (typeof TAILOR_DELIVERY_REASON_OPTIONS)[number]['value']

type Props = {
  canConfirmCollection: boolean
  pickupCode: string
  setPickupCode: Dispatch<SetStateAction<string>>
  confirmCollection: () => Promise<void>
  busy: string | null
  canDeclineOrder: boolean
  canRequestCancellationReview: boolean
  canRequestDeliveryReview: boolean
  declineNote: string
  setDeclineNote: Dispatch<SetStateAction<string>>
  declineOrder: () => Promise<void>
  declineArmed: boolean
  tailorCancellationReason: CancellationReason
  setTailorCancellationReason: Dispatch<SetStateAction<CancellationReason>>
  tailorCancellationNote: string
  setTailorCancellationNote: Dispatch<SetStateAction<string>>
  requestTailorCancellationReview: () => Promise<void>
  tailorDeliveryReason: DeliveryReason
  setTailorDeliveryReason: Dispatch<SetStateAction<DeliveryReason>>
  tailorDeliveryNote: string
  setTailorDeliveryNote: Dispatch<SetStateAction<string>>
  requestTailorDeliveryReview: () => Promise<void>
}

export function TailorOrderHelpActions(props: Props) {
  const {
    canConfirmCollection,
    pickupCode,
    setPickupCode,
    confirmCollection,
    busy,
    canDeclineOrder,
    canRequestCancellationReview,
    canRequestDeliveryReview,
    declineNote,
    setDeclineNote,
    declineOrder,
    declineArmed,
    tailorCancellationReason,
    setTailorCancellationReason,
    tailorCancellationNote,
    setTailorCancellationNote,
    requestTailorCancellationReview,
    tailorDeliveryReason,
    setTailorDeliveryReason,
    tailorDeliveryNote,
    setTailorDeliveryNote,
    requestTailorDeliveryReview,
  } = props
  return (
    <>
      {canConfirmCollection ? (
        <DisclosurePanel
          title="Confirm collection"
          summary="Enter the customer pickup code to close local collection."
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={pickupCode}
              onChange={(event) => setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="4-digit pickup code"
              className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
            />
            <button
              type="button"
              onClick={() => {
                void confirmCollection()
              }}
              disabled={busy === 'confirm-collection'}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
            >
              {busy === 'confirm-collection' ? 'Confirming...' : 'Confirm collection'}
            </button>
          </div>
        </DisclosurePanel>
      ) : null}

      {canDeclineOrder || canRequestCancellationReview || canRequestDeliveryReview ? (
        <DisclosurePanel
          title="Help & order options"
          summary="Shipping support, decline, and reviewed cancellation options stay secondary to the current production action."
        >
          <div className="grid gap-4">
            {canDeclineOrder ? (
              <div className="order-[30] grid gap-3 border-t border-ink/6 pt-4">
                <h3 className="font-semibold text-ink">Decline order</h3>
                <textarea
                  value={declineNote}
                  onChange={(event) => setDeclineNote(event.target.value)}
                  rows={2}
                  placeholder="Optional note"
                  className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    void declineOrder()
                  }}
                  disabled={busy === 'decline-order'}
                  className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busy === 'decline-order'
                    ? 'Declining...'
                    : declineArmed
                      ? 'Confirm decline'
                      : 'Decline order'}
                </button>
              </div>
            ) : null}

            {canRequestCancellationReview ? (
              <div className="order-[40] grid gap-3 border-t border-ink/6 pt-4">
                <h3 className="font-semibold text-ink">Cancellation review</h3>
                <select
                  value={tailorCancellationReason}
                  onChange={(event) =>
                    setTailorCancellationReason(
                      event.target.value as typeof tailorCancellationReason
                    )
                  }
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                >
                  {TAILOR_CANCELLATION_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={tailorCancellationNote}
                  onChange={(event) => setTailorCancellationNote(event.target.value)}
                  rows={2}
                  placeholder="Add context for Drapeon."
                  className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    void requestTailorCancellationReview()
                  }}
                  disabled={busy === 'request-cancellation-review'}
                  className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busy === 'request-cancellation-review'
                    ? 'Opening...'
                    : 'Open cancellation review'}
                </button>
              </div>
            ) : null}

            {canRequestDeliveryReview ? (
              <div className="order-[20] grid gap-3">
                <h3 className="font-semibold text-ink">Shipping &amp; delivery help</h3>
                <select
                  value={tailorDeliveryReason}
                  onChange={(event) =>
                    setTailorDeliveryReason(event.target.value as typeof tailorDeliveryReason)
                  }
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                >
                  {TAILOR_DELIVERY_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={tailorDeliveryNote}
                  onChange={(event) => setTailorDeliveryNote(event.target.value)}
                  rows={2}
                  placeholder="What went wrong with dispatch or delivery?"
                  className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    void requestTailorDeliveryReview()
                  }}
                  disabled={busy === 'request-delivery-review'}
                  className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busy === 'request-delivery-review' ? 'Sending...' : 'Send to Drapeon'}
                </button>
              </div>
            ) : null}
          </div>
        </DisclosurePanel>
      ) : null}
    </>
  )
}
