'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Search, WalletCards } from 'lucide-react'
import { friendlyActionError } from '@drape/shared/action-errors'
import { CONTACTS, payoutBlockRecovery, payoutBlockReasonMessage, formatDate, formatMoney, formatRelative, derivePayoutDeliveryState, payoutDeliveryExplanation, payoutDeliveryLabel, formatPayoutPurpose } from '@drape/shared'
import type { AccountOrder, AccountPayout, EarningsRenderData, PayoutRenderData, TailorProfile } from '../shared/account-data-contracts'
import { invokeAccountFunction, isPayoutReady } from '../shared/account-data-queries'
import { ActionNotice, EmptyState, cleanLabel, orderTitle, timestampMs } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { DataTable } from '../../../components/ui/data-table'
import { Input } from '../../../components/ui/input'
import { MetricCard } from '../../../components/ui/metric-card'
import { SegmentedControl } from '../../../components/ui/segmented-control'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'

function payoutBlockedReasonCopy(value: string | null | undefined) {
  if (!value) return null
  try {
    return payoutBlockReasonMessage(value as Parameters<typeof payoutBlockReasonMessage>[0])
  } catch {
    return cleanLabel(value, 'Blocked')
  }
}

function payoutBlockedRecovery(value: string | null | undefined, orderId: string | null) {
  if (!value) return null
  const recovery = payoutBlockRecovery(value as Parameters<typeof payoutBlockRecovery>[0])
  if (recovery.destination === 'PAYOUT_SETUP')
    return { ...recovery, href: '/account/payout' as Route }
  if ((recovery.destination === 'ORDER' || recovery.destination === 'OPS_REVIEW') && orderId) {
    return { ...recovery, href: `/account/orders/${orderId}` as Route }
  }
  return { ...recovery, href: null }
}

export function orderAmount(order: AccountOrder) {
  return formatMoney(
    order.total_amount ?? order.quoted_amount,
    order.currency ?? order.quoted_currency
  )
}

