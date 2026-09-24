'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Briefcase, CheckCheck, ChevronDown, MessageCircle } from 'lucide-react'
import { taxCollectionPromise, formatExplicitZonedDateTime, formatMoney, formatRelative, formatTaxRate, taxLinesForReceiptSnapshot, taxLinesForSnapshot, taxSnapshotNeedsRefresh, consultationOrderListState, formatOrderPaymentPhase } from '@drape/shared'
import { safeEntityName, safeUserText } from '../../../lib/safe-display'
import type { AccountMessage, AccountOrder, AccountPayment, CheckoutRenderData, OrderActorData, OrdersRenderData, WorkRenderData } from '../shared/account-data-contracts'
import { isPayoutReady, isReadyMadeInquiryOrder, isTerminalOrder } from '../shared/account-data-queries'
import { EmptyState, activeQuoteForOrder, cleanLabel, orderTitle, parseOrderSupportMeta, partyName, timestampMs } from '../messages/account-messages-surface'
import { OpenAppButton } from '../../../components/open-app-button'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { DataTable } from '../../../components/ui/data-table'
import { Input } from '../../../components/ui/input'
import { MetricCard } from '../../../components/ui/metric-card'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { isTailorOrder, nextStageOptions } from './account-order-actions'
import { DISPATCH_STAGES, NEEDS_ACTION_STAGES, PRODUCTION_STAGES, StagePill, orderAmount } from '../payouts/account-payout-surfaces'
import { deriveWebTailorReadiness } from '../shop/account-shop-surface'
import { SummaryLine } from './account-dispatch-card'
import { isCustomerOrder } from './order-resolution-panels'
import { CheckoutAction, StageProgressBar, isPayableOrder, stageProgress } from './account-order-detail-surface'

function showOrderInOrdersSurface(order: AccountOrder, data: OrderActorData) {
  if (!isReadyMadeInquiryOrder(order)) return true
  return isTailorOrder(order, data)
}

function latestPayment(orderId: string, payments: AccountPayment[]) {
  return payments.find((payment) => payment.order_id === orderId) ?? null
}

function latestMessage(orderId: string, messages: AccountMessage[]) {
  return messages.find((message) => message.order_id === orderId) ?? null
}

function orderActionCopy(order: AccountOrder, data: OrderActorData) {
  const stage = order.stage ?? ''
  if (isCustomerOrder(order, data)) {
    if (stage === 'QUOTE_SENT') return 'Review quote'
    if (stage === 'PAYMENT_PENDING' || stage === 'PAYMENT_FAILED') return 'Payment needed'
    if (
      [
        'READY_FOR_COLLECTION',
        'READY_FOR_DRAPE_DISPATCH',
        'SHIPPED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'COLLECTED',
      ].includes(stage)
    ) {
      return 'Check handoff'
    }
    if (stage === 'IN_DISPUTE') return 'Support active'
  }
  if (isTailorOrder(order, data)) {
    if (['PENDING_QUOTE', 'CONSULTATION'].includes(stage)) return 'Quote needed'
    if (stage === 'PAYMENT_FAILED') return 'Payment issue'
    if (stage === 'IN_DISPUTE') return 'Dispute active'
    if (nextStageOptions(order).length > 0) return 'Stage update'
  }
  return null
}

function workColumnFor(order: AccountOrder) {
  const stage = order.stage ?? ''
  if (NEEDS_ACTION_STAGES.has(stage)) return 'needs-action'
  if (PRODUCTION_STAGES.has(stage)) return 'production'
  if (DISPATCH_STAGES.has(stage)) return 'dispatched'
  return 'done'
}

