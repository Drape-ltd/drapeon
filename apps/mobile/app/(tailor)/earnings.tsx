import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Share,
  Modal,
  Pressable,
  Platform,
} from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { appendToHistory, goBackOrFallback, resetTo } from '@/lib/navigation'
import { useAuth } from '@/lib/auth'
import {
  buildTailorTransactionsCsv,
  fetchTailorEarningsDashboard,
  type TailorEarningsDashboardData,
  type TailorPayoutHistoryRecord,
  type TailorTransactionRecord,
  type TailorTransactionStatus,
} from '@/lib/money-history'
import { formatAmount, type CurrencyCode } from '@/lib/currency'
import { useRefreshOnFocus } from '@/lib/queries'
import { DrapeStatusChip } from '@/components/ui'
import {
  payoutBlockRecovery,
  projectBankPayoutEvents,
  withdrawnBankPayoutAmount,
  type PayoutBlockedReason,
} from '@drape/shared'
import { collapseReplacedPayoutAttempts } from '@/lib/payout-attempts'
import { groupEarningsByWeek } from '@/lib/earnings-weeks'
import { DRAPE_CAPSULE_NAV_CONTENT_CLEARANCE } from '@/components/ui/DrapeCapsuleNav'

type StatusFilter = 'ALL' | TailorTransactionStatus
type RangeFilter = 'ALL' | '30D' | '90D' | '365D'

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'RELEASED', label: 'Released' },
  { key: 'IN_TRANSIT', label: 'In transit' },
  { key: 'IN_PROVIDER_BALANCE', label: 'In provider balance' },
  { key: 'PAID_OUT', label: 'Paid out' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'FAILED', label: 'Failed' },
]

const RANGE_FILTERS: Array<{ key: RangeFilter; label: string }> = [
  { key: '30D', label: '30 days' },
  { key: '90D', label: '90 days' },
  { key: '365D', label: '1 year' },
  { key: 'ALL', label: 'All time' },
]

function money(amount: number, currency: string) {
  return formatAmount(amount, currency as CurrencyCode, currency as CurrencyCode, {})
}

function withinRange(date: string, range: RangeFilter) {
  if (range === 'ALL') return true
  const ms =
    range === '30D'
      ? 30 * 24 * 60 * 60 * 1000
      : range === '90D'
        ? 90 * 24 * 60 * 60 * 1000
        : 365 * 24 * 60 * 60 * 1000
  return Date.parse(date) >= Date.now() - ms
}