export function mailto(address: string, subject: string) {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`
}

export const NEEDS_ACTION_STAGES = new Set([
  'PENDING_QUOTE',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'IN_DISPUTE',
])

export const PRODUCTION_STAGES = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
])

export const DISPATCH_STAGES = new Set([
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
])

const DONE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE', 'COMPLETED'])

export const CLOSED_STAGES = new Set(['DECLINED', 'EXPIRED', 'REFUNDED', 'CANCELLED'])

const PROBLEM_STAGES = new Set(['PAYMENT_FAILED', 'IN_DISPUTE', 'REFUNDED', 'CANCELLED'])

function stagePillClass(stage: string | null | undefined) {
  if (PROBLEM_STAGES.has(stage ?? '')) return 'border-rust bg-rust text-white'
  if (NEEDS_ACTION_STAGES.has(stage ?? '')) return 'border-rust/18 bg-rust/12 text-rust'
  if (PRODUCTION_STAGES.has(stage ?? '')) return 'border-needle/14 bg-needle/10 text-needle'
  if (DISPATCH_STAGES.has(stage ?? '')) return 'border-sky-200 bg-sky-50 text-sky-700'
  if (DONE_STAGES.has(stage ?? '') || CLOSED_STAGES.has(stage ?? ''))
    return 'border-ink/8 bg-ink/6 text-ink/54'
  return 'border-ink/8 bg-white text-ink/62'
}

export function StagePill({ stage, label }: { stage: string | null | undefined; label?: string }) {
  return (
    <StatusChip
      status={label ?? stage}
      fallback="In progress"
      className={`w-fit shrink-0 whitespace-nowrap ${stagePillClass(stage)}`}
    />
  )
}

export function payoutStatusLabel(profile: TailorProfile | null) {
  if (!profile) return 'No tailor profile'
  if (profile.payout_reverification_required) return 'Reverification needed'
  if (isPayoutReady(profile)) return 'Ready'
  if (profile.manual_bank_entry)
    return `Manual bank ${cleanLabel(profile.manual_bank_verification_status, 'pending ops review')}`
  if (profile.payout_account_type === 'STRIPE_CONNECT' && profile.stripe_connect_account_id)
    return 'Stripe review needed'
  if (profile.payout_account_type === 'PAYSTACK' && profile.paystack_recipient_code)
    return 'Paystack review needed'
  return profile.is_live ? 'Checkout paused' : 'Payout pending'
}

type TxStatus =
  | 'PENDING'
  | 'AVAILABLE'
  | 'RELEASED'
  | 'IN_TRANSIT'
  | 'PAID_OUT'
  | 'BLOCKED'
  | 'FAILED'

type TxRecord = {
  orderId: string
  reference: string
  customer: string
  title: string
  orderAmount: number
  currency: string
  platformFee: number
  taxAmount: number
  netAmount: number
  status: TxStatus
  reason: string | null
  date: string
}

const NOT_PAID_ORDER_STAGES = new Set([
  'DRAFT',
  'QUOTED',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CANCELED',
  'EXPIRED',
])

function deriveTxStatus(
  order: AccountOrder,
  payouts: AccountPayout[]
): { status: TxStatus; reason: string | null } {
  const orderPayouts = payouts
    .filter((p) => p.order_id === order.id && p.payout_purpose === 'ORDER_EARNING')
    .sort((a, b) => timestampMs(b.initiated_at) - timestampMs(a.initiated_at))
  const latest = orderPayouts[0]
  if (latest) {
    const deliveryState = derivePayoutDeliveryState({
      provider: latest.provider,
      status: latest.status,
      providerTransferStatus: latest.provider_transfer_status,
      bankSettlementStatus: latest.bank_settlement_status,
    })
    if (deliveryState === 'PAID_TO_BANK') return { status: 'PAID_OUT', reason: null }
    if (deliveryState === 'IN_PROVIDER_BALANCE' || deliveryState === 'BANK_PAYOUT_PENDING') {
      return {
        status: 'IN_TRANSIT',
        reason: payoutDeliveryExplanation(deliveryState, latest.provider),
      }
    }
  }
  if (latest?.status === 'PROCESSING') return { status: 'RELEASED', reason: null }
  if (
    latest?.status === 'FAILED' ||
    latest?.status === 'REVERSED' ||
    latest?.status === 'CANCELED'
  ) {
    return { status: 'FAILED', reason: 'Payout transfer failed and needs ops review.' }
  }
  if (latest?.status === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      reason:
        payoutBlockedReasonCopy(latest.blocked_reason) ?? 'Payout is blocked and needs ops review.',
    }
  }
  const stage = (order.stage ?? '').toUpperCase()
  if (stage === 'REFUNDED') return { status: 'FAILED', reason: 'Order was refunded.' }
  if (stage === 'PARTIALLY_REFUNDED')
    return { status: 'BLOCKED', reason: 'Partial refund applied.' }
  if (stage === 'PAYMENT_FAILED' || stage === 'CANCELED') return { status: 'FAILED', reason: null }
  if (NOT_PAID_ORDER_STAGES.has(stage))
    return { status: 'PENDING', reason: 'Awaiting customer payment.' }
  if (order.escrow_released) return { status: 'RELEASED', reason: null }
  return { status: 'AVAILABLE', reason: null }
}

function txPillClass(status: TxStatus): string {
  switch (status) {
    case 'PAID_OUT':
      return 'border-needle/20 bg-needle/10 text-needle'
    case 'RELEASED':
      return 'border-needle/16 bg-needle/6 text-needle/80'
    case 'IN_TRANSIT':
      return 'border-blue-200 bg-blue-50 text-blue-700'
    case 'AVAILABLE':
      return 'border-blue-200 bg-blue-50 text-blue-700'
    case 'PENDING':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'BLOCKED':
      return 'border-rust/20 bg-rust/8 text-rust'
    case 'FAILED':
      return 'border-red-200 bg-red-50 text-red-700'
  }
}

function txStatusLabel(status: TxStatus): string {
  switch (status) {
    case 'PAID_OUT':
      return 'Paid out'
    case 'RELEASED':
      return 'Released'
    case 'IN_TRANSIT':
      return 'In transit'
    case 'AVAILABLE':
      return 'Available'
    case 'PENDING':
      return 'Pending'
    case 'BLOCKED':
      return 'Blocked'
    case 'FAILED':
      return 'Failed'
  }
}

function buildTxCsv(rows: TxRecord[]): string {
  const headers = [
    'Order ID',
    'Reference',
    'Customer',
    'Garment',
    'Customer Paid',
    'Platform Fee',
    'Tax',
    'Net Earnings',
    'Currency',
    'Status',
    'Date',
  ]
  const dataRows = rows.map((t) => [
    t.orderId,
    t.reference,
    t.customer,
    t.title,
    String(t.orderAmount / 100),
    String(t.platformFee / 100),
    String(t.taxAmount / 100),
    String(t.netAmount / 100),
    t.currency,
    t.status,
    t.date,
  ])
  return [headers, ...dataRows]
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

export function RenderEarnings({ data }: { data: EarningsRenderData }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'ALL'>('ALL')
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('all')
  const [now] = useState(() => Date.now())

  const allTransactions = useMemo<TxRecord[]>(() => {
    if (!data.tailorProfile) return []
    return data.orders.map((order) => {
      const { status, reason } = deriveTxStatus(order, data.payouts)
      const cp = order.customer_profiles
      const cpSingle = Array.isArray(cp) ? cp[0] : cp
      const customerFirst = (cpSingle?.display_name ?? 'Customer').split(/\s+/)[0] ?? 'Customer'
      return {
        orderId: order.id,
        reference: order.reference ?? order.id.slice(0, 8),
        customer: customerFirst,
        title: orderTitle(order),
        orderAmount: order.total_amount ?? 0,
        currency: order.currency ?? 'USD',
        platformFee: order.platform_fee_amount ?? 0,
        taxAmount: order.tax_amount ?? 0,
        netAmount: order.subtotal_amount ?? 0,
        status,
        reason,
        date: order.updated_at ?? order.created_at ?? '',
      }
    })
  }, [data.orders, data.payouts, data.tailorProfile])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allTransactions.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false
      if (range !== 'all') {
        const cutoff = now - Number(range) * 24 * 60 * 60 * 1000
        if (timestampMs(t.date) < cutoff) return false
      }
      if (!needle) return true
      return [t.reference, t.customer, t.title, t.orderId].some((v) =>
        v.toLowerCase().includes(needle)
      )
    })
  }, [allTransactions, statusFilter, range, search, now])

  const csvHref = useMemo(() => {
    if (filtered.length === 0) return '#'
    return `data:text/csv;charset=utf-8,${encodeURIComponent(buildTxCsv(filtered))}`
  }, [filtered])

  if (data.warning && !data.tailorProfile) {
    return (
      <EmptyState
        title="Earnings are temporarily unavailable."
        body="Your payout setup has not changed. Refresh to load the latest order income and payout activity."
        action={<Button onClick={() => window.location.reload()}>Try again</Button>}
      />
    )
  }

  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor earnings need a tailor profile."
        body="Apply for tailor access before web can show payout records, status breakdowns, and order-linked earnings."
        action={
          <Link href="/account/choose-role?next=%2Faccount%2Fprofile%3Fsetup%3D1" className="font-semibold text-needle">
            Apply as a tailor
          </Link>
        }
      />
    )
  }

  const summaryCurrency = data.tailorProfile.payout_currency ?? data.tailorProfile.currency ?? 'USD'
  const totalEarnings = allTransactions
    .filter((t) => t.status !== 'FAILED')
    .reduce((s, t) => s + t.netAmount, 0)
  const availableAmount = allTransactions
    .filter((t) => t.status === 'AVAILABLE' || t.status === 'RELEASED')
    .reduce((s, t) => s + t.netAmount, 0)
  const pendingAmount = allTransactions
    .filter((t) => t.status === 'PENDING' || t.status === 'BLOCKED')
    .reduce((s, t) => s + t.netAmount, 0)
  const paidOutAmount = allTransactions
    .filter((t) => t.status === 'PAID_OUT')
    .reduce((s, t) => s + t.netAmount, 0)
  const payoutReady = isPayoutReady(data.tailorProfile)
  const transactionColumns: ColumnDef<TxRecord>[] = [
    {
      accessorKey: 'reference',
      header: 'Order',
      cell: ({ row }) => (
        <div className="min-w-[13rem]">
          <Button asChild variant="link">
            <Link href={`/account/orders/${row.original.orderId}` as Route}>
              {row.original.title}
            </Link>
          </Button>
          <p className="mt-1 text-xs text-ui-subtle">
            #{row.original.reference} · {row.original.customer}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-ui-subtle">
          {formatDate(row.original.date) ?? 'Not recorded'}
        </span>
      ),
    },
    {
      accessorKey: 'orderAmount',
      header: 'Customer paid',
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-semibold">
          {formatMoney(row.original.orderAmount, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: 'platformFee',
      header: 'Platform fee',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatMoney(row.original.platformFee, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: 'taxAmount',
      header: 'Tax',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatMoney(row.original.taxAmount, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: 'netAmount',
      header: 'Net earnings',
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-semibold text-drape-green">
          {formatMoney(row.original.netAmount, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusChip
          status={txStatusLabel(row.original.status)}
          className={txPillClass(row.original.status)}
        />
      ),
    },
  ]

  return (
    <div className="grid gap-6">
      <Surface className="overflow-hidden">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(28rem,1fr)] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
              Eligible order earnings
            </p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">
              {formatMoney(availableAmount, summaryCurrency)}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink/52">
              Earnings currently eligible for payout or already moving to your bank.
            </p>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-ink/8 overflow-hidden rounded-xl border border-ui-border bg-bone/55">
            {(
              [
                ['Pending', formatMoney(pendingAmount, summaryCurrency)],
                ['Order earnings paid', formatMoney(paidOutAmount, summaryCurrency)],
                ['Total seller allocation', formatMoney(totalEarnings, summaryCurrency)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0 px-3 py-3 sm:px-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/42">
                  {label}
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-ink/8 px-5 py-3.5">
          <div
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${payoutReady ? 'bg-needle' : 'bg-amber-400'}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {data.tailorProfile.payout_bank_name
                ? `${data.tailorProfile.payout_bank_name}${data.tailorProfile.payout_account_masked ? ' · ' + data.tailorProfile.payout_account_masked : ''}`
                : 'Payout account'}
            </p>
            <p className="mt-0.5 text-xs text-ink/48">{payoutStatusLabel(data.tailorProfile)}</p>
          </div>
          {!payoutReady ? (
            <Button asChild size="sm">
              <Link href="/account/payout">Set up payout</Link>
            </Button>
          ) : null}
        </div>
      </Surface>

      {/* Transaction history */}
      <Surface className="min-w-0 max-w-full overflow-hidden">
        <SurfaceHeader
          eyebrow="Earnings"
          title="Transaction history"
          description="Order amounts, platform fees, tax, and net earnings in one sortable ledger."
          action={
            <Button
              asChild
              variant="secondary"
              size="sm"
              className={filtered.length === 0 ? 'pointer-events-none opacity-40' : ''}
            >
              <a href={csvHref} download="drapeon-earnings.csv">
                Export CSV
              </a>
            </Button>
          }
        />
        <div className="grid gap-3 p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order ID, reference, customer, or garment…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="overflow-x-auto pb-1">
              <SegmentedControl
                value={statusFilter}
                onChange={setStatusFilter}
                ariaLabel="Transaction status"
                options={(
                  [
                    'ALL',
                    'PENDING',
                    'AVAILABLE',
                    'RELEASED',
                    'PAID_OUT',
                    'BLOCKED',
                    'FAILED',
                  ] as const
                ).map((key) => ({
                  value: key,
                  label: key === 'ALL' ? 'All' : txStatusLabel(key as TxStatus),
                }))}
              />
            </div>
            <SegmentedControl
              value={range}
              onChange={setRange}
              ariaLabel="Transaction date range"
              options={(
                [
                  ['30', '30 days'],
                  ['90', '90 days'],
                  ['365', '1 year'],
                  ['all', 'All time'],
                ] as const
              ).map(([value, label]) => ({ value, label }))}
            />
          </div>

          <div className="min-w-0 max-w-full overflow-hidden">
            <DataTable
              columns={transactionColumns}
              data={filtered}
              emptyMessage={
                allTransactions.length === 0
                  ? 'No transactions yet. Completed orders will appear here once they settle.'
                  : 'No transactions match these filters.'
              }
            />
          </div>
          <p className="text-xs leading-5 text-ink/36">
            Amounts show net earnings in the order currency. Export includes platform fee, tax, and
            net for accountant reconciliation.
          </p>
        </div>
      </Surface>

      {/* Payout history */}
      <Surface>
        <SurfaceHeader
          eyebrow="Transfers"
          title="Payout history"
          description="Provider transfers and any release blockers."
        />
        <div className="grid gap-2 p-5">
          {data.payouts.length === 0 ? (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/52">
              No payouts yet. Once Drapeon releases a completed order, the provider reference and
              settlement status appear here.
            </p>
          ) : (
            <div className="overflow-hidden rounded-[8px] border border-ui-border bg-white">
              {data.payouts.map((payout, index) => {
                const order = payout.order_id
                  ? data.orders.find((entry) => entry.id === payout.order_id)
                  : null
                const recovery = payoutBlockedRecovery(payout.blocked_reason, payout.order_id)
                const deliveryState = derivePayoutDeliveryState({
                  provider: payout.provider,
                  status: payout.status,
                  providerTransferStatus: payout.provider_transfer_status,
                  bankSettlementStatus: payout.bank_settlement_status,
                })
                const deliveryLabel = payoutDeliveryLabel(deliveryState)
                return (
                  <div
                    key={payout.id}
                    className={`flex items-start gap-4 px-5 py-4 ${index > 0 ? 'border-t border-ink/6' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StagePill stage={deliveryState} label={deliveryLabel} />
                        <span className="text-xs text-ink/38">
                          {cleanLabel(payout.provider, 'Provider')}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs font-semibold text-needle">
                        {formatPayoutPurpose(payout.payout_purpose)}
                      </p>
                      <p className="mt-1.5 text-xs text-ink/52">
                        {order
                          ? `${orderTitle(order)} · #${order.reference ?? order.id.slice(0, 8)}`
                          : (payout.order_id ?? 'Standalone payout')}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink/52">
                        {payoutDeliveryExplanation(deliveryState, payout.provider)}
                      </p>
                      {payout.bank_settlement_expected_at &&
                      deliveryState === 'BANK_PAYOUT_PENDING' ? (
                        <p className="mt-1 text-xs text-ink/46">
                          Estimated bank arrival {formatDate(payout.bank_settlement_expected_at)}
                        </p>
                      ) : null}
                      {payout.blocked_reason ? (
                        <div className="mt-2 rounded-lg bg-rust/8 px-3 py-2 text-xs text-rust">
                          <p>
                            {payoutBlockedReasonCopy(payout.blocked_reason) ??
                              cleanLabel(payout.blocked_reason, 'Blocked')}
                          </p>
                          {recovery ? (
                            <p className="mt-1 text-ink/62">{recovery.nextStep}</p>
                          ) : null}
                          {recovery?.href ? (
                            <Link
                              href={recovery.href}
                              className="mt-2 inline-flex font-semibold text-needle underline underline-offset-2"
                            >
                              {recovery.ctaLabel}
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                      <p className="mt-1 text-xs text-ink/36">
                        Completed {formatDate(payout.completed_at) ?? 'not yet'} · initiated{' '}
                        {formatRelative(payout.initiated_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xl font-semibold text-ink">
                        {formatMoney(payout.amount, payout.currency)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Surface>

      {data.bankActivity.length > 0 ? (
        <Surface>
          <SurfaceHeader
            eyebrow="Provider settlement"
            title="Stripe bank activity"
            description="Stripe can combine several released earnings into one bank payout. Unmatched bank events stay account-level so Drapeon does not assign them to the wrong order."
          />
          <div className="grid gap-2 p-5">
            {data.bankActivity.map((event) => {
              const state = derivePayoutDeliveryState({
                provider: event.provider,
                status:
                  event.status === 'PAID'
                    ? 'PAID'
                    : event.status === 'FAILED'
                      ? 'FAILED'
                      : 'PROCESSING',
                providerTransferStatus: 'AVAILABLE_IN_PROVIDER_BALANCE',
                bankSettlementStatus: event.status,
              })
              return (
                <div
                  key={event.id}
                  className="rounded-[8px] border border-ui-border bg-white px-5 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <StagePill stage={state} label={payoutDeliveryLabel(state)} />
                        <span className="text-xs text-ink/38">Stripe</span>
                      </div>
                      <p className="mt-2 text-xs text-ink/52">
                        {event.provider_bank_payout_id ?? 'Provider reference pending'}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-ink/52">
                        {payoutDeliveryExplanation(state, event.provider)}
                      </p>
                      {event.arrival_at &&
                      ['PENDING', 'IN_TRANSIT'].includes(event.status ?? '') ? (
                        <p className="mt-1 text-xs text-ink/46">
                          Estimated arrival {formatDate(event.arrival_at)}
                        </p>
                      ) : null}
                      {event.failure_message ? (
                        <p className="mt-2 text-xs text-rust">{event.failure_message}</p>
                      ) : null}
                    </div>
                    <p className="text-xl font-semibold text-ink">
                      {event.amount !== null && event.currency
                        ? formatMoney(event.amount, event.currency)
                        : 'Bank payout'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </Surface>
      ) : null}
    </div>
  )
}

export function RenderPayout({ data, onRefresh }: { data: PayoutRenderData; onRefresh: () => void }) {
  const profile = data.tailorProfile
  const router = useRouter()
  const searchParams = useSearchParams()
  const stripeReturnHandledRef = useRef(false)
  const [pendingPayoutChange, setPendingPayoutChange] = useState<{
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
  } | null>(null)
  const [payoutCurrency, setPayoutCurrency] = useState(
    profile?.payout_currency ?? profile?.currency ?? 'USD'
  )
  const [countryCode, setCountryCode] = useState(profile?.payout_country_code ?? 'US')
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [banks, setBanks] = useState<
    Array<{ code: string; name: string; country?: string | null; currency?: string | null }>
  >([])
  const [verification, setVerification] = useState<{
    resolvedAccountName: string
    maskedAccountNumber: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const paystackCurrency = ['NGN', 'GHS', 'KES'].includes(payoutCurrency)
  const stripeCurrency = ['USD', 'GBP', 'EUR', 'CAD'].includes(payoutCurrency)
  const autoLoadedPaystackBanksRef = useRef<string | null>(null)
  const paystackCountryForCurrency =
    payoutCurrency === 'NGN'
      ? 'NG'
      : payoutCurrency === 'GHS'
        ? 'GH'
        : payoutCurrency === 'KES'
          ? 'KE'
          : countryCode
  const displayedCountryCode = paystackCurrency ? paystackCountryForCurrency : countryCode
  const bankOptions = useMemo(() => {
    const seenCodes = new Set<string>()
    return banks.filter((bank) => {
      const code = bank.code.trim()
      if (!code || seenCodes.has(code)) return false
      seenCodes.add(code)
      return true
    })
  }, [banks])

  const loadPendingPayoutChange = useCallback(async () => {
    try {
      const result = await invokeAccountFunction<{
        pendingPayoutChange?: typeof pendingPayoutChange
      }>('payout-account-action', {
        action: 'get-status',
      })
      setPendingPayoutChange(result.pendingPayoutChange ?? null)
    } catch {
      // The main payout profile remains usable if this secondary review status is temporarily unavailable.
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    const timer = window.setTimeout(() => {
      void loadPendingPayoutChange()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadPendingPayoutChange, profile])

  const refreshStripe = useCallback(
    async (options?: { fromProviderReturn?: boolean }) => {
      setBusy('refresh-stripe')
      setError(null)
      setSuccess(null)
      try {
        const result = await invokeAccountFunction<{
          pendingReview?: boolean
          confirmationRequired?: boolean
          account?: { payoutAccountVerified?: boolean } | null
        }>('payout-account-action', { action: 'refresh-stripe-connect-status' })
        await loadPendingPayoutChange()
        onRefresh()
        if (result.confirmationRequired) {
          setSuccess(
            'Replacement verified. Confirm the payout change below; your current account stays active until then.'
          )
        } else if (result.pendingReview) {
          setSuccess(
            'Stripe still needs more information before this payout destination can be verified.'
          )
        } else if (result.account?.payoutAccountVerified) {
          setSuccess('Stripe payout account verified and active.')
        } else {
          setSuccess(
            'Stripe status refreshed. Finish any remaining verification steps with Stripe.'
          )
        }
      } catch (refreshError) {
        setError(friendlyActionError(refreshError, 'Stripe payout status could not refresh.'))
      } finally {
        setBusy(null)
        if (options?.fromProviderReturn) {
          router.replace('/account/payout' as Route, { scroll: false })
        }
      }
    },
    [loadPendingPayoutChange, onRefresh, router]
  )

  const stripeReturnState = searchParams.get('setup')
  useEffect(() => {
    if (
      !profile?.id ||
      stripeReturnHandledRef.current ||
      (stripeReturnState !== 'complete' && stripeReturnState !== 'refresh')
    )
      return
    stripeReturnHandledRef.current = true
    void refreshStripe({ fromProviderReturn: true })
  }, [profile?.id, refreshStripe, stripeReturnState])

  const loadBanks = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!paystackCurrency) return
      setBusy('banks')
      setError(null)
      if (!options?.quiet) setSuccess(null)
      try {
        const result = await invokeAccountFunction<{
          banks?: Array<{
            code: string
            name: string
            country?: string | null
            currency?: string | null
          }>
          warning?: string | null
        }>('payout-account-action', {
          action: 'list-paystack-banks',
          payoutCurrency,
          countryCode: paystackCountryForCurrency,
        })
        setBanks(result.banks ?? [])
        if (result.warning) {
          setSuccess(result.warning)
        } else if (!options?.quiet) {
          setSuccess('Bank directory refreshed.')
        }
      } catch (loadError) {
        setError(friendlyActionError(loadError, 'Bank directory could not load.'))
      } finally {
        setBusy(null)
      }
    },
    [paystackCountryForCurrency, paystackCurrency, payoutCurrency]
  )

  useEffect(() => {
    if (!profile || !paystackCurrency || busy) return
    const directoryKey = `${payoutCurrency}:${paystackCountryForCurrency}`
    if (autoLoadedPaystackBanksRef.current === directoryKey) return
    autoLoadedPaystackBanksRef.current = directoryKey
    setBanks([])
    setBankCode('')
    setBankName('')
    setVerification(null)
    void loadBanks({ quiet: true })
  }, [busy, loadBanks, paystackCountryForCurrency, paystackCurrency, payoutCurrency, profile])

  if (!profile) {
    return (
      <EmptyState
        title="Payout setup needs a tailor profile."
        body="Tailor payout setup is only available after this account has approved tailor access and a tailor profile."
        action={
          <Link href="/account/choose-role?next=%2Faccount%2Fprofile%3Fsetup%3D1" className="font-semibold text-needle">
            Apply as a tailor
          </Link>
        }
      />
    )
  }

  async function verifyPaystack() {
    setBusy('verify')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{
        verification?: { resolvedAccountName: string; maskedAccountNumber: string }
      }>('payout-account-action', {
        action: 'verify-paystack-account',
        payoutCurrency,
        countryCode,
        bankCode,
        bankName,
        accountNumber,
        accountName: accountName.trim() || undefined,
      })
      setVerification(result.verification ?? null)
      setSuccess(
        result.verification
          ? `Verified account name: ${result.verification.resolvedAccountName}`
          : 'Account verified.'
      )
    } catch (verifyError) {
      setError(friendlyActionError(verifyError, 'Account could not be verified.'))
    } finally {
      setBusy(null)
    }
  }

  async function savePaystack() {
    if (!verification) {
      setError('Verify the account before saving it.')
      return
    }
    setBusy('save-paystack')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{
        pendingReview?: boolean
        confirmationRequired?: boolean
        account?: { payoutAccountVerified?: boolean } | null
      }>('payout-account-action', {
        action: 'confirm-paystack-account',
        payoutCurrency,
        countryCode,
        bankCode,
        bankName,
        accountNumber,
        accountName: verification.resolvedAccountName,
      })
      await loadPendingPayoutChange()
      onRefresh()
      if (result.confirmationRequired) {
        setSuccess(
          'Replacement verified. Confirm the payout change below; your current account stays active until then.'
        )
      } else if (result.pendingReview) {
        setSuccess(
          'Replacement submitted. Your current verified payout account stays active while Drapeon reviews the change.'
        )
      } else if (result.account?.payoutAccountVerified) {
        setSuccess('Paystack payout account verified and active.')
      } else {
        setSuccess('Paystack payout account saved.')
      }
    } catch (saveError) {
      setError(friendlyActionError(saveError, 'Payout account could not be saved.'))
    } finally {
      setBusy(null)
    }
  }

  async function startStripe() {
    if (typeof window === 'undefined') return
    setBusy('stripe')
    setError(null)
    setSuccess(null)
    try {
      const returnUrl = `${window.location.origin}/account/payout?setup=complete`
      const result = await invokeAccountFunction<{ onboarding?: { url?: string | null } }>(
        'payout-account-action',
        {
          action: 'start-stripe-connect',
          payoutCurrency,
          countryCode,
          returnUrl,
          refreshUrl: `${window.location.origin}/account/payout?setup=refresh`,
        }
      )
      if (result.onboarding?.url) {
        window.location.assign(result.onboarding.url)
        return
      }
      setSuccess('Stripe onboarding started. Continue from the provider window.')
    } catch (stripeError) {
      setError(friendlyActionError(stripeError, 'Stripe onboarding could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function decidePendingPayoutChange(
    action: 'confirm-payout-change' | 'cancel-payout-change'
  ) {
    if (!pendingPayoutChange) return
    setBusy(action)
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<{
        lifecycleState?: 'ACTIVATED' | 'OPS_REVIEW'
        outcome?: 'CANCELLED'
      }>('payout-account-action', { action, requestId: pendingPayoutChange.id })
      setSuccess(
        action === 'cancel-payout-change'
          ? 'Payout change cancelled. Your current account was not changed.'
          : result.lifecycleState === 'ACTIVATED'
            ? 'New payout account active. Eligible earnings can release to it without an extra payout-account delay.'
            : 'Review started. Your current payout account stays active while Drapeon checks the security differences.'
      )
      await loadPendingPayoutChange()
      onRefresh()
    } catch (decisionError) {
      setError(
        friendlyActionError(
          decisionError,
          action === 'confirm-payout-change'
            ? 'Payout change could not be confirmed.'
            : 'Payout change could not be cancelled.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Status', payoutStatusLabel(profile)],
          [
            'Provider',
            cleanLabel(profile.payout_provider ?? profile.payout_account_type, 'Not set'),
          ],
          ['Currency', profile.payout_currency ?? 'Not set'],
          [
            'Release status',
            profile.payout_account_verified && !profile.payout_reverification_required
              ? 'Ready when earnings are eligible'
              : 'Verification needed',
          ],
        ].map(([label, value]) => (
          <MetricCard
            key={String(label)}
            label={String(label)}
            value={String(value)}
            icon={<WalletCards />}
          />
        ))}
      </section>

      <Surface>
        <SurfaceHeader
          eyebrow="Current destination"
          title="Where earnings are sent"
          description="Your active verified provider destination."
        />
        <div className="divide-y divide-ui-border px-5 pb-2">
          {[
            ['Bank', profile.payout_bank_name ?? profile.manual_bank_name ?? 'Not set'],
            ['Account', profile.payout_account_masked ?? 'Not set'],
            [
              'Account name',
              profile.payout_account_name ?? profile.manual_bank_account_name ?? 'Not set',
            ],
            ['Paystack recipient', profile.paystack_recipient_code ? 'Saved' : 'Not saved'],
            ['Stripe Connect', profile.stripe_connect_account_id ? 'Connected' : 'Not started'],
            [
              'Manual bank',
              profile.manual_bank_entry
                ? cleanLabel(profile.manual_bank_verification_status, 'Pending ops review')
                : 'Not used',
            ],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex items-center justify-between gap-4 py-3">
              <span className="text-xs font-semibold text-ink/42">{String(label)}</span>
              <span className="text-right text-sm font-semibold text-ink">{String(value)}</span>
            </div>
          ))}
        </div>
      </Surface>

      {pendingPayoutChange?.requestedDestination ? (
        <Surface>
          <SurfaceHeader
            eyebrow={
              pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION'
                ? 'Confirmation required'
                : pendingPayoutChange.lifecycleState === 'SECURITY_HOLD'
                  ? 'Activating now'
                  : 'Drapeon review'
            }
            title={
              pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION'
                ? 'Confirm this payout change'
                : 'Your current payout account stays active'
            }
            description={
              pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION'
                ? 'Review the replacement and confirm it within 48 hours. Nothing changes until you confirm.'
                : pendingPayoutChange.lifecycleState === 'SECURITY_HOLD'
                  ? 'This legacy verified replacement is being activated now without an additional payout-account hold.'
                  : 'Drapeon is reviewing a security difference and will notify you of the outcome.'
            }
          />
          <div className="divide-y divide-ui-border px-5 pb-2">
            {[
              [
                'Provider',
                cleanLabel(pendingPayoutChange.requestedDestination.payoutProvider, 'Not recorded'),
              ],
              [
                'Currency',
                pendingPayoutChange.requestedDestination.payoutCurrency ?? 'Not recorded',
              ],
              ['Bank', pendingPayoutChange.requestedDestination.payoutBankName ?? 'Not recorded'],
              [
                'Account name',
                pendingPayoutChange.requestedDestination.payoutAccountName ?? 'Not recorded',
              ],
              [
                'Account',
                pendingPayoutChange.requestedDestination.payoutAccountMasked ?? 'Not recorded',
              ],
              [
                'Provider check',
                pendingPayoutChange.requestedDestination.payoutAccountVerified
                  ? 'Verified'
                  : 'Incomplete',
              ],
              ['Submitted', formatDate(pendingPayoutChange.submittedAt) ?? 'Recorded'],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 py-3">
                <span className="text-xs font-semibold text-ink/42">{String(label)}</span>
                <span className="text-right text-sm font-semibold text-ink">{String(value)}</span>
              </div>
            ))}
          </div>
          {pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION' ? (
            <div className="flex flex-wrap gap-3 border-t border-ui-border p-5">
              <Button
                disabled={busy !== null}
                onClick={() => {
                  void decidePendingPayoutChange('confirm-payout-change')
                }}
              >
                {busy === 'confirm-payout-change' ? 'Confirming…' : 'Confirm this change'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  void decidePendingPayoutChange('cancel-payout-change')
                }}
              >
                Cancel request
              </Button>
            </div>
          ) : null}
        </Surface>
      ) : null}

      <Surface>
        <SurfaceHeader
          eyebrow="Provider setup"
          title="Use an automated payout route"
          description="Stripe Connect handles USD, GBP, EUR, and CAD. Paystack handles NGN, GHS, and KES."
        />
        <div className="grid gap-5 p-5">
          <ActionNotice error={error} success={success} />
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Payout currency</span>
              <select
                value={payoutCurrency}
                onChange={(event) => {
                  const nextCurrency = event.target.value
                  setPayoutCurrency(nextCurrency)
                  setCountryCode(
                    nextCurrency === 'NGN'
                      ? 'NG'
                      : nextCurrency === 'GHS'
                        ? 'GH'
                        : nextCurrency === 'KES'
                          ? 'KE'
                          : countryCode
                  )
                  setBankCode('')
                  setBankName('')
                  setBanks([])
                  setVerification(null)
                }}
                className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD'].map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Country code</span>
              <Input
                value={displayedCountryCode}
                onChange={(event) => {
                  setCountryCode(event.target.value.toUpperCase().slice(0, 2))
                  setBankCode('')
                  setBankName('')
                  setBanks([])
                  setVerification(null)
                }}
                placeholder="US"
                readOnly={paystackCurrency}
              />
            </label>
            <div className="flex items-end">
              {stripeCurrency ? (
                <Button type="button" onClick={startStripe} disabled={!!busy} className="w-full">
                  {busy === 'stripe' ? 'Opening Stripe...' : 'Start Stripe Connect'}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void loadBanks()}
                  disabled={!!busy || !paystackCurrency}
                  className="w-full"
                >
                  {busy === 'banks'
                    ? 'Loading banks...'
                    : bankOptions.length > 0
                      ? 'Refresh banks'
                      : 'Retry banks'}
                </Button>
              )}
            </div>
          </div>

          {profile.stripe_connect_account_id ? (
            <Button
              type="button"
              onClick={() => {
                void refreshStripe()
              }}
              disabled={!!busy}
              variant="secondary"
            >
              {busy === 'refresh-stripe' ? 'Refreshing...' : 'Refresh Stripe status'}
            </Button>
          ) : null}

          {paystackCurrency ? (
            <div className="grid gap-4 rounded-[8px] border border-ui-border bg-ui-muted/45 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Bank</span>
                  <select
                    value={bankCode}
                    onChange={(event) => {
                      const next = bankOptions.find((bank) => bank.code === event.target.value)
                      setBankCode(event.target.value)
                      setBankName(next?.name ?? '')
                      setVerification(null)
                    }}
                    disabled={busy === 'banks' || bankOptions.length === 0}
                    className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    <option value="">
                      {busy === 'banks'
                        ? 'Loading banks...'
                        : bankOptions.length > 0
                          ? 'Select bank'
                          : 'Banks unavailable'}
                    </option>
                    {bankOptions.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-ink">Account number</span>
                  <Input
                    value={accountNumber}
                    onChange={(event) => {
                      setAccountNumber(event.target.value)
                      setVerification(null)
                    }}
                  />
                </label>
                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-semibold text-ink">Expected account name</span>
                  <Input
                    value={accountName}
                    onChange={(event) => setAccountName(event.target.value)}
                  />
                </label>
              </div>
              {verification ? (
                <p className="rounded-[8px] border border-needle/14 bg-needle/8 p-4 text-sm leading-6 text-needle">
                  Verified: {verification.resolvedAccountName} · {verification.maskedAccountNumber}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  onClick={verifyPaystack}
                  disabled={!!busy || !bankCode || !accountNumber}
                  variant="secondary"
                >
                  {busy === 'verify' ? 'Verifying...' : 'Verify account'}
                </Button>
                <Button type="button" onClick={savePaystack} disabled={!!busy || !verification}>
                  {busy === 'save-paystack' ? 'Saving...' : 'Save verified Paystack account'}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Surface>

      <Surface className="border-rust/20 bg-rust/5">
        <SurfaceHeader
          eyebrow="Manual bank entry"
          title="Manual bank setup requires payout support"
        />
        <div className="p-5">
          <p className="text-sm leading-7 text-ink/66">
            Manual bank details require an ops review and manual payout recording workflow before
            they can be used safely. Use Stripe or Paystack for automated setup, or contact payouts
            if your bank is not supported.
          </p>
          <Button asChild variant="secondary" className="mt-5 text-rust">
            <a href={mailto(CONTACTS.payouts, 'Manual payout setup question')}>Contact payouts</a>
          </Button>
        </div>
      </Surface>
    </div>
  )
}