function OrderCard({ order, data }: { order: AccountOrder; data: OrdersRenderData }) {
  const payment = latestPayment(order.id, data.payments)
  const message = latestMessage(order.id, data.messages)
  const action = orderActionCopy(order, data)
  const progress = stageProgress(order)
  const isConsultation = order.stage === 'CONSULTATION'
  const attendanceReview = isConsultation
    ? (data.consultationAttendanceReviews.find((review) => review.orderId === order.id) ?? null)
    : null
  const consultationState = isConsultation
    ? consultationOrderListState({
        actorRole: isTailorOrder(order, data) ? 'TAILOR' : 'CUSTOMER',
        review: attendanceReview,
      })
    : null
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="block overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm transition hover:shadow-[0_14px_40px_rgba(22,28,24,0.10)]"
    >
      <div className={isConsultation ? 'p-4' : 'p-5'}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/68">
                {cleanLabel(order.order_kind, 'Order')}
              </span>
              <StagePill stage={order.stage} />
              {action && !isConsultation ? (
                <span className="rounded-full bg-rust/10 px-2.5 py-0.5 text-xs font-semibold text-rust">
                  {action}
                </span>
              ) : null}
            </div>
            <h3 className="mt-2 text-xl font-semibold text-ink">{orderTitle(order)}</h3>
            <p className="mt-1 text-sm text-ink/52">
              {partyName(order, data.userId)} · {cleanLabel(order.delivery_method, 'Fulfillment')}
            </p>
            {isConsultation ? (
              <span
                className={[
                  'mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold',
                  consultationState?.needsAction
                    ? 'bg-rust/10 text-rust'
                    : 'bg-needle/8 text-needle',
                ].join(' ')}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {consultationState?.label ?? 'Consultation scheduled'}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xl font-semibold text-ink">{orderAmount(order)}</p>
            <div className="mt-1 flex justify-end">
              <StatusChip status={payment?.status} fallback="Payment pending" />
            </div>
            <p className="mt-0.5 text-xs text-ink/36">
              {formatRelative(order.updated_at ?? order.created_at)}
            </p>
          </div>
        </div>
        {message && !isConsultation ? (
          <p className="mt-3 line-clamp-1 rounded-lg bg-ink/4 px-3 py-2 text-sm text-ink/52">
            {safeUserText(
              message.body,
              message.photo_url || message.voice_url ? 'Media attached.' : 'Message recorded.'
            )}
          </p>
        ) : null}
      </div>
      <div className="h-1 bg-ink/6">
        <div className="h-full rounded-r-full bg-needle" style={{ width: `${progress}%` }} />
      </div>
    </Link>
  )
}

export function RenderOrders({ data }: { data: OrdersRenderData }) {
  const [filter, setFilter] = useState<'active' | 'action' | 'completed' | 'all'>('active')
  const [search, setSearch] = useState('')
  const orderRows = data.orders.filter((order) => showOrderInOrdersSurface(order, data))
  const activeOrders = orderRows.filter((order) => !isTerminalOrder(order))
  const pastOrders = orderRows.filter(isTerminalOrder)
  const actionOrders = orderRows.filter((order) => orderActionCopy(order, data))
  const byFilter =
    filter === 'active'
      ? activeOrders
      : filter === 'action'
        ? actionOrders
        : filter === 'completed'
          ? pastOrders
          : orderRows
  const visibleOrders = search.trim()
    ? byFilter.filter((order) => {
        const hay = [
          orderTitle(order),
          partyName(order, data.userId),
          cleanLabel(order.stage),
          cleanLabel(order.order_kind),
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(search.trim().toLowerCase())
      })
    : byFilter
  const tabs: Array<[typeof filter, string, number]> = [
    ['active', 'Active', activeOrders.length],
    ['action', 'Needs action', actionOrders.length],
    ['completed', 'Completed', pastOrders.length],
    ['all', 'All', orderRows.length],
  ]
  const columns = useMemo<ColumnDef<AccountOrder>[]>(
    () => [
      {
        id: 'order',
        accessorFn: (order) => orderTitle(order),
        header: 'Order',
        cell: ({ row }) => (
          <div className="min-w-52">
            <Link
              href={`/account/orders/${row.original.id}`}
              className="font-semibold text-ink hover:text-needle hover:underline"
            >
              {orderTitle(row.original)}
            </Link>
            <p className="mt-1 text-xs text-ui-subtle">{partyName(row.original, data.userId)}</p>
          </div>
        ),
      },
      {
        id: 'stage',
        accessorFn: (order) => order.stage ?? '',
        header: 'Status',
        cell: ({ row }) => <StagePill stage={row.original.stage} />,
      },
      {
        id: 'fulfillment',
        accessorFn: (order) => cleanLabel(order.delivery_method, 'Fulfillment'),
        header: 'Fulfillment',
        cell: ({ row }) => (
          <span className="text-ui-subtle">
            {cleanLabel(row.original.delivery_method, 'Fulfillment')}
          </span>
        ),
      },
      {
        id: 'payment',
        accessorFn: (order) => latestPayment(order.id, data.payments)?.status ?? '',
        header: 'Payment',
        cell: ({ row }) => (
          <StatusChip
            status={latestPayment(row.original.id, data.payments)?.status}
            fallback="Payment pending"
          />
        ),
      },
      {
        id: 'amount',
        accessorFn: (order) => order.quoted_amount ?? order.total_amount ?? 0,
        header: 'Amount',
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-semibold">{orderAmount(row.original)}</span>
        ),
      },
      {
        id: 'updated',
        accessorFn: (order) => timestampMs(order.updated_at ?? order.created_at),
        header: 'Updated',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-ui-subtle">
            {formatRelative(row.original.updated_at ?? row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'action',
        enableSorting: false,
        header: '',
        cell: ({ row }) => {
          const action = orderActionCopy(row.original, data)
          return action ? <Badge tone="warning">{action}</Badge> : null
        },
      },
    ],
    [data]
  )
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Active', activeOrders.length],
          ['Needs action', actionOrders.length],
          ['Completed', pastOrders.length],
        ].map(([label, count]) => (
          <div
            key={String(label)}
            className="rounded-[8px] border border-ui-border bg-white px-4 py-3"
          >
            <p className="text-2xl font-semibold text-ink">{String(count)}</p>
            <p className="text-xs text-ink/52">{String(label)}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search orders by title, party, or status"
        className="h-11"
      />

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto rounded-[8px] border border-ui-border bg-white p-1.5 [scrollbar-width:none]">
        {tabs.map(([key, label, count]) => (
          <Button
            key={key}
            onClick={() => setFilter(key)}
            variant={filter === key ? 'primary' : 'ghost'}
            size="sm"
            className="whitespace-nowrap"
          >
            {label}
            {count > 0 ? (
              <span className={`ml-1.5 ${filter === key ? 'opacity-70' : 'text-ink/40'}`}>
                {count}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {/* Order list */}
      <div className="grid gap-3 md:hidden">
        {visibleOrders.length === 0 ? (
          <EmptyState
            title={
              search.trim()
                ? 'No orders match that search.'
                : filter === 'action'
                  ? 'No orders need action.'
                  : filter === 'completed'
                    ? 'No completed orders yet.'
                    : 'No orders here.'
            }
            body="Custom and ready-made orders appear here after they are created in the app or on web."
            action={
              data.tailorProfile ? (
                <Link href="/account/work" className="font-semibold text-needle">
                  Back to dashboard
                </Link>
              ) : (
                <Link href="/account/explore" className="font-semibold text-needle">
                  Browse tailors
                </Link>
              )
            }
          />
        ) : (
          visibleOrders.map((order) => <OrderCard key={order.id} order={order} data={data} />)
        )}
      </div>
      {visibleOrders.length > 0 ? (
      <div className="hidden min-w-0 md:block">
          <DataTable
            columns={columns}
            data={visibleOrders}
            emptyMessage="No orders match this view."
          />
        </div>
      ) : null}
    </div>
  )
}

export function RenderWork({ data, onRefresh }: { data: WorkRenderData; onRefresh: () => void }) {
  const [colsOpen, setColsOpen] = useState([false, false, false, false])
  if (!data.tailorProfile) {
    return (
      <EmptyState
        title="Tailor workspace not set up."
        body="Apply for tailor access before the web work queue can show orders, shop, payout state, and client context."
        action={
          <Link href="/account/choose-role?next=%2Faccount%2Fprofile%3Fsetup%3D1" className="font-semibold text-needle">
            Apply as a tailor
          </Link>
        }
      />
    )
  }

  const tailorOrders = data.orders.filter(
    (order) => order.tailor_profile_id === data.tailorProfile?.id || order.tailor_id === data.userId
  )
  const activeOrders = tailorOrders.filter((order) => !isTerminalOrder(order))
  const pendingReplyOrders = activeOrders.filter((order) =>
    ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '')
  )
  const columns = [
    {
      key: 'needs-action',
      title: 'Needs action',
      body: 'Quotes, payment issues, and disputes.',
      orders: activeOrders.filter((order) => workColumnFor(order) === 'needs-action'),
    },
    {
      key: 'production',
      title: 'In production',
      body: 'Confirmed work moving through stages.',
      orders: activeOrders.filter((order) => workColumnFor(order) === 'production'),
    },
    {
      key: 'dispatched',
      title: 'Dispatched',
      body: 'Collection, dispatch, and delivery handoff.',
      orders: activeOrders.filter((order) => workColumnFor(order) === 'dispatched'),
    },
    {
      key: 'done',
      title: 'Done / recent',
      body: 'Closed or waiting on final review.',
      orders: tailorOrders
        .filter((order) => isTerminalOrder(order) || workColumnFor(order) === 'done')
        .slice(0, 8),
    },
  ] as const

  const availability = data.tailorProfile.availability ?? 'OPEN'
  const availLabel =
    availability === 'OPEN'
      ? 'Open for orders'
      : availability === 'LIMITED'
        ? 'Limited availability'
        : 'Fully booked'
  const availHint =
    availability === 'OPEN'
      ? 'Customers can find and book you.'
      : availability === 'LIMITED'
        ? 'Visible with a slower-reply notice.'
        : 'New bookings paused; active orders unaffected.'
  const availDotColor =
    availability === 'OPEN'
      ? 'bg-emerald-500'
      : availability === 'LIMITED'
        ? 'bg-amber-400'
        : 'bg-rust'
  const payoutVerified = isPayoutReady(data.tailorProfile)
  const payoutLabel = payoutVerified
    ? 'Payout ready'
    : data.tailorProfile.payout_reverification_required
      ? 'Reverification needed'
      : data.tailorProfile.is_live
        ? 'Checkout paused'
        : 'Payout pending'
  const payoutHint = payoutVerified
    ? (data.tailorProfile.payout_bank_name ??
      data.tailorProfile.payout_provider ??
      'Account verified')
    : data.tailorProfile.payout_reverification_required
      ? 'Open Payout to re-verify your account.'
      : 'Set up payouts before earnings can release.'
  const payoutBadgeStyle = payoutVerified
    ? 'bg-needle/10 text-needle'
    : data.tailorProfile.payout_reverification_required
      ? 'bg-rust/10 text-rust'
      : 'bg-amber-400/15 text-amber-600'
  const readiness = deriveWebTailorReadiness(data.tailorProfile)
  const identityStatus = data.tailorProfile.id_verification_status ?? 'NOT_SUBMITTED'
  const identityLabel = readiness.identityVerified
    ? 'Verified'
    : identityStatus === 'PENDING'
      ? 'In review'
      : identityStatus === 'REJECTED'
        ? 'Needs resubmission'
        : 'Not submitted'
  const identityBadgeStyle = readiness.identityVerified
    ? 'bg-needle/10 text-needle'
    : identityStatus === 'PENDING'
      ? 'bg-amber-400/15 text-amber-600'
      : 'bg-rust/10 text-rust'

  const todayFocus: {
    tone: 'warning' | 'default' | 'success'
    eyebrow: string
    title: string
    body: string
    action: string
    actionHref: Route
  } = (() => {
    if (pendingReplyOrders.length > 0) {
      return {
        tone: 'warning',
        eyebrow: 'Today',
        title: `${pendingReplyOrders.length} quote${pendingReplyOrders.length === 1 ? '' : 's'} waiting`,
        body: 'Send clear pricing or request a consultation before the customer cools off.',
        action: 'Review orders',
        actionHref: '/account/orders' as Route,
      }
    }
    if (activeOrders.length > 0) {
      const next = activeOrders[0]
      if (next) {
        return {
          tone: 'default',
          eyebrow: 'Today',
          title: orderTitle(next),
          body: orderActionCopy(next, data) ?? 'Check the order for the next step.',
          action: 'Open active orders',
          actionHref: '/account/orders' as Route,
        }
      }
    }
    if (!readiness.canAcceptPaidOrders) {
      return {
        tone: 'warning',
        eyebrow: 'Readiness',
        title: readiness.title,
        body: readiness.body,
        action: readiness.actionLabel ?? 'Review profile',
        actionHref: readiness.actionHref ?? ('/account/profile' as Route),
      }
    }
    if (!payoutVerified) {
      return {
        tone: 'default',
        eyebrow: 'Today',
        title: payoutLabel,
        body: payoutHint,
        action: 'Set up payout',
        actionHref: '/account/payout' as Route,
      }
    }
    return {
      tone: 'success',
      eyebrow: 'Today',
      title: 'No urgent actions',
      body: 'Your queue is clear. Update your availability or review your shop while it stays quiet.',
      action: 'Manage availability',
      actionHref: '/account/profile' as Route,
    }
  })()

  function WorkOrderCard({ order }: { order: AccountOrder }) {
    const action = orderActionCopy(order, data)
    return (
      <Link
        href={`/account/orders/${order.id}`}
        className="block rounded-[8px] border border-ui-border bg-white p-3.5 shadow-sm transition hover:border-needle/30 hover:shadow-md"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-needle/70">
            {cleanLabel(order.order_kind, 'Order')}
          </span>
          <StagePill stage={order.stage} />
        </div>
        <p className="mt-2 truncate text-sm font-semibold text-ink">{orderTitle(order)}</p>
        <p className="mt-0.5 truncate text-xs text-ink/52">
          {partyName(order, data.userId)} · {orderAmount(order)}
        </p>
        <div className="mt-2.5">
          <StageProgressBar order={order} />
        </div>
        <p className={`mt-2 text-xs leading-4 ${action ? 'text-amber-700' : 'text-ink/38'}`}>
          {action ?? formatRelative(order.updated_at ?? order.created_at)}
        </p>
      </Link>
    )
  }

  return (
    <div className="grid min-w-0 gap-6">
      <Surface>
        <SurfaceHeader
          eyebrow="Tailor cockpit"
          title={safeEntityName(
            data.tailorProfile.business_name || data.tailorProfile.display_name,
            'Dashboard'
          )}
          description="Live order health, selling readiness, and the next task that needs attention."
          action={<StatusChip status={data.tailorProfile.is_live ? 'LIVE' : 'HIDDEN'} />}
        />
        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Active"
              value={activeOrders.length}
              hint="Orders in progress"
              icon={<Briefcase />}
              className="shadow-none"
            />
            <MetricCard
              label="Needs reply"
              value={pendingReplyOrders.length}
              hint="Quotes or consultations"
              icon={<MessageCircle />}
              className="shadow-none"
            />
            <MetricCard
              label="Completed"
              value={data.tailorProfile.total_orders ?? 0}
              hint="Lifetime finished orders"
              icon={<CheckCheck />}
              className="shadow-none"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Link
              href="/account/profile"
              className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 transition hover:border-needle/25 hover:bg-white"
            >
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${availDotColor}`} />
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-needle/70">
                  Availability
                </span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-ink">{availLabel}</p>
              <p className="mt-0.5 text-xs leading-4 text-ink/52">{availHint}</p>
            </Link>
            <Link
              href="/account/profile"
              className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 transition hover:border-needle/25 hover:bg-white"
            >
              <div className="flex items-center gap-1.5">
                <StatusChip status={identityLabel} className={identityBadgeStyle} />
              </div>
              <p className="mt-1.5 text-sm font-semibold text-ink">Identity</p>
              <p className="mt-0.5 text-xs leading-4 text-ink/52">
                {readiness.profileCompleted
                  ? 'Profile setup complete.'
                  : 'Finish profile setup before paid work.'}
              </p>
            </Link>
            <Link
              href="/account/payout"
              className="rounded-[8px] border border-ui-border bg-ui-muted/55 p-3 transition hover:border-needle/25 hover:bg-white"
            >
              <div className="flex items-center gap-1.5">
                <StatusChip status={payoutLabel} className={payoutBadgeStyle} />
              </div>
              <p className="mt-1.5 text-sm font-semibold text-ink">Payout</p>
              <p className="mt-0.5 text-xs leading-4 text-ink/52">{payoutHint}</p>
            </Link>
          </div>

          <div
            className={`rounded-[8px] border p-4 ${
              todayFocus.tone === 'warning'
                ? 'border-amber-300/40 bg-amber-400/8'
                : todayFocus.tone === 'success'
                  ? 'border-needle/16 bg-needle/6'
                  : 'border-ink/8 bg-bone/60'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/70">
              {todayFocus.eyebrow}
            </p>
            <p className="mt-1.5 text-base font-semibold text-ink">{todayFocus.title}</p>
            <p className="mt-1 text-xs leading-5 text-ink/56">{todayFocus.body}</p>
            <Button asChild size="sm" className="mt-3">
              <Link href={todayFocus.actionHref}>{todayFocus.action}</Link>
            </Button>
          </div>
        </div>
      </Surface>

      {/* ── Active order queue (mobile) ── */}
      <section className="lg:hidden">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/44">
            Order queue
          </p>
          {activeOrders.length > 0 && (
            <span className="rounded-full bg-needle/10 px-2.5 py-0.5 text-xs font-semibold text-needle">
              {activeOrders.length}
            </span>
          )}
        </div>
        {activeOrders.length === 0 ? (
          <EmptyState
            title="No active work right now."
            body="New custom briefs and ready-made orders will appear here when customers place them."
            action={
              <Link href="/account/shop" className="font-semibold text-needle">
                Review shop
              </Link>
            }
          />
        ) : (
          <div className="grid gap-2.5">
            {activeOrders.map((order) => (
              <WorkOrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      {/* ── Desktop kanban ── */}
      <section className="hidden gap-3 lg:grid lg:grid-cols-4">
        {columns.map((column, i) => {
          const isOpen = colsOpen[i] ?? true
          const count = column.orders.length
          return (
            <div
              key={column.key}
              className="overflow-hidden rounded-[8px] border border-ui-border bg-white"
            >
              <button
                type="button"
                onClick={() => setColsOpen((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
                className="flex w-full items-start justify-between gap-2 px-4 py-3.5 text-left transition hover:bg-ink/3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{column.title}</span>
                    {count > 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${column.key === 'needs-action' ? 'bg-amber-400/20 text-amber-700' : 'bg-needle/10 text-needle'}`}
                      >
                        {count}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-ink/44">{column.body}</p>
                </div>
                <ChevronDown
                  className={`mt-0.5 size-4 shrink-0 text-ink/30 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen && (
                <div className="grid gap-2.5 border-t border-ink/6 p-3">
                  {count === 0 ? (
                    <p className="rounded-[8px] bg-bone/60 px-3 py-2.5 text-xs text-ink/42">
                      Nothing here.
                    </p>
                  ) : (
                    column.orders.map((order) => (
                      <WorkOrderCard key={`${column.key}-${order.id}`} order={order} />
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

export function RenderCheckout({
  data,
  orderId,
  onRefresh,
}: {
  data: CheckoutRenderData
  orderId?: string
  onRefresh: () => void
}) {
  const customerOrders = data.orders.filter((entry) => isCustomerOrder(entry, data))
  const order = orderId
    ? (data.orders.find((entry) => entry.id === orderId) ?? null)
    : (customerOrders.find(isPayableOrder) ?? customerOrders[0] ?? null)
  if (!order) {
    return (
      <EmptyState
        title="No payment is waiting."
        body="Orders appear here when a quote, ready-made purchase, or retry needs customer payment. Otherwise, keep using Orders."
        action={
          <Link href="/account/orders" className="font-semibold text-needle">
            View orders
          </Link>
        }
      />
    )
  }
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const receipt = data.receipts.find((entry) => entry.order_id === order.id) ?? null
  const receiptTaxLines = receipt
    ? taxLinesForReceiptSnapshot({
        taxJurisdiction: receipt.tax_jurisdiction,
        taxAmount: Math.max(
          receipt.tax_amount - receipt.import_tax_amount - receipt.duty_amount,
          0
        ),
      })
    : []
  const confirmed = payments.some((payment) =>
    ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? '')
  )
  const viewerIsCustomer = isCustomerOrder(order, data)
  const checkoutAvailable = viewerIsCustomer && isPayableOrder(order)
  const activeQuote = activeQuoteForOrder(data.quotes, order.id)
  const checkoutConsultationCredit = Math.max(
    parseOrderSupportMeta(order.special_note).quoteBreakdown?.consultationCreditAmount ?? 0,
    0
  )
  const checkoutCurrency = order.currency ?? order.quoted_currency
  const checkoutTaxLines = taxLinesForSnapshot({
    taxRegion: order.tax_region,
    taxRateBps: order.tax_rate_bps,
    taxAmount: Math.max(
      (order.tax_amount ?? 0) - (order.import_tax_amount ?? 0) - (order.duty_amount ?? 0),
      0
    ),
  })
  const checkoutTaxNeedsRefresh = taxSnapshotNeedsRefresh({
    taxRegion: order.tax_region,
    taxRateBps: order.tax_rate_bps,
    taxFallback: order.tax_fallback,
  })
  const checkoutTaxPromise =
    order.tax_collection_mode && order.tax_responsible_party
      ? taxCollectionPromise({
          collectionMode: order.tax_collection_mode,
          responsibleParty: order.tax_responsible_party,
        })
      : null

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <Surface className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
          {confirmed
            ? 'Payment confirmed'
            : checkoutAvailable
              ? 'Payment needed'
              : 'Payment unavailable'}
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">{orderTitle(order)}</h2>
        <p className="mt-3 text-sm leading-7 text-ink/66">
          {confirmed
            ? 'This payment is recorded. Continue tracking production, handoff, and support from the order.'
            : checkoutAvailable
              ? 'Pay through the provider when the order is ready. If a payment is already processing, Drapeon reuses that attempt instead of creating a duplicate charge.'
              : viewerIsCustomer
                ? 'This customer order is not awaiting payment right now. Check the order timeline for the current stage.'
                : 'Payment actions are customer-only. Tailor work belongs in the work queue and order detail action panel.'}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <SummaryLine label="Order total" value={orderAmount(order)} />
          <SummaryLine
            label="Provider"
            value={cleanLabel(order.payment_provider, 'Provider selected at payment')}
          />
          <SummaryLine
            label="Fulfillment"
            value={cleanLabel(order.delivery_method, 'Fulfillment')}
          />
          <SummaryLine label="Status" value={<StagePill stage={order.stage} />} />
        </div>
        <div className="mt-6 rounded-[8px] border border-ink/8 bg-bone/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/80">
            Locked checkout
          </p>
          <div className="mt-3 grid gap-2">
            {activeQuote?.fabric_funding_policy_version &&
            activeQuote.tailoring_amount != null &&
            activeQuote.fabric_allowance_amount != null ? (
              <>
                <SummaryLine
                  label="Tailoring and construction"
                  value={formatMoney(
                    activeQuote.tailoring_amount + checkoutConsultationCredit,
                    activeQuote.currency
                  )}
                />
                <SummaryLine
                  label="Protected fabric allowance"
                  value={formatMoney(activeQuote.fabric_allowance_amount, activeQuote.currency)}
                />
                {checkoutConsultationCredit > 0 ? (
                  <SummaryLine
                    label="Consultation fee credit"
                    value={`−${formatMoney(checkoutConsultationCredit, activeQuote.currency)}`}
                  />
                ) : null}
              </>
            ) : (
              <SummaryLine
                label="Tailor work and included materials"
                value={formatMoney(order.subtotal_amount, order.currency ?? order.quoted_currency)}
              />
            )}
            {typeof order.platform_fee_amount === 'number' && order.platform_fee_amount > 0 ? (
              <SummaryLine
                label="Drapeon service fee"
                value={formatMoney(order.platform_fee_amount, checkoutCurrency)}
              />
            ) : null}
            <SummaryLine
              label="Fulfillment"
              value={
                (order.shipping_amount ?? 0) > 0
                  ? formatMoney(order.shipping_amount, checkoutCurrency)
                  : 'Free'
              }
            />
            <SummaryLine
              label="Subtotal before tax"
              value={formatMoney(
                (order.subtotal_amount ?? 0) +
                  (order.platform_fee_amount ?? 0) +
                  (order.shipping_amount ?? 0),
                checkoutCurrency
              )}
            />
            {checkoutTaxLines.map((line) => (
              <SummaryLine
                key={line.key}
                label={`${order.tax_fallback ? 'Estimated ' : ''}${line.label} (${formatTaxRate(line.rateBps)})`}
                value={formatMoney(line.amount, checkoutCurrency)}
              />
            ))}
            {(order.import_tax_amount ?? 0) > 0 ? (
              <SummaryLine
                label="Import tax"
                value={formatMoney(order.import_tax_amount, checkoutCurrency)}
              />
            ) : null}
            {(order.duty_amount ?? 0) > 0 ? (
              <SummaryLine
                label="Customs duty"
                value={formatMoney(order.duty_amount, checkoutCurrency)}
              />
            ) : null}
            <SummaryLine
              label="Total due"
              value={
                <strong>
                  {formatMoney(order.total_amount ?? order.quoted_amount, checkoutCurrency)}
                </strong>
              }
            />
            {activeQuote?.expires_at ? (
              <SummaryLine
                label="Quote valid until"
                value={
                  formatExplicitZonedDateTime(activeQuote.expires_at) ?? activeQuote.expires_at
                }
              />
            ) : null}
          </div>
          {checkoutTaxPromise ? (
            <div className="mt-3 rounded-[8px] border border-needle/12 bg-white/80 p-3">
              <p className="text-sm font-semibold text-ink">{checkoutTaxPromise.title}</p>
              <p className="mt-1 text-xs leading-5 text-ink/60">{checkoutTaxPromise.body}</p>
            </div>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-ink/55">
            {activeQuote?.fabric_funding_policy_version
              ? 'The fabric allowance stays protected. Drapeon releases only approved, evidenced fabric costs and returns any unused amount to you.'
              : 'The currency and amounts are locked before the payment provider opens. Extra customs, delivery, or order changes require a separate approval.'}
          </p>
          {checkoutTaxNeedsRefresh ? (
            <p className="mt-3 rounded-[8px] border border-rust/20 bg-rust/6 p-3 text-sm font-medium leading-6 text-rust">
              This quote used an older Ghana tax snapshot. It cannot be paid until the tailor
              refreshes it with the current VAT and statutory levies.
            </p>
          ) : null}
        </div>
        <div className="mt-6">
          {viewerIsCustomer ? (
            <CheckoutAction order={order} activeQuote={activeQuote} onRefresh={onRefresh} />
          ) : (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              You are viewing this as the tailor, so payment collection stays locked to the customer
              account.
            </p>
          )}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <OpenAppButton label="Open in app" />
          <Button asChild variant="secondary">
            <Link href={`/account/orders/${order.id}`}>Back to order</Link>
          </Button>
        </div>
      </Surface>
      <section className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-ink">
          {receipt ? 'Receipt' : 'Payment ledger'}
        </h2>
        <div className="mt-5 grid gap-3">
          {receipt ? (
            <>
              <SummaryLine label="Receipt" value={receipt.receipt_number} />
              {receipt.fabric_funding_policy_version &&
              receipt.tailoring_amount != null &&
              receipt.fabric_allowance_amount != null ? (
                <>
                  <SummaryLine
                    label="Tailoring and construction"
                    value={formatMoney(
                      receipt.tailoring_amount + receipt.consultation_credit_amount,
                      receipt.currency
                    )}
                  />
                  <SummaryLine
                    label="Protected fabric allowance"
                    value={formatMoney(receipt.fabric_allowance_amount, receipt.currency)}
                  />
                </>
              ) : (
                <SummaryLine
                  label="Tailor work and included materials"
                  value={formatMoney(
                    receipt.subtotal_amount + receipt.consultation_credit_amount,
                    receipt.currency
                  )}
                />
              )}
              {receipt.consultation_credit_amount > 0 ? (
                <SummaryLine
                  label="Consultation fee credit"
                  value={`−${formatMoney(receipt.consultation_credit_amount, receipt.currency)}`}
                />
              ) : null}
              {receipt.promotion_amount > 0 ? (
                <SummaryLine
                  label="Drapeon-funded benefit"
                  value={`−${formatMoney(receipt.promotion_amount, receipt.currency)}`}
                />
              ) : null}
              {receipt.platform_fee_amount > 0 ? (
                <SummaryLine
                  label="Drapeon service fee"
                  value={formatMoney(receipt.platform_fee_amount, receipt.currency)}
                />
              ) : null}
              <SummaryLine
                label="Fulfillment"
                value={
                  receipt.shipping_amount > 0
                    ? formatMoney(receipt.shipping_amount, receipt.currency)
                    : 'Free'
                }
              />
              {receiptTaxLines.map((line) => (
                <SummaryLine
                  key={line.key}
                  label={
                    line.rateBps > 0 ? `${line.label} (${formatTaxRate(line.rateBps)})` : line.label
                  }
                  value={formatMoney(line.amount, receipt.currency)}
                />
              ))}
              {receipt.import_tax_amount > 0 ? (
                <SummaryLine
                  label="Import tax"
                  value={formatMoney(receipt.import_tax_amount, receipt.currency)}
                />
              ) : null}
              {receipt.duty_amount > 0 ? (
                <SummaryLine
                  label="Customs duty"
                  value={formatMoney(receipt.duty_amount, receipt.currency)}
                />
              ) : null}
              {receipt.tax_collection_mode === 'PAYABLE_ON_IMPORT' ? (
                <p className="rounded-[8px] bg-bone/70 p-3 text-xs leading-5 text-ink/60">
                  Import charges were not collected at checkout and may be payable to customs or the
                  carrier by the responsible importer.
                </p>
              ) : null}
              <SummaryLine
                label="Total paid"
                value={<strong>{formatMoney(receipt.total_amount, receipt.currency)}</strong>}
              />
              <SummaryLine
                label="Provider reference"
                value={`${cleanLabel(receipt.provider, 'Provider')} · ${receipt.provider_reference}`}
              />
              <p className="rounded-[8px] bg-needle/5 p-3 text-xs leading-5 text-ink/60">
                Issued from the locked checkout and captured payment. Later refunds appear as
                separate adjustments and never rewrite this receipt.
              </p>
            </>
          ) : null}
          {!receipt && payments.length === 0 ? (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No provider payment has been recorded yet. If you already paid, do not pay again; open
              Support or the order thread.
            </p>
          ) : !receipt ? (
            payments.map((payment) => (
              <SummaryLine
                key={payment.id}
                label={formatOrderPaymentPhase(payment.phase)}
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    {formatMoney(payment.amount, payment.currency)}{' '}
                    <StatusChip status={payment.status} fallback="Pending" />
                  </span>
                }
              />
            ))
          ) : null}
        </div>
      </section>
    </div>
  )
}
