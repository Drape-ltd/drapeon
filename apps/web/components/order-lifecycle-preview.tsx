'use client'

import { Check, CircleDollarSign, Package, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

type Role = 'customer' | 'tailor'
type OrderKind = 'custom' | 'ready-made'

type TimelineStage = {
  key: string
  label: string
  customerTitle: string
  tailorTitle: string
  customerBody: string
  tailorBody: string
  payout: string
}

const TIMELINES: Record<OrderKind, readonly TimelineStage[]> = {
  custom: [
    {
      key: 'QUOTE_APPROVED',
      label: 'Quote approved',
      customerTitle: 'Quote approved',
      tailorTitle: 'Quote accepted',
      customerBody: 'The agreed construction, materials, timing, and fulfilment are attached to this order.',
      tailorBody: 'The customer approved the structured quote. Keep every decision in this order thread.',
      payout: 'Not started',
    },
    {
      key: 'PAYMENT_PROTECTED',
      label: 'Payment protected',
      customerTitle: 'Payment protected',
      tailorTitle: 'Funds protected',
      customerBody: 'Payment is confirmed and held under Drapeon’s protection rules while the work begins.',
      tailorBody: 'Payment is protected. Payout is not released until the handoff and provider checks are complete.',
      payout: 'Protected — not released',
    },
    {
      key: 'IN_PRODUCTION',
      label: 'In production',
      customerTitle: 'In production',
      tailorTitle: 'Work in progress',
      customerBody: 'Follow the agreed production stages, evidence, messages, and any approved changes here.',
      tailorBody: 'Post the useful progress update and evidence to the same order so the customer can follow along.',
      payout: 'Protected — not released',
    },
    {
      key: 'HANDOFF_CONFIRMED',
      label: 'Handoff confirmed',
      customerTitle: 'Handoff confirmed',
      tailorTitle: 'Completion recorded',
      customerBody: 'The delivery, collection, or receipt confirmation is recorded. You can get help or leave feedback.',
      tailorBody: 'The handoff is recorded. Earnings are eligible for release only after the remaining checks pass.',
      payout: 'Eligible — provider confirmation pending',
    },
    {
      key: 'PAYOUT_RELEASED',
      label: 'Complete',
      customerTitle: 'Order complete',
      tailorTitle: 'Earnings released',
      customerBody: 'Your order timeline, support date, and feedback path remain available after completion.',
      tailorBody: 'The provider-confirmed release is recorded separately from order completion in earnings.',
      payout: 'Released — provider confirmed',
    },
  ],
  'ready-made': [
    {
      key: 'ORDER_PLACED',
      label: 'Order placed',
      customerTitle: 'Order placed',
      tailorTitle: 'Ready-made order received',
      customerBody: 'Your item, size, fulfilment choice, and payment state are attached to this order.',
      tailorBody: 'The item and fulfilment choice are clear. No custom-production stages are implied.',
      payout: 'Not started',
    },
    {
      key: 'PAYMENT_PROTECTED',
      label: 'Payment protected',
      customerTitle: 'Payment protected',
      tailorTitle: 'Funds protected',
      customerBody: 'Payment is confirmed and held under Drapeon’s protection rules until the handoff.',
      tailorBody: 'Payment is protected. Keep the ready-made item and fulfilment state current.',
      payout: 'Protected — not released',
    },
    {
      key: 'DISPATCHED',
      label: 'Dispatched',
      customerTitle: 'Dispatched',
      tailorTitle: 'Item dispatched',
      customerBody: 'Tracking or collection details are shown from the order record.',
      tailorBody: 'Dispatch evidence and the exact tracking or collection details are attached to the order.',
      payout: 'Protected — not released',
    },
    {
      key: 'HANDOFF_CONFIRMED',
      label: 'Handoff confirmed',
      customerTitle: 'Handoff confirmed',
      tailorTitle: 'Completion recorded',
      customerBody: 'Confirm receipt or collection. Get help remains available if something is wrong.',
      tailorBody: 'Receipt or collection is recorded. Earnings are eligible only after provider checks.',
      payout: 'Eligible — provider confirmation pending',
    },
    {
      key: 'PAYOUT_RELEASED',
      label: 'Complete',
      customerTitle: 'Order complete',
      tailorTitle: 'Earnings released',
      customerBody: 'The completed item stays in your order history with its support and feedback path.',
      tailorBody: 'Provider-confirmed release is shown in earnings separately from the delivered state.',
      payout: 'Released — provider confirmed',
    },
  ],
}

export function OrderLifecyclePreview(): React.JSX.Element {
  const [role, setRole] = useState<Role>('customer')
  const [kind, setKind] = useState<OrderKind>('custom')
  const [activeIndex, setActiveIndex] = useState(0)
  const [payoutBlocked, setPayoutBlocked] = useState(false)
  const timeline = TIMELINES[kind]
  const stage = (timeline[activeIndex] ?? timeline[0]) as TimelineStage
  const isTailor = role === 'tailor'
  const atEnd = activeIndex === timeline.length - 1
  const statusCopy = useMemo(() => {
    if (payoutBlocked) return 'Payout is held safely while provider confirmation is pending.'
    if (atEnd) return 'Order completion and payout release are shown as separate events.'
    return 'Advance the preview to inspect the next authoritative order state.'
  }, [atEnd, payoutBlocked])

  function reset(nextKind = kind, nextRole = role) {
    setKind(nextKind)
    setRole(nextRole)
    setActiveIndex(0)
    setPayoutBlocked(false)
  }

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
          <h1 className="mt-3 text-4xl leading-tight">One order thread, through handoff and payout.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/65">
            This local preview makes the customer and tailor views explicit. It does not mutate an
            order, move money, or call a payment provider.
          </p>

          <div className="mt-6 grid gap-4 rounded-[8px] border border-ui-border bg-ui-muted p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">View as</p>
              <div className="mt-2 inline-flex rounded-full border border-ui-border bg-white p-1" role="tablist" aria-label="Choose order timeline role">
                {(['customer', 'tailor'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={role === item}
                    onClick={() => reset(kind, item)}
                    className={`min-h-10 rounded-full px-4 text-sm font-semibold capitalize ${role === item ? 'bg-needle text-white' : 'text-ink/55'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Order type</p>
              <div className="mt-2 inline-flex rounded-full border border-ui-border bg-white p-1" role="tablist" aria-label="Choose order type">
                {(['custom', 'ready-made'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={kind === item}
                    onClick={() => reset(item, role)}
                    className={`min-h-10 rounded-full px-4 text-sm font-semibold ${kind === item ? 'bg-needle text-white' : 'text-ink/55'}`}
                  >
                    {item === 'ready-made' ? 'Ready-made' : 'Custom'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section className="mt-6 rounded-[8px] border border-ui-border bg-white p-5" data-testid="order-lifecycle-timeline">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">{isTailor ? 'Tailor order view' : 'Customer order view'}</p>
                <h2 className="mt-1 text-2xl font-semibold text-ink">{stage[isTailor ? 'tailorTitle' : 'customerTitle']}</h2>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle" data-testid="order-stage-label">
                <Package size={14} aria-hidden="true" /> {stage.label}
              </span>
            </div>

            <ol className="mt-6 grid gap-2 sm:grid-cols-5" aria-label="Order stages">
              {timeline.map((item, index) => {
                const reached = index <= activeIndex
                return (
                  <li key={item.key} data-testid={`order-stage-${item.key.toLowerCase()}`} className={`rounded-[8px] border px-3 py-3 text-xs font-semibold ${reached ? 'border-needle/20 bg-needle/8 text-needle' : 'border-ui-border bg-ui-muted text-ink/45'}`}>
                    <span className="flex items-center gap-1.5">
                      {reached ? <Check size={13} aria-hidden="true" /> : <span className="size-3 rounded-full border border-current" aria-hidden="true" />}
                      {item.label}
                    </span>
                  </li>
                )
              })}
            </ol>

            <p className="mt-5 max-w-2xl text-sm leading-7 text-ink/65" data-testid="order-stage-copy">
              {stage[isTailor ? 'tailorBody' : 'customerBody']}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[8px] border border-needle/15 bg-needle/5 p-4" data-testid="order-payment-boundary">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-needle"><ShieldCheck size={14} aria-hidden="true" /> Payment protection</p>
                <p className="mt-2 text-sm font-semibold text-ink">{stage.payout.startsWith('Not') ? 'Awaiting customer payment' : 'Protected while the order is active'}</p>
                <p className="mt-1 text-xs leading-5 text-ink/55">Completion never implies an automatic refund or instant payout.</p>
              </div>
              <div className={`rounded-[8px] border p-4 ${payoutBlocked ? 'border-rust/25 bg-rust/5' : 'border-ui-border bg-ui-muted'}`} data-testid="order-payout-status">
                <p className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] ${payoutBlocked ? 'text-rust' : 'text-ink/55'}`}><CircleDollarSign size={14} aria-hidden="true" /> Tailor payout</p>
                <p className="mt-2 text-sm font-semibold text-ink">{payoutBlocked ? 'On hold — provider confirmation pending' : stage.payout}</p>
                <p className="mt-1 text-xs leading-5 text-ink/55">Eligibility and provider-confirmed release are separate records.</p>
              </div>
            </div>

            {payoutBlocked ? <p role="alert" className="mt-4 rounded-[8px] border border-rust/20 bg-rust/5 px-4 py-3 text-sm font-semibold text-rust">{statusCopy} No customer action is required while Drapeon reviews the provider state.</p> : null}
            {!payoutBlocked && atEnd ? <p role="status" className="mt-4 rounded-[8px] border border-needle/20 bg-needle/5 px-4 py-3 text-sm font-semibold text-needle">{statusCopy}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => setActiveIndex((current) => Math.min(current + 1, timeline.length - 1))} disabled={atEnd || payoutBlocked} className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                {atEnd ? 'Timeline complete' : 'Advance order'}
              </button>
              <button
                type="button"
                onClick={() => setPayoutBlocked(true)}
                disabled={payoutBlocked || atEnd || activeIndex !== timeline.length - 2}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-rust/25 px-5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:opacity-45"
              >
                Simulate provider hold
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveIndex(0)
                  setPayoutBlocked(false)
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ui-border px-5 text-sm font-semibold text-ink/65"
              >
                Replay preview
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