function payoutMethodLabel(data: TailorEarningsDashboardData) {
  if (data.bachsPayoutDestination) {
    const destination = data.bachsPayoutDestination
    if (destination.firstWithdrawalReviewStatus === 'PENDING') return 'Bachs · first payout under review'
    if (destination.firstWithdrawalReviewStatus === 'BLOCKED') return 'Bachs · payout setup needs review'
    if (!destination.active) return 'Bachs · finish payout setup'
    return `Bachs balance · ${destination.payoutCurrency}`
  }
  if (data.payoutProvider === 'PAYSTACK' && data.payoutBankName && data.payoutAccountMasked) {
    return `${data.payoutBankName} · ${data.payoutAccountMasked}`
  }
  if (data.payoutProvider === 'PAYSTACK' && data.payoutBankName) return data.payoutBankName
  if (data.payoutProvider === 'BACHS') return 'Bachs payout account'
  if (!data.payoutProvider) return 'Payout account setup pending'
  return data.payoutProvider === 'PAYSTACK' ? 'Verified Paystack account' : 'Verified Stripe Connect account'
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function providerLabel(provider: string) {
  if (provider === 'BACHS') return 'Bachs'
  if (provider === 'STRIPE') return 'Stripe'
  if (provider === 'PAYSTACK') return 'Paystack'
  return 'Provider'
}

function payoutReviewMessage(row: TailorPayoutHistoryRecord) {
  if (row.status === 'FAILED' || row.status === 'REVERSED' || row.status === 'CANCELED') {
    if (row.provider === 'BACHS') {
      return 'Drapeon Ops is reviewing this Bachs transfer. Do not start another payout; we will update this earning when it is reconciled.'
    }
    return 'Drapeon ops is reviewing this payout. You do not need to change your bank details unless support asks.'
  }

  if (row.blockedReason) return payoutBlockRecovery(row.blockedReason as PayoutBlockedReason).nextStep

  return null
}

function blockedPayoutAction(row: TailorPayoutHistoryRecord) {
  if (!row.blockedReason) return null
  const recovery = payoutBlockRecovery(row.blockedReason as PayoutBlockedReason)
  if (recovery.destination === 'PAYOUT_SETUP') {
    return { label: recovery.ctaLabel, pathname: '/(tailor)/profile/payout-setup' as const }
  }
  if ((recovery.destination === 'ORDER' || recovery.destination === 'OPS_REVIEW') && row.orderId) {
    return { label: recovery.ctaLabel, pathname: '/(tailor)/orders/[id]' as const }
  }
  return null
}

export default function TailorEarningsScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const userId = user?.id
  const [data, setData] = useState<TailorEarningsDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('ALL')
  const [filterSheet, setFilterSheet] = useState<'status' | 'range' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [tab, setTab] = useState<'earnings' | 'payouts'>('earnings')
  const [weekIndex, setWeekIndex] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [breakdown, setBreakdown] = useState<TailorTransactionRecord | null>(null)

  const load = useCallback(async () => {
    if (!userId) {
      setData(null)
      setLoading(false)
      return
    }

    try {
      const result = await fetchTailorEarningsDashboard(userId)
      setData(result)
      setError(null)
    } catch (fetchError) {
      const diagnostic = fetchError as {
        message?: string
        code?: string
        details?: string
        hint?: string
      }
      console.warn('[tailor-earnings] load failed', {
        message: diagnostic?.message ?? 'Unknown earnings load error',
        code: diagnostic?.code ?? null,
        details: diagnostic?.details ?? null,
        hint: diagnostic?.hint ?? null,
      })
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load earnings.')
    }
  }, [userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true)
      void load().finally(() => setLoading(false))
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useRefreshOnFocus(() => {
    void load()
  }, 0)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(tailor)')
  }

  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.transactions ?? []).filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false
      if (!withinRange(row.date, rangeFilter)) return false
      if (!needle) return true
      return [
        row.reference,
        row.orderId,
        row.customerFirstName,
        row.title,
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [data?.transactions, rangeFilter, search, statusFilter])

  const hasActiveFilters = statusFilter !== 'ALL' || rangeFilter !== 'ALL' || search.trim().length > 0

  function clearFilters() {
    setSearch('')
    setStatusFilter('ALL')
    setRangeFilter('ALL')
  }

  async function exportCsv() {
    if (!filteredTransactions.length || exporting) return

    setExporting(true)
    try {
      const csv = buildTailorTransactionsCsv(filteredTransactions)
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
      if (!baseDir) {
        throw new Error('No writable directory available for CSV export.')
      }
      const fileUri = `${baseDir}drape-earnings-${Date.now()}.csv`
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      })
      await Share.share({
        url: fileUri,
        message: `Drapeon earnings export\n${fileUri}`,
      })
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Could not export CSV.')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payments & payouts</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading earnings history…</Text>
            <Text style={styles.stateHint}>
              We’re pulling your settled order earnings, protected balances, and payout ledger together.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!data) {
    const unavailable = Boolean(error)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payments & payouts</Text>
            <Text style={styles.stateTitle}>
              {unavailable ? 'Earnings are temporarily unavailable.' : 'Tailor earnings are not available yet.'}
            </Text>
            <Text style={styles.stateHint}>
              {unavailable
                ? 'Your verified payout setup has not changed. Refresh to load the latest order income and payout activity.'
                : 'Complete your tailor profile before taking paid work. Payout setup is managed separately.'}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => unavailable ? void load() : router.replace('/(tailor)')}
            >
              <Text style={styles.primaryBtnText}>{unavailable ? 'Try again' : 'Back to dashboard'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const summaryCurrency = data.summaryCurrency ?? data.payoutCurrency
  const showCurrencyReview = data.hasMixedCurrencies || data.hasPayoutCurrencyMismatch
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const bankActivity = projectBankPayoutEvents(data.bankActivity.map((row) => ({
    ...row,
    provider_bank_payout_id: row.bankPayoutReference,
    occurred_at: row.occurredAt,
    arrival_at: row.expectedAt,
    created_at: row.createdAt,
  })))
  const withdrawnThisMonth = withdrawnBankPayoutAmount(bankActivity, summaryCurrency, monthStart.getTime())
  const bachsFirstPayoutReviewPending = data.bachsPayoutDestination?.firstWithdrawalReviewStatus === 'PENDING'
  // Paystack/Bachs pay straight to the bank, so a provider "balance" can be 0
  // while money is ready; lead with whichever figure is real for this route.
  const heroIsBalance = data.inProviderBalance > 0 || data.availableForPayout <= 0
  const heroAmount = heroIsBalance ? data.inProviderBalance : data.availableForPayout
  const heroLabel = !heroIsBalance
    ? 'Ready for payout'
    : data.payoutProvider === 'STRIPE'
      ? 'In your Stripe balance'
      : data.payoutProvider
        ? 'Released to your payout account'
        : 'Earnings released'
  const unresolvedPayoutFailures = collapseReplacedPayoutAttempts(data.payouts)
    .filter((row) => row.status === 'FAILED' || row.status === 'REVERSED').length
  const weeks = groupEarningsByWeek(data.transactions ?? [], summaryCurrency)
  const week = weeks[Math.min(weekIndex, weeks.length - 1)]
  const maxDayTotal = Math.max(1, ...week.dayTotals)
  const listRows = hasActiveFilters ? filteredTransactions : week.rows
  const weekLabel = weekIndex === 0 ? 'This week' : weekIndex === 1 ? 'Last week' : weekRangeLabel(week.start, week.end)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Payments & payouts</Text>
          <TouchableOpacity style={styles.exportBtn} onPress={() => void exportCsv()} disabled={exporting || filteredTransactions.length === 0}>
            <Feather name="download" size={16} color={Colors.needleGreen} />
          </TouchableOpacity>
        </View>

        {data.stagedPayoutWarning ? (
          <View style={styles.warningCard} accessibilityRole="alert">
            <Text style={styles.warningTitle}>An order payout needs review</Text>
            <Text style={styles.warningBody}>One order's payout record needs Drapeon Ops review. Other earnings remain available below.</Text>
          </View>
        ) : null}

        {!data.payoutReady ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>
              {bachsFirstPayoutReviewPending
                ? 'Your first Bachs payout is under review'
                : data.bachsPayoutDestination?.firstWithdrawalReviewStatus === 'BLOCKED'
                  ? 'Bachs payout setup needs review'
                  : data.payoutReverificationRequired
                    ? 'Reconnect your payout account'
                    : data.bachsPayoutDestination
                      ? 'Finish Bachs payout setup'
                      : 'Payout account still required'}
            </Text>
            <Text style={styles.warningBody}>
              {bachsFirstPayoutReviewPending
                ? 'Drapeon is reviewing your first payout release before it reaches your Bachs balance. No action is needed while the review is in progress.'
                : data.bachsPayoutDestination?.firstWithdrawalReviewStatus === 'BLOCKED'
                  ? 'Your Bachs payout destination is blocked from receiving earnings. Open payout setup or contact support for the next step.'
                  : data.bachsPayoutDestination
                    ? 'Complete the remaining steps with Bachs. Earnings stay protected and will not be transferred until the destination is ready.'
                    : 'Drapeon will not release earnings until your payout account is verified. Orders can still settle into a protected balance, but withdrawals stay blocked until setup is complete.'}
            </Text>
            {!bachsFirstPayoutReviewPending ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push({ pathname: '/(tailor)/profile/payout-setup', params: { returnTo: '/(tailor)/earnings', historyChain: appendToHistory(undefined, '/(tailor)/earnings') } } as never)}>
                <Text style={styles.primaryBtnText}>
                  {data.payoutReverificationRequired ? 'Reconnect payout account' : data.bachsPayoutDestination ? 'Review Bachs payout setup' : 'Finish payout setup'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>{heroLabel}</Text>
          <Text style={styles.summaryValue}>{money(heroAmount, summaryCurrency)}</Text>
          {heroIsBalance && data.availableForPayout > 0 ? (
            <View style={styles.summaryPill}>
              <Text style={styles.summaryPillText}>+{money(data.availableForPayout, summaryCurrency)} eligible for release now</Text>
            </View>
          ) : null}
          {showCurrencyReview ? (
            <Text style={styles.summaryHint}>
              {`Shown in the order's locked earning currency, ${summaryCurrency}. Your payout account is set to ${data.payoutCurrency}, so Drapeon will not silently convert it.`}
            </Text>
          ) : null}
          <View style={styles.summaryStats}>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatValue}>{money(data.pendingEarnings, summaryCurrency)}</Text>
              <Text style={styles.summaryStatLabel}>Pending release</Text>
            </View>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatValue}>{money(withdrawnThisMonth, summaryCurrency)}</Text>
              <Text style={styles.summaryStatLabel}>Withdrawn this month</Text>
            </View>
            <View style={styles.summaryStat}>
              <Text style={styles.summaryStatValue}>{money(data.totalEarnings, summaryCurrency)}</Text>
              <Text style={styles.summaryStatLabel}>All settled</Text>
            </View>
          </View>
          {data.alreadyPaidOut > 0 ? (
            <MoneySummaryLine label="Paid directly to bank, all time" value={money(data.alreadyPaidOut, summaryCurrency)} />
          ) : null}
          <View style={styles.summaryMethodRow}>
            <Feather name="check-circle" size={14} color={Colors.textInverse} />
            <Text style={styles.summaryMethodText} numberOfLines={1}>{payoutMethodLabel(data)}</Text>
          </View>
        </View>

        {unresolvedPayoutFailures > 0 && tab === 'earnings' ? (
          <TouchableOpacity style={styles.failureBanner} onPress={() => setTab('payouts')} accessibilityRole="button">
            <Feather name="alert-circle" size={16} color={Colors.ink} />
            <Text style={styles.failureBannerText}>
              {unresolvedPayoutFailures === 1 ? 'A payout needs attention' : `${unresolvedPayoutFailures} payouts need attention`}
            </Text>
            <Text style={styles.failureBannerLink}>View</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.tabBar} accessibilityRole="tablist">
          {([['earnings', 'Earnings'], ['payouts', 'Payouts']] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.tabButton, tab === key && styles.tabButtonActive]}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
            >
              <Text style={[styles.tabButtonText, tab === key && styles.tabButtonTextActive]}>
                {key === 'payouts' && unresolvedPayoutFailures > 0 ? `${label} (${unresolvedPayoutFailures})` : label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'payouts' && data.bankActivityUnavailable ? (
          <Text accessibilityRole="alert" style={styles.reasonText}>
            Account withdrawals are temporarily unavailable. Your earnings are still on the Earnings tab; pull to refresh to retry.
          </Text>
        ) : null}

        {tab === 'earnings' ? (<>
        <View style={styles.weekCard}>
          <View style={styles.weekHead}>
            <TouchableOpacity
              style={styles.weekArrow}
              onPress={() => setWeekIndex((index) => Math.min(index + 1, weeks.length - 1))}
              disabled={weekIndex >= weeks.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Previous week"
            >
              <Feather name="chevron-left" size={20} color={weekIndex >= weeks.length - 1 ? Colors.lightGrey : Colors.ink} />
            </TouchableOpacity>
            <View style={styles.weekHeadCopy}>
              <Text style={styles.weekLabel}>{weekLabel}</Text>
              <Text style={styles.weekRange}>{weekRangeLabel(week.start, week.end)}</Text>
            </View>
            <TouchableOpacity
              style={styles.weekArrow}
              onPress={() => setWeekIndex((index) => Math.max(index - 1, 0))}
              disabled={weekIndex === 0}
              accessibilityRole="button"
              accessibilityLabel="Next week"
            >
              <Feather name="chevron-right" size={20} color={weekIndex === 0 ? Colors.lightGrey : Colors.ink} />
            </TouchableOpacity>
          </View>
          <Text style={styles.weekTotal}>{money(week.total, summaryCurrency)}</Text>
          <Text style={styles.weekSub}>
            From {week.countedRows} paid {week.countedRows === 1 ? 'order' : 'orders'} · released in stages after handoff
          </Text>
          <View style={styles.weekChart} accessible accessibilityLabel={`Daily earnings for ${weekLabel}`}>
            {week.dayTotals.map((value, index) => (
              <View key={index} style={styles.weekBarCol}>
                <View style={styles.weekBarTrack}>
                  <View style={[styles.weekBar, { height: `${Math.round((value / maxDayTotal) * 100)}%` }, value === 0 && styles.weekBarEmpty]} />
                </View>
                <Text style={styles.weekBarLabel}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</Text>
              </View>
            ))}
          </View>
        </View>

        {showCurrencyReview ? (
          <View style={styles.currencyNoticeCard}>
            <Text style={styles.currencyNoticeTitle}>Currency review needed before payout</Text>
            <Text style={styles.currencyNoticeText}>
              Some earnings are locked in a different currency from your payout account. They stay in the order currency until ops approves an original-currency payout or a conversion.
            </Text>
            {data.currencySummaries.length > 0 ? (
              <View style={styles.currencyBreakdownList}>
                {data.currencySummaries.map((row) => (
                  <View key={row.currency} style={styles.currencyBreakdownRow}>
                    <Text style={styles.currencyBreakdownLabel}>{row.currency}</Text>
                    <Text style={styles.currencyBreakdownValue}>{money(row.totalEarnings, row.currency)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}


        {error ? (
          <View style={styles.inlineErrorCard}>
            <Text style={styles.inlineErrorTitle}>Something needs attention</Text>
            <Text style={styles.inlineErrorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.listHead}>
            <Text style={styles.sectionTitle}>{hasActiveFilters ? 'Matching orders' : `${weekLabel}'s orders`}</Text>
            <View style={styles.listHeadSide}>
              {hasActiveFilters ? null : <Text style={styles.listHeadMeta}>{money(week.total, summaryCurrency)}</Text>}
              <TouchableOpacity
                style={styles.searchToggle}
                onPress={() => setShowSearch((open) => !open)}
                accessibilityRole="button"
                accessibilityLabel={showSearch ? 'Hide search and filters' : 'Search and filter orders'}
              >
                <Feather name={showSearch ? 'x' : 'search'} size={18} color={Colors.ink} />
              </TouchableOpacity>
            </View>
          </View>
          {showSearch || hasActiveFilters ? (
          <View style={[styles.controlsCard, styles.controlsCardInline]}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by order ID, reference, customer, or garment"
              placeholderTextColor={Colors.midGrey}
              style={styles.searchInput}
            />
            {hasActiveFilters ? (
              <TouchableOpacity style={styles.clearFiltersBtn} onPress={clearFilters} activeOpacity={0.75}>
                <Text style={styles.clearFiltersText}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.filterPills}>
              <TouchableOpacity
                style={styles.filterPill}
                onPress={() => setFilterSheet('status')}
                accessibilityRole="button"
                accessibilityLabel="Choose transaction status filter"
              >
                <Text style={styles.filterPillText}>
                  {STATUS_FILTERS.find((filter) => filter.key === statusFilter)?.label ?? 'All'}
                </Text>
                <Feather name="chevron-down" size={15} color={Colors.inkLight} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterPill}
                onPress={() => setFilterSheet('range')}
                accessibilityRole="button"
                accessibilityLabel="Choose transaction date range"
              >
                <Text style={styles.filterPillText}>
                  {RANGE_FILTERS.find((filter) => filter.key === rangeFilter)?.label ?? 'All time'}
                </Text>
                <Feather name="chevron-down" size={15} color={Colors.inkLight} />
              </TouchableOpacity>
            </View>
            <Text style={styles.controlsHint}>Amounts stay in their order currency; Drapeon never converts payout money silently.</Text>
          </View>
          ) : null}

          {listRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {hasActiveFilters ? 'No orders match this filter.' : (data.transactions ?? []).length === 0 ? 'No earnings yet.' : `No earnings ${weekIndex === 0 ? 'this week' : 'in this week'}.`}
              </Text>
              <Text style={styles.emptyText}>
                {hasActiveFilters
                  ? 'Try another date range, status, or search.'
                  : 'Paid orders show up here with what you earn from each one.'}
              </Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {listRows.map((row, index) => (
                <TouchableOpacity
                  key={row.orderId}
                  style={[styles.earningRow, index > 0 && styles.earningRowDivider]}
                  onPress={() => setBreakdown(row)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${money(row.netAmount, row.netCurrency)} total earnings${row.stagedReleaseBreakdown ? `, ${money(row.stagedReleaseBreakdown.inProviderBalance, row.stagedReleaseBreakdown.currency)} in provider balance and ${money(row.stagedReleaseBreakdown.pending, row.stagedReleaseBreakdown.currency)} pending release` : ''}. Show breakdown`}
                >
                  <View style={styles.earningRowCopy}>
                    <Text style={styles.earningRowTitle} numberOfLines={1}>{row.title}</Text>
                    <Text style={styles.earningRowMeta} numberOfLines={1}>
                      {new Date(row.earnedAt ?? row.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · #{row.reference}
                    </Text>
                    {row.stagedReleaseBreakdown ? (
                      <Text style={styles.earningRowSplit} numberOfLines={2}>
                        {money(row.stagedReleaseBreakdown.inProviderBalance, row.stagedReleaseBreakdown.currency)} in provider balance · {money(row.stagedReleaseBreakdown.pending, row.stagedReleaseBreakdown.currency)} pending release
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.earningRowSide}>
                    <Text style={styles.earningRowAmount}>{money(row.netAmount, row.netCurrency)}</Text>
                    <DrapeStatusChip value={row.status} domain="payment" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {!hasActiveFilters && weeks.length > 1 ? (
            <View style={styles.pastWeeks}>
              <Text style={styles.pastWeeksTitle}>Past weeks</Text>
              <View style={styles.listCard}>
                {weeks.map((item, index) => ({ item, index })).filter(({ index }) => index !== weekIndex).slice(0, 8).map(({ item, index }) => (
                  <TouchableOpacity
                    key={item.start.toISOString()}
                    style={[styles.pastWeekRow, styles.earningRowDivider]}
                    onPress={() => setWeekIndex(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${weekRangeLabel(item.start, item.end)}`}
                  >
                    <Text style={styles.pastWeekLabel}>{index === 0 ? 'This week' : index === 1 ? 'Last week' : weekRangeLabel(item.start, item.end)}</Text>
                    <Text style={styles.pastWeekAmount}>{money(item.total, summaryCurrency)}</Text>
                    <Feather name="chevron-right" size={16} color={Colors.midGrey} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
        </View>
        </>) : null}

        {tab === 'payouts' ? (<>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payout history</Text>
          {data.payouts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No payouts have been triggered yet.</Text>
              <Text style={styles.emptyText}>
                Once Drapeon releases a completed order, the provider reference and settlement status will appear here.
              </Text>
            </View>
          ) : (
            collapseReplacedPayoutAttempts(data.payouts).map((row) => {
              const reviewMessage = payoutReviewMessage(row)
              const replaced = row.replacedAttempts
              const recoveryAction = blockedPayoutAction(row)
              return (
                <View key={row.id} style={styles.payoutCard}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{money(row.amount, row.currency)}</Text>
                      <Text style={styles.payoutPurpose}>{row.purposeLabel}</Text>
                    </View>
                    <DrapeStatusChip value={row.deliveryState} label={row.deliveryLabel} domain="payout" />
                  </View>
                  <Text style={styles.rowMeta}>
                    {[
                      row.orderReference ? `Order #${row.orderReference}` : null,
                      row.failedAt
                        ? `Failed ${shortDate(row.failedAt)}`
                        : row.completedAt
                          ? `Completed ${shortDate(row.completedAt)}`
                          : `Started ${shortDate(row.initiatedAt)}`,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  {row.expectedAt && row.deliveryState === 'BANK_PAYOUT_PENDING' ? (
                    <Text style={styles.rowMeta}>Estimated bank arrival {shortDate(row.expectedAt)}</Text>
                  ) : null}
                  {row.deliveryState !== 'IN_PROVIDER_BALANCE' ? <Text style={styles.reasonText}>{row.deliveryExplanation}</Text> : null}
                  <Text style={styles.payoutRef} numberOfLines={1} selectable>
                    {providerLabel(row.provider)} ref {row.providerReference ?? 'pending'}
                  </Text>
                  {reviewMessage ? <Text style={styles.reasonText}>{reviewMessage}</Text> : null}
                  {replaced.length > 0 ? (
                    <Text style={styles.rowMeta} accessibilityRole="text">
                      {replaced.length === 1 ? '1 earlier attempt' : `${replaced.length} earlier attempts`} didn't complete · replaced by this payout. Nothing for you to do.
                    </Text>
                  ) : null}
                  {recoveryAction ? (
                    <TouchableOpacity
                      style={styles.recoveryButton}
                      onPress={() => resetTo(router, {
                        pathname: recoveryAction.pathname,
                        params: recoveryAction.pathname.includes('[id]')
                          ? { id: row.orderId ?? '', returnTo: '/(tailor)/earnings' }
                          : { returnTo: '/(tailor)/earnings' },
                      } as never)}
                      accessibilityRole="button"
                      accessibilityLabel={`${recoveryAction.label} for ${row.orderReference ?? 'this payout'}`}
                    >
                      <Text style={styles.recoveryButtonText}>{recoveryAction.label}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )
            })
          )}
        </View>

        {bankActivity.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Withdrawals</Text>
            <Text style={styles.sectionHint}>
              Bank withdrawals are tracked for your payout account, separately from individual earnings. A withdrawal may combine several released earnings.
            </Text>
            {bankActivity.map((row) => (
              <View key={row.id} style={styles.payoutCard}>
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {row.amount !== null && row.currency ? money(row.amount, row.currency) : `${providerLabel(row.provider)} bank withdrawal`}
                    </Text>
                    <Text style={styles.rowMeta}>{row.bankPayoutReference ?? 'Provider reference pending'}</Text>
                  </View>
                  <DrapeStatusChip value={row.status} label={row.label} domain="payout" />
                </View>
                <Text style={styles.reasonText}>{row.explanation}</Text>
                {row.expectedAt && ['PENDING', 'IN_TRANSIT'].includes(row.status) ? (
                  <Text style={styles.rowMeta}>Estimated arrival {new Date(row.expectedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                ) : null}
                {row.failureMessage ? <Text style={styles.reasonText}>{row.failureMessage}</Text> : null}
                <Text style={styles.rowMeta}>Updated {new Date(row.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              </View>
            ))}
          </View>
        ) : null}
        </>) : null}
      </ScrollView>

      <TransactionBreakdownSheet
        row={breakdown}
        payoutCurrency={data.payoutCurrency}
        onClose={() => setBreakdown(null)}
        onOpenOrder={(orderId) => {
          setBreakdown(null)
          router.navigate({ pathname: '/(tailor)/orders/[id]', params: { id: orderId, historyChain: appendToHistory(undefined, '/(tailor)/earnings') } })
        }}
      />

      <EarningsFilterSheet
        visible={filterSheet !== null}
        title={filterSheet === 'status' ? 'Transaction status' : 'Date range'}
        options={filterSheet === 'status' ? STATUS_FILTERS : RANGE_FILTERS}
        selectedKey={filterSheet === 'status' ? statusFilter : rangeFilter}
        onClose={() => setFilterSheet(null)}
        onSelect={(key) => {
          if (filterSheet === 'status') {
            setStatusFilter(key as StatusFilter)
          } else {
            setRangeFilter(key as RangeFilter)
          }
          setFilterSheet(null)
        }}
      />
    </SafeAreaView>
  )
}

function EarningsFilterSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  options: Array<{ key: string; label: string }>
  selectedKey: string
  onSelect: (key: string) => void
  onClose: () => void
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filter picker">
              <Feather name="x" size={20} color={Colors.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.sheetOptionList}>
            {options.map((option) => {
              const active = selectedKey === option.key
              return (
                <TouchableOpacity
                  key={option.key}
                  style={styles.sheetOption}
                  onPress={() => onSelect(option.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>{option.label}</Text>
                  {active ? <Feather name="check" size={20} color={Colors.needleGreen} /> : null}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function weekRangeLabel(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth()
  const startText = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const endText = end.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  return sameMonth ? `${startText.split(' ')[1]} ${startText.split(' ')[0]}–${endText}` : `${startText} – ${endText}`
}

function TransactionBreakdownSheet({
  row,
  payoutCurrency,
  onClose,
  onOpenOrder,
}: {
  row: TailorTransactionRecord | null
  payoutCurrency: string
  onClose: () => void
  onOpenOrder: (orderId: string) => void
}) {
  return (
    <Modal transparent visible={row !== null} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close breakdown" />
        {row ? (
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{row.title}</Text>
                <Text style={styles.rowMeta}>
                  #{row.reference} · {row.customerFirstName} · {new Date(row.earnedAt ?? row.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </View>
              <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close breakdown">
                <Feather name="x" size={20} color={Colors.ink} />
              </TouchableOpacity>
            </View>
            <View style={styles.breakdownHero}>
              <Text style={styles.breakdownAmount}>{money(row.netAmount, row.netCurrency)}</Text>
              <DrapeStatusChip value={row.status} domain="payment" />
            </View>
            <View style={styles.breakdownList}>
              <BreakdownLine label="Your earnings" value={money(row.netAmount, row.netCurrency)} strong />
              {row.stagedReleaseBreakdown ? (
                <>
                  <BreakdownLine label="In provider balance" value={money(row.stagedReleaseBreakdown.inProviderBalance, row.stagedReleaseBreakdown.currency)} />
                  <BreakdownLine label="Pending release" value={money(row.stagedReleaseBreakdown.pending, row.stagedReleaseBreakdown.currency)} />
                </>
              ) : null}
              <View style={styles.breakdownDivider} />
              <Text style={styles.breakdownSection}>About this order</Text>
              <BreakdownLine label="Customer paid in total" value={money(row.orderAmount, row.orderCurrency)} />
              <BreakdownLine label="Tax collected for the authorities" value={money(row.taxAmount, row.taxCurrency)} />
              <BreakdownLine label="Drapeon platform fee" value={money(row.platformFeeAmount, row.taxCurrency)} />
            </View>
            <Text style={styles.breakdownNote}>
              The customer's total also covers tax, delivery and any fabric allowance. Those aren't part of your earnings; a fabric allowance is released separately against approved material costs.
            </Text>
            {row.statusReason ? <Text style={styles.reasonText}>{row.statusReason}</Text> : null}
            {row.convertedFromOriginal ? (
              <Text style={styles.currencyContextText}>
                Customer originally paid {money(row.originalOrderAmount, row.originalOrderCurrency)}; shown in {row.orderCurrency} at the locked order rate.
              </Text>
            ) : null}
            {row.netCurrency !== payoutCurrency ? (
              <Text style={styles.currencyContextText}>
                Locked in {row.netCurrency}. Ops must approve payout in the original currency or convert it into {payoutCurrency}.
              </Text>
            ) : null}
            <TouchableOpacity style={styles.breakdownButton} onPress={() => onOpenOrder(row.orderId)} accessibilityRole="button">
              <Text style={styles.breakdownButtonText}>Open order</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

function BreakdownLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.breakdownLine}>
      <Text style={[styles.breakdownLabel, strong && styles.breakdownStrong]}>{label}</Text>
      <Text style={[styles.breakdownValue, strong && styles.breakdownStrong]}>{value}</Text>
    </View>
  )
}

function MoneySummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.summaryBreakdownRow}>
      <Text style={styles.summaryBreakdownLabel}>{label}</Text>
      <Text style={[styles.summaryBreakdownValue, strong && styles.summaryBreakdownValueStrong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  scroll: { flex: 1 },
  content: { paddingBottom: DRAPE_CAPSULE_NAV_CONTENT_CLEARANCE + Spacing.lg },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
  },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  back: { width: 60, color: Colors.needleGreen, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  exportBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.warning + '55',
    ...Shadow.sm,
  },
  warningTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  warningBody: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 21 },
  pendingReleaseCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '25',
    padding: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  pendingReleaseIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingReleaseCopy: { flex: 1, gap: 4 },
  pendingReleaseTitle: {
    fontSize: FontSize.md,
    color: Colors.needleGreenDark,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  pendingReleaseText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },
  primaryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  primaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  summaryCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  summaryEyebrow: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.72)',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontWeight: FontWeight.semibold,
  },
  summaryValue: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.textInverse, letterSpacing: -0.6, fontFamily: Fonts.display },
  summaryHint: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.84)', lineHeight: 18 },
  summaryPill: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  summaryPillText: { color: Colors.textInverse, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  summaryStats: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  summaryStat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm, gap: 2 },
  summaryStatValue: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  summaryStatLabel: { color: 'rgba(255,255,255,0.78)', fontSize: 11 },
  summaryMethodRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  summaryMethodText: { flex: 1, color: 'rgba(255,255,255,0.9)', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  filterPills: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  filterPill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white },
  filterPillText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  payoutRef: { fontSize: 11, color: Colors.midGrey, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  failureBanner: { marginHorizontal: Spacing.lg, marginTop: Spacing.sm, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.statusPendingBg },
  failureBannerText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  failureBannerLink: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.needleGreenDark },
  tabBar: { flexDirection: 'row', marginHorizontal: Spacing.lg, marginTop: Spacing.sm, backgroundColor: Colors.boneDeep, borderRadius: Radius.full, padding: 4 },
  tabButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full },
  tabButtonActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabButtonText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  tabButtonTextActive: { color: Colors.ink },
  weekCard: { marginHorizontal: Spacing.lg, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: 4, ...Shadow.sm },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekHeadCopy: { alignItems: 'center' },
  weekArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.ink },
  weekRange: { fontSize: 12, color: Colors.inkLight },
  weekTotal: { fontSize: 34, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display, textAlign: 'center', letterSpacing: -0.6 },
  weekSub: { fontSize: 12, color: Colors.inkLight, textAlign: 'center' },
  weekChart: { flexDirection: 'row', gap: 8, height: 96, marginTop: Spacing.sm, alignItems: 'flex-end' },
  weekBarCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  weekBarTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  weekBar: { width: '100%', borderRadius: 6, backgroundColor: Colors.needleGreen, minHeight: 4 },
  weekBarEmpty: { backgroundColor: Colors.boneDeep },
  weekBarLabel: { fontSize: 11, color: Colors.midGrey },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listHeadSide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  searchToggle: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white, ...Shadow.sm },
  controlsCardInline: { marginHorizontal: 0 },
  listHeadMeta: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  listCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.sm },
  earningRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  earningRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.lightGrey },
  earningRowCopy: { flex: 1, minWidth: 0, gap: 2 },
  earningRowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  earningRowMeta: { fontSize: 12, color: Colors.inkLight },
  earningRowSplit: { fontSize: 12, lineHeight: 16, color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  earningRowSide: { alignItems: 'flex-end', gap: 4 },
  earningRowAmount: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  pastWeeks: { gap: Spacing.xs, marginTop: Spacing.md },
  pastWeeksTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.inkLight },
  pastWeekRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  pastWeekLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.ink },
  pastWeekAmount: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  breakdownHero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  breakdownAmount: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.needleGreenDark, fontFamily: Fonts.display },
  breakdownList: { gap: 10, marginTop: Spacing.md },
  breakdownLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  breakdownLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.inkLight },
  breakdownValue: { fontSize: FontSize.sm, color: Colors.ink },
  breakdownStrong: { fontWeight: FontWeight.bold, color: Colors.ink },
  breakdownSection: { fontSize: 12, fontWeight: FontWeight.bold, color: Colors.inkLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  breakdownNote: { fontSize: 12, lineHeight: 17, color: Colors.inkLight, marginTop: Spacing.sm },
  breakdownDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey },
  breakdownButton: { minHeight: 48, marginTop: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center' },
  breakdownButtonText: { color: Colors.textInverse, fontWeight: FontWeight.bold, fontSize: FontSize.sm },
  netRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: Spacing.md, marginTop: Spacing.sm },
  netValue: { fontSize: 22, fontWeight: FontWeight.bold, color: Colors.needleGreenDark, fontFamily: Fonts.display },
  netLabel: { fontSize: 11, color: Colors.inkLight },
  netSide: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  netSideText: { fontSize: 12, color: Colors.inkLight },
  summaryBreakdown: {
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.24)',
    paddingTop: Spacing.xs,
    gap: 5,
  },
  summaryBreakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  summaryBreakdownLabel: { color: 'rgba(255,255,255,0.76)', fontSize: FontSize.xs },
  summaryBreakdownValue: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  summaryBreakdownValueStrong: { fontWeight: FontWeight.bold },
  summaryMetaCard: {
    marginTop: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: Spacing.sm,
    gap: 2,
  },
  summaryMetaLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.76)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: FontWeight.semibold,
  },
  summaryMetaValue: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
  summaryMetaHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.76)',
    lineHeight: 16,
  },
  currencyNoticeCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.kanteRustLight,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  currencyNoticeTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  currencyNoticeText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  currencyBreakdownList: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.sm,
  },
  currencyBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
  },
  currencyBreakdownLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
  },
  currencyBreakdownValue: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  statsGrid: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  breakdownCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  breakdownRail: {
    flexDirection: 'row',
    gap: 4,
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
    backgroundColor: Colors.boneDeep,
  },
  breakdownSegmentPending: {
    backgroundColor: Colors.kanteRust,
  },
  breakdownSegmentAvailable: {
    backgroundColor: Colors.needleGreenDark,
  },
  breakdownSegmentPaid: {
    backgroundColor: Colors.needleGreen,
  },
  breakdownLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  breakdownLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownDotPending: {
    backgroundColor: Colors.kanteRust,
  },
  breakdownDotAvailable: {
    backgroundColor: Colors.needleGreenDark,
  },
  breakdownDotPaid: {
    backgroundColor: Colors.needleGreen,
  },
  breakdownLegendText: {
    fontSize: 11,
    color: Colors.midGrey,
  },
  statCard: {
    width: '47%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    ...Shadow.sm,
  },
  statLabel: { fontSize: FontSize.xs, color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  statHint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 16 },
  controlsCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  section: { marginHorizontal: Spacing.lg, marginTop: Spacing.md, gap: Spacing.sm },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  sectionHint: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 21 },
  searchInput: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.bone,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: FontSize.sm,
    color: Colors.ink,
    minHeight: 44,
  },
  clearFiltersBtn: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
  },
  clearFiltersText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    fontWeight: FontWeight.medium,
  },
  filterPanel: {
    backgroundColor: Colors.bone,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  filterSelectRow: {
    minHeight: 58,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  filterDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.lightGrey, marginLeft: Spacing.md },
  filterSelectLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  filterSelectValue: { marginTop: 2, fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.semibold },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(26,26,24,0.35)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 48,
    height: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: FontSize.lg, color: Colors.ink, fontWeight: FontWeight.bold, fontFamily: Fonts.display },
  sheetCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionList: { gap: 2 },
  sheetOption: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.lightGrey,
  },
  sheetOptionText: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  sheetOptionTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  controlsHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  inlineErrorCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 4,
  },
  inlineErrorTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.error },
  inlineErrorText: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyText: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 19 },
  transactionCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  payoutCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 6,
    ...Shadow.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  rowTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  payoutPurpose: {
    marginTop: 3,
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  rowMeta: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, marginTop: 2 },
  moneyBreakdown: {
    borderTopWidth: 1,
    borderTopColor: Colors.lightGrey,
    paddingTop: Spacing.sm,
    gap: 8,
  },
  moneyLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  currencyContextText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 16 },
  moneyLabel: { fontSize: FontSize.sm, color: Colors.inkLight, flex: 1 },
  moneyValue: { fontSize: FontSize.sm, color: Colors.ink, fontWeight: FontWeight.medium },
  moneyValueStrong: { fontSize: FontSize.md, color: Colors.needleGreenDark, fontWeight: FontWeight.bold },
  reasonText: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  recoveryButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.needleGreen,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  recoveryButtonText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
})
