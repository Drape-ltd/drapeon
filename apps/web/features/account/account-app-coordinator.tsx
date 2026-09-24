'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { BellRing } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { AccountWorkspaceShell } from './account-workspace-shell'
import { AccountAuthRequiredState, AccountRouteLoadingState } from './shared/account-route-states'
import { isRealtimeFilterValue, uniqueRealtimeOrderIds } from '@drape/shared/realtime-identifiers'
import { createClient } from '../../lib/supabase'
import { safeEntityName, safeUserText } from '../../lib/safe-display'
import { WEB_ACCOUNT_CACHE_INVALIDATE_EVENT } from '../../lib/web-account-cache-events'
import { AccountSurface } from './surface-contract'
import { ORDER_REALTIME_CHILD_TABLES, ORDER_REALTIME_ROW_EVENTS, ORDER_REALTIME_SURFACES } from './shared/account-realtime-config'
import type { AccountBaseData, AccountOrder, AccountShellData, CheckoutSurfaceData, EarningsSurfaceData, ExploreSurfaceData, ItemDetailSurfaceData, MessagesSurfaceData, OrderDetailSurfaceData, OrdersSurfaceData, ProfileSurfaceData, SavedSurfaceData, SettingsSurfaceData, ShopSurfaceData, SupportSurfaceData, WorkSurfaceData } from './shared/account-data-contracts'
import { emptyCheckoutSurfaceData, emptyData, emptyEarningsSurfaceData, emptyExploreSurfaceData, emptyItemDetailSurfaceData, emptyMessagesSurfaceData, emptyOrderDetailSurfaceData, emptyOrdersSurfaceData, emptyProfileSurfaceData, emptySavedSurfaceData, emptySettingsSurfaceData, emptyShellData, emptyShopSurfaceData, emptySupportSurfaceData, emptyWorkSurfaceData } from './shared/account-empty-data'
import { fetchAccountShellData, fetchCheckoutSurfaceData, fetchEarningsSurfaceData, fetchExploreSurfaceData, fetchItemDetailSurfaceData, fetchMessagesSurfaceData, fetchOrderDetailSurfaceData, fetchOrdersSurfaceData, fetchProfileSurfaceData, fetchSavedSurfaceData, fetchSettingsSurfaceData, fetchShopSurfaceData, fetchSupportSurfaceData, fetchWorkSurfaceData } from './shared/account-data-queries'
import { registerWebPushSubscription } from '../../lib/web-push-client'
import { RenderMessages, cleanLabel, currentNotificationPermission, orderTitle, safeMediaUrl } from './messages/account-messages-surface'
import { AccountContextProvider, AccountContextValue } from '../../components/account-context'
import { Button } from '../../components/ui/button'
import { Surface } from '../../components/ui/surface'
import { RenderEarnings, RenderPayout } from './payouts/account-payout-surfaces'
import { RenderShop } from './shop/account-shop-surface'
import { RenderProfile } from './profile/account-profile-surface'
import { RenderOrderDetail } from './orders/account-order-detail-surface'
import { RenderExplore, RenderItemDetail, RenderSaved } from './marketplace/account-marketplace-surfaces'
import { RenderCheckout, RenderOrders, RenderWork } from './orders/account-order-list-surfaces'
import { RenderSettings, RenderSupport } from './settings/account-settings-support-surfaces'

function accountDataFromShell(
  shellData: AccountShellData,
  warningOverride?: string | null
): AccountBaseData {
  return {
    ...emptyData,
    userId: shellData.userId,
    accountCurrency: shellData.accountCurrency,
    customerProfile: shellData.customerProfile,
    tailorProfile: shellData.tailorProfile,
    warning: warningOverride ?? null,
  }
}

let _lastKnownSession: Session | null = null

const _shellCache = new Map<string, { shellData: AccountShellData; at: number }>()

const SHELL_CACHE_TTL = 45_000

function shellCacheRead(userId: string): AccountShellData | null {
  const e = _shellCache.get(userId)
  if (!e || Date.now() - e.at > SHELL_CACHE_TTL) return null
  return e.shellData
}

function shellCacheWrite(userId: string, shellData: AccountShellData) {
  _shellCache.set(userId, { shellData, at: Date.now() })
}

function shellCacheDelete(userId: string) {
  _shellCache.delete(userId)
}

function readCachedShellSnapshot() {
  const session = _lastKnownSession
  if (!session?.user.id) return null
  const shellData = shellCacheRead(session.user.id)
  return shellData ? { session, shellData } : null
}

async function fetchAccountShellDataCached(uid: string): Promise<AccountShellData> {
  const cached = shellCacheRead(uid)
  if (cached) return cached

  const result = await fetchAccountShellData(uid)
  shellCacheWrite(uid, result)
  return result
}

function AccountRouteShell({
  session,
  data,
  shellData,
  surface,
  children,
}: {
  session: Session
  data: AccountBaseData
  shellData: AccountShellData
  surface: AccountSurface
  children: ReactNode
}) {
  const hasTailorWorkspace = Boolean(shellData.tailorProfile)
  const metadataName =
    typeof session.user.user_metadata?.display_name === 'string'
      ? session.user.user_metadata.display_name
      : null
  const customerName = shellData.customerProfile?.display_name ?? null
  const tailorName =
    shellData.tailorProfile?.business_name || shellData.tailorProfile?.display_name || null
  const email = session.user.email ?? ''
  const displayName = safeEntityName(
    hasTailorWorkspace
      ? tailorName || customerName || metadataName
      : customerName || tailorName || metadataName,
    email ? (email.split('@')[0] ?? 'Drapeon') : 'Drapeon'
  )
  const avatarUrl = safeMediaUrl(
    hasTailorWorkspace
      ? (shellData.tailorProfile?.avatar_url ?? shellData.customerProfile?.avatar_url)
      : (shellData.customerProfile?.avatar_url ?? shellData.tailorProfile?.avatar_url),
    'avatars'
  )

  return (
    <AccountWorkspaceShell
      role={hasTailorWorkspace ? 'TAILOR' : 'CUSTOMER'}
      surface={surface}
      email={email}
      displayName={displayName}
      avatarUrl={avatarUrl}
      activeOrders={
        hasTailorWorkspace ? shellData.tailorActiveOrderCount : shellData.customerActiveOrderCount
      }
      unreadMessages={shellData.unreadCount}
      checkoutPendingCount={shellData.checkoutPendingCount}
      payoutNeedsSetup={shellData.payoutNeedsSetup}
      warning={data.warning}
    >
      {children}
    </AccountWorkspaceShell>
  )
}

function AuthRequiredCard() {
  const pathname = usePathname()
  return <AccountAuthRequiredState pathname={pathname} />
}

function LoadingCard() {
  return <AccountRouteLoadingState />
}

type AccountRealtimeNotice = {
  key: string
  orderId: string | null
  title: string
  body: string
}

function realtimeRecordValue(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function fallbackOrderTitle(orderId: string | null, ordersById: Map<string, AccountOrder>) {
  if (!orderId) return 'Drapeon order'
  return ordersById.get(orderId) ? orderTitle(ordersById.get(orderId)!) : 'Drapeon order'
}

function buildAccountRealtimeNotice({
  table,
  event,
  payload,
  ordersById,
  userId,
}: {
  table: string
  event: string
  payload: unknown
  ordersById: Map<string, AccountOrder>
  userId: string
}): AccountRealtimeNotice | null {
  const typedPayload = payload as { new?: Record<string, unknown>; old?: Record<string, unknown> }
  const record = typedPayload.new ?? typedPayload.old ?? null
  if (!record) return null

  const recordId = realtimeRecordValue(record, 'id')
  const orderId = realtimeRecordValue(record, table === 'orders' ? 'id' : 'order_id')
  const orderCopy = fallbackOrderTitle(orderId, ordersById)
  const key = `${table}:${event}:${recordId ?? orderId ?? Date.now().toString()}`

  if (table === 'messages') {
    if (event !== 'INSERT' || realtimeRecordValue(record, 'sender_id') === userId) return null
    return {
      key,
      orderId,
      title: `New message: ${orderCopy}`,
      body: safeUserText(
        realtimeRecordValue(record, 'body'),
        realtimeRecordValue(record, 'photo_url') || realtimeRecordValue(record, 'voice_url')
          ? 'New media message'
          : 'New order message'
      ),
    }
  }

  if (table === 'orders') {
    if (event === 'INSERT') {
      return {
        key,
        orderId,
        title:
          realtimeRecordValue(record, 'tailor_id') === userId
            ? 'New order request'
            : 'Order created',
        body: `${orderCopy} is now ${cleanLabel(realtimeRecordValue(record, 'stage'), 'in progress')}.`,
      }
    }
    if (event === 'UPDATE') {
      return {
        key,
        orderId,
        title: `Order updated: ${orderCopy}`,
        body: `${orderCopy} is now ${cleanLabel(realtimeRecordValue(record, 'stage'), 'in progress')}.`,
      }
    }
    return null
  }

  if (table === 'order_stage_updates' && event === 'INSERT') {
    return {
      key,
      orderId,
      title: `Stage update: ${orderCopy}`,
      body: safeUserText(
        realtimeRecordValue(record, 'note'),
        cleanLabel(realtimeRecordValue(record, 'stage'), 'Order stage updated')
      ),
    }
  }

  if (table === 'order_payments' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Payment update: ${orderCopy}`,
      body: `${cleanLabel(realtimeRecordValue(record, 'phase'), 'Payment')} is ${cleanLabel(realtimeRecordValue(record, 'status'), 'pending')}.`,
    }
  }

  if (table === 'order_material_advances' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Material advance update: ${orderCopy}`,
      body: `${cleanLabel(realtimeRecordValue(record, 'title'), 'Material advance')} is ${cleanLabel(realtimeRecordValue(record, 'status'), 'pending')}.`,
    }
  }

  if (table === 'order_production_evidence' && event === 'INSERT') {
    return {
      key,
      orderId,
      title: `Production update: ${orderCopy}`,
      body: 'New production proof was added to the order.',
    }
  }

  if (table === 'reviews' && (event === 'INSERT' || event === 'UPDATE')) {
    return {
      key,
      orderId,
      title: `Review update: ${orderCopy}`,
      body: 'Review activity changed on this order.',
    }
  }

  if (table === 'custom_order_details' && event === 'UPDATE') {
    return {
      key,
      orderId,
      title: `Brief updated: ${orderCopy}`,
      body: 'Custom order details changed.',
    }
  }

  return null
}

function AccountDesktopAlertsPrompt({
  permission,
  onEnable,
}: {
  permission: NotificationPermission | 'unsupported'
  onEnable: () => void
}) {
  if (permission !== 'default') return null

  return (
    <Surface className="mb-4 flex flex-col gap-3 px-4 py-3 text-sm text-ink/66 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Enable desktop alerts for order messages, stage changes, and payment updates while web is
        open.
      </span>
      <Button onClick={onEnable} size="sm" className="shrink-0">
        <BellRing />
        Enable alerts
      </Button>
    </Surface>
  )
}

export function AccountAppSurface({
  surface,
  orderId,
  tailorId,
  itemId,
  embedded = false,
}: {
  surface: AccountSurface
  orderId?: string
  tailorId?: string
  itemId?: string
  embedded?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const clearAccountCaches = () => {
      _shellCache.clear()
      _lastKnownSession = null
    }
    window.addEventListener(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, clearAccountCaches)
    return () => window.removeEventListener(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, clearAccountCaches)
  }, [])

  const [cachedSnapshot] = useState(readCachedShellSnapshot)
  const [session, setSession] = useState<Session | null>(cachedSnapshot?.session ?? null)
  const [data, setData] = useState<AccountBaseData>(
    cachedSnapshot ? accountDataFromShell(cachedSnapshot.shellData) : emptyData
  )
  const [shellData, setShellData] = useState<AccountShellData>(
    cachedSnapshot?.shellData ?? emptyShellData
  )
  const [exploreData, setExploreData] = useState<ExploreSurfaceData>(emptyExploreSurfaceData)
  const [ordersData, setOrdersData] = useState<OrdersSurfaceData>(emptyOrdersSurfaceData)
  const [orderDetailData, setOrderDetailData] = useState<OrderDetailSurfaceData>(
    emptyOrderDetailSurfaceData
  )
  const [supportData, setSupportData] = useState<SupportSurfaceData>(emptySupportSurfaceData)
  const [shopData, setShopData] = useState<ShopSurfaceData>(emptyShopSurfaceData)
  const [workData, setWorkData] = useState<WorkSurfaceData>(emptyWorkSurfaceData)
  const [messagesData, setMessagesData] = useState<MessagesSurfaceData>(emptyMessagesSurfaceData)
  const [savedData, setSavedData] = useState<SavedSurfaceData>(emptySavedSurfaceData)
  const [checkoutData, setCheckoutData] = useState<CheckoutSurfaceData>(emptyCheckoutSurfaceData)
  const [earningsData, setEarningsData] = useState<EarningsSurfaceData>(emptyEarningsSurfaceData)
  const [profileData, setProfileData] = useState<ProfileSurfaceData>(emptyProfileSurfaceData)
  const [settingsData, setSettingsData] = useState<SettingsSurfaceData>(emptySettingsSurfaceData)
  const [itemDetailData, setItemDetailData] = useState<ItemDetailSurfaceData>(
    emptyItemDetailSurfaceData
  )
  // Shell identity may be cached, but every route-owned dataset must finish before
  // the surface is declared ready. This prevents stale content flashing between
  // customer/tailor routes during fast client navigation.
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [orderNotificationPermission, setOrderNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => currentNotificationPermission())
  const orderNotificationPermissionRef = useRef<NotificationPermission | 'unsupported'>(
    'unsupported'
  )
  const orderRealtimeNoticeKeysRef = useRef<Set<string>>(new Set())
  const accountWebPushRegistrationRef = useRef(false)
  const accountUserId = session?.user.id ?? null
  const orderRealtimeIdsKey = useMemo(() => {
    if (surface === 'order-detail') {
      return uniqueRealtimeOrderIds([orderId, orderDetailData.order?.id]).join(',')
    }
    if (surface === 'orders') {
      return uniqueRealtimeOrderIds(ordersData.orders.map((order) => order.id)).join(',')
    }
    if (surface === 'work') {
      return uniqueRealtimeOrderIds(workData.orders.map((order) => order.id)).join(',')
    }
    if (surface === 'checkout') {
      return uniqueRealtimeOrderIds([
        orderId,
        ...checkoutData.orders.map((order) => order.id),
      ]).join(',')
    }
    return ''
  }, [
    checkoutData.orders,
    orderDetailData.order?.id,
    orderId,
    ordersData.orders,
    surface,
    workData.orders,
  ])
  const realtimeOrdersById = useMemo(() => {
    const orders = [
      ...ordersData.orders,
      ...workData.orders,
      ...checkoutData.orders,
      ...(orderDetailData.order ? [orderDetailData.order] : []),
    ]
    return new Map(orders.map((order) => [order.id, order]))
  }, [checkoutData.orders, orderDetailData.order, ordersData.orders, workData.orders])

  useEffect(() => {
    orderNotificationPermissionRef.current = orderNotificationPermission
  }, [orderNotificationPermission])

  const saveAccountWebPushSubscription = useCallback(async () => {
    if (!accountUserId) return
    const registration = await registerWebPushSubscription('/account')
    if (!registration.ok) {
      if (registration.reason !== 'not-configured') {
        console.warn('[web push] Account subscription not registered.', registration.reason)
      }
      return
    }

    const { endpoint, keys } = registration.subscription
    const { error } = await createClient()
      .from('web_push_subscriptions')
      .upsert(
        {
          audience: 'ACCOUNT',
          user_id: accountUserId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: window.navigator.userAgent,
          enabled: true,
          last_seen_at: new Date().toISOString(),
          failed_at: null,
          failure_reason: null,
        },
        { onConflict: 'endpoint' }
      )
      .select('id')
      .maybeSingle()

    if (error) {
      console.warn('[web push] Account subscription could not be saved.', error.message)
    }
  }, [accountUserId])

  async function requestOrderNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setOrderNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setOrderNotificationPermission(permission)
    if (permission !== 'granted') return
    accountWebPushRegistrationRef.current = true
    await saveAccountWebPushSubscription()
  }

  useEffect(() => {
    if (
      !accountUserId ||
      !ORDER_REALTIME_SURFACES.has(surface) ||
      orderNotificationPermission !== 'granted' ||
      accountWebPushRegistrationRef.current
    ) {
      return
    }

    accountWebPushRegistrationRef.current = true
    void saveAccountWebPushSubscription()
  }, [accountUserId, orderNotificationPermission, saveAccountWebPushSubscription, surface])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return
      _lastKnownSession = sessionData.session
      setSession(sessionData.session)
      if (!sessionData.session?.user.id) {
        setData(emptyData)
        setShellData(emptyShellData)
        setExploreData(emptyExploreSurfaceData)
        setOrdersData(emptyOrdersSurfaceData)
        setOrderDetailData(emptyOrderDetailSurfaceData)
        setSupportData(emptySupportSurfaceData)
        setShopData(emptyShopSurfaceData)
        setWorkData(emptyWorkSurfaceData)
        setMessagesData(emptyMessagesSurfaceData)
        setSavedData(emptySavedSurfaceData)
        setCheckoutData(emptyCheckoutSurfaceData)
        setEarningsData(emptyEarningsSurfaceData)
        setProfileData(emptyProfileSurfaceData)
        setSettingsData(emptySettingsSurfaceData)
        setItemDetailData(emptyItemDetailSurfaceData)
        setLoading(false)
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession?.user.id) {
        setData(emptyData)
        setShellData(emptyShellData)
        setExploreData(emptyExploreSurfaceData)
        setOrdersData(emptyOrdersSurfaceData)
        setOrderDetailData(emptyOrderDetailSurfaceData)
        setSupportData(emptySupportSurfaceData)
        setShopData(emptyShopSurfaceData)
        setWorkData(emptyWorkSurfaceData)
        setMessagesData(emptyMessagesSurfaceData)
        setSavedData(emptySavedSurfaceData)
        setCheckoutData(emptyCheckoutSurfaceData)
        setEarningsData(emptyEarningsSurfaceData)
        setProfileData(emptyProfileSurfaceData)
        setSettingsData(emptySettingsSurfaceData)
        setItemDetailData(emptyItemDetailSurfaceData)
        setLoading(false)
      }
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user.id || !ORDER_REALTIME_SURFACES.has(surface)) return
    const watchedOrderIds = orderRealtimeIdsKey ? orderRealtimeIdsKey.split(',') : []
    if (surface === 'order-detail' && watchedOrderIds.length === 0) return

    const userId = session.user.id
    const tailorProfileId = shellData.tailorProfile?.id ?? data.tailorProfile?.id ?? null
    const watchCustomerOrders = surface === 'orders' || surface === 'checkout'
    const watchTailorOrders = surface === 'orders' || surface === 'work'
    const supabase = createClient()
    const channel = supabase.channel(
      `account-order-sync:${surface}:${userId}:${orderRealtimeIdsKey || 'all'}`
    )
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleRealtimeRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        setReloadKey((current) => current + 1)
      }, 350)
    }

    const maybeNotify = (table: string, event: string, payload: unknown) => {
      if (
        typeof window === 'undefined' ||
        orderNotificationPermissionRef.current !== 'granted' ||
        document.visibilityState === 'visible'
      ) {
        return
      }
      const notice = buildAccountRealtimeNotice({
        table,
        event,
        payload,
        ordersById: realtimeOrdersById,
        userId,
      })
      if (!notice || orderRealtimeNoticeKeysRef.current.has(notice.key)) return
      orderRealtimeNoticeKeysRef.current.add(notice.key)
      const desktopNotice = new Notification(notice.title, {
        body: notice.body,
        icon: '/icon-192.png',
        tag: notice.key,
      })
      desktopNotice.onclick = () => {
        window.focus()
        if (notice.orderId) window.location.href = `/account/orders/${notice.orderId}`
      }
    }

    const watchTableFilter = (table: string, filter: string) => {
      for (const event of ORDER_REALTIME_ROW_EVENTS) {
        channel.on('postgres_changes', { event, schema: 'public', table, filter }, (payload) => {
          maybeNotify(table, event, payload)
          scheduleRealtimeRefresh()
        })
      }
    }

    if (surface === 'order-detail') {
      for (const id of watchedOrderIds) {
        watchTableFilter('orders', `id=eq.${id}`)
      }
    } else {
      if (watchCustomerOrders && isRealtimeFilterValue(userId)) {
        watchTableFilter('orders', `customer_id=eq.${userId}`)
      }
      if (watchTailorOrders && isRealtimeFilterValue(userId)) {
        watchTableFilter('orders', `tailor_id=eq.${userId}`)
      }
      if (watchTailorOrders && isRealtimeFilterValue(tailorProfileId)) {
        watchTableFilter('orders', `tailor_profile_id=eq.${tailorProfileId}`)
      }
    }

    for (const id of watchedOrderIds) {
      const childTables =
        surface === 'order-detail'
          ? ORDER_REALTIME_CHILD_TABLES
          : surface === 'checkout'
            ? (['order_payments'] as const)
            : surface === 'orders'
              ? (['consultation_attendance_reviews'] as const)
              : []
      for (const table of childTables) {
        watchTableFilter(table, `order_id=eq.${id}`)
      }
    }

    channel.subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [
    data.tailorProfile?.id,
    orderRealtimeIdsKey,
    realtimeOrdersById,
    session?.user.id,
    shellData.tailorProfile?.id,
    surface,
  ])

  useEffect(() => {
    if (!session?.user.id) return
    const userId = session.user.id
    const supabase = createClient()
    const channel = supabase.channel(`account-verification-review-sync:${userId}`)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleReviewRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        setReloadKey((current) => current + 1)
      }, 350)
    }

    for (const table of ['profile_change_requests', 'payout_change_requests'] as const) {
      for (const event of ORDER_REALTIME_ROW_EVENTS) {
        channel.on(
          'postgres_changes',
          { event, schema: 'public', table, filter: `tailor_user_id=eq.${userId}` },
          scheduleReviewRefresh
        )
      }
    }

    channel.subscribe()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') scheduleReviewRefresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [session?.user.id])

  useEffect(() => {
    if (!session?.user.id) return
    const currentUserId = session.user.id
    let active = true

    async function loadSurfaceData() {
      const userId = currentUserId
      if (surface === 'explore') {
        const [nextShellData, nextExploreData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchExploreSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setExploreData(nextExploreData)
        setData(accountDataFromShell(nextShellData, nextExploreData.warning))
        return
      }
      if (surface === 'orders') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextOrdersData = await fetchOrdersSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setOrdersData(nextOrdersData)
        setData(accountDataFromShell(nextShellData, nextOrdersData.warning))
        return
      }
      if (surface === 'order-detail') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextOrderDetailData = await fetchOrderDetailSurfaceData(
          userId,
          orderId,
          nextShellData.tailorProfile?.id
        )
        if (!active) return
        setShellData(nextShellData)
        setOrderDetailData(nextOrderDetailData)
        setData(accountDataFromShell(nextShellData, nextOrderDetailData.warning))
        return
      }
      if (surface === 'messages') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextMessagesData = await fetchMessagesSurfaceData(
          userId,
          nextShellData.tailorProfile?.id
        )
        if (!active) return
        setShellData(nextShellData)
        setMessagesData(nextMessagesData)
        setData(accountDataFromShell(nextShellData, nextMessagesData.warning))
        return
      }
      if (surface === 'payout') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        if (!active) return
        setShellData(nextShellData)
        setData(accountDataFromShell(nextShellData))
        return
      }
      if (surface === 'support') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextSupportData = await fetchSupportSurfaceData(
          userId,
          nextShellData.tailorProfile?.id
        )
        if (!active) return
        setShellData(nextShellData)
        setSupportData(nextSupportData)
        setData(accountDataFromShell(nextShellData, nextSupportData.warning))
        return
      }
      if (surface === 'shop') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextShopData = await fetchShopSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setShopData(nextShopData)
        setData(accountDataFromShell(nextShellData, nextShopData.warning))
        return
      }
      if (surface === 'work') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextWorkData = await fetchWorkSurfaceData(userId, nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setWorkData(nextWorkData)
        setData(accountDataFromShell(nextShellData, nextWorkData.warning))
        return
      }
      if (surface === 'saved') {
        const [nextShellData, nextSavedData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchSavedSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setSavedData(nextSavedData)
        setData(accountDataFromShell(nextShellData, nextSavedData.warning))
        return
      }
      if (surface === 'checkout') {
        const [nextShellData, nextCheckoutData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchCheckoutSurfaceData(userId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setCheckoutData(nextCheckoutData)
        setData(accountDataFromShell(nextShellData, nextCheckoutData.warning))
        return
      }
      if (surface === 'earnings') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextEarningsData = await fetchEarningsSurfaceData(
          userId,
          nextShellData.tailorProfile?.id
        )
        if (!active) return
        setShellData(nextShellData)
        setEarningsData(nextEarningsData)
        setData(accountDataFromShell(nextShellData, nextEarningsData.warning))
        return
      }
      if (surface === 'profile') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextProfileData = await fetchProfileSurfaceData(nextShellData.tailorProfile?.id)
        if (!active) return
        setShellData(nextShellData)
        setProfileData(nextProfileData)
        setData(accountDataFromShell(nextShellData, nextProfileData.warning))
        return
      }
      if (surface === 'settings') {
        const nextShellData = await fetchAccountShellDataCached(userId)
        const nextSettingsData = await fetchSettingsSurfaceData(
          userId,
          nextShellData.tailorProfile?.id
        )
        if (!active) return
        setShellData(nextShellData)
        setSettingsData(nextSettingsData)
        setData(accountDataFromShell(nextShellData, nextSettingsData.warning))
        return
      }
      if (surface === 'item-detail') {
        const [nextShellData, nextItemDetailData] = await Promise.all([
          fetchAccountShellDataCached(userId),
          fetchItemDetailSurfaceData(itemId),
        ])
        if (!active) return
        setShellData(nextShellData)
        setItemDetailData(nextItemDetailData)
        setData(accountDataFromShell(nextShellData, nextItemDetailData.warning))
      }
    }

    loadSurfaceData()
      .catch(() => {
        if (!active) return
        const fallbackShellData: AccountShellData = {
          ...emptyShellData,
          userId: currentUserId,
          warning: 'Account data could not load. Refresh to retry.',
        }
        setShellData(fallbackShellData)
        if (surface === 'earnings') {
          setEarningsData({ ...emptyEarningsSurfaceData, warning: 'Earnings data could not load.' })
        }
        setData(accountDataFromShell(fallbackShellData))
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [itemId, orderId, reloadKey, session?.user.id, surface, tailorId])

  const content = useMemo(() => {
    const onRefresh = () => {
      if (session?.user.id) shellCacheDelete(session.user.id)
      setReloadKey((current) => current + 1)
    }
    switch (surface) {
      case 'explore':
        return (
          <RenderExplore
            data={{
              ...exploreData,
              userId: shellData.userId ?? data.userId,
              accountCurrency: shellData.accountCurrency ?? data.accountCurrency,
            }}
          />
        )
      case 'orders':
        return (
          <RenderOrders
            data={{
              ...ordersData,
              userId: shellData.userId ?? data.userId,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
          />
        )
      case 'order-detail':
        return (
          <RenderOrderDetail
            data={{
              ...orderDetailData,
              userId: shellData.userId ?? data.userId,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            onRefresh={onRefresh}
          />
        )
      case 'messages':
        return (
          <RenderMessages
            data={{ ...messagesData, userId: shellData.userId ?? data.userId }}
            onRefresh={onRefresh}
          />
        )
      case 'shop':
        return (
          <RenderShop
            data={{
              ...shopData,
              userId: shellData.userId ?? data.userId,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
              pickupDetails: shellData.pickupDetails,
            }}
            onRefresh={onRefresh}
          />
        )
      case 'work':
        return (
          <RenderWork
            data={{
              ...workData,
              userId: shellData.userId ?? data.userId,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            onRefresh={onRefresh}
          />
        )
      case 'earnings':
        return (
          <RenderEarnings
            data={{ ...earningsData, tailorProfile: shellData.tailorProfile ?? data.tailorProfile }}
          />
        )
      case 'payout':
        return (
          <RenderPayout
            data={{ tailorProfile: shellData.tailorProfile ?? data.tailorProfile }}
            onRefresh={onRefresh}
          />
        )
      case 'profile':
        return (
          <RenderProfile
            data={{
              ...profileData,
              userId: shellData.userId ?? data.userId,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
              pickupDetails: shellData.pickupDetails,
            }}
            session={session}
            onRefresh={onRefresh}
          />
        )
      case 'checkout':
        return (
          <RenderCheckout
            data={{ ...checkoutData, userId: shellData.userId ?? data.userId }}
            orderId={orderId}
            onRefresh={onRefresh}
          />
        )
      case 'saved':
        return <RenderSaved data={savedData} />
      case 'settings':
        return (
          <RenderSettings
            data={{
              ...settingsData,
              userId: shellData.userId ?? data.userId,
              accountCurrency: shellData.accountCurrency ?? data.accountCurrency,
              customerProfile: shellData.customerProfile ?? data.customerProfile,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            session={session}
            onRefresh={onRefresh}
          />
        )
      case 'support':
        return (
          <RenderSupport
            data={{
              ...supportData,
              userId: shellData.userId ?? data.userId,
              tailorProfile: shellData.tailorProfile,
            }}
            onRefresh={onRefresh}
          />
        )
      case 'item-detail':
        return (
          <RenderItemDetail
            data={{
              ...itemDetailData,
              userId: shellData.userId ?? data.userId,
              tailorProfile: shellData.tailorProfile ?? data.tailorProfile,
            }}
            onRefresh={onRefresh}
          />
        )
      default:
        return null
    }
  }, [
    checkoutData,
    data,
    earningsData,
    exploreData,
    itemDetailData,
    messagesData,
    orderDetailData,
    orderId,
    ordersData,
    profileData,
    savedData,
    session,
    settingsData,
    shellData.accountCurrency,
    shellData.customerProfile,
    shellData.pickupDetails,
    shellData.tailorProfile,
    shellData.userId,
    shopData,
    supportData,
    surface,
    workData,
  ])

  const accountContextValue = useMemo<AccountContextValue | null>(() => {
    const userId = session?.user.id ?? shellData.userId ?? data.userId
    if (!userId) return null

    const customerProfile = shellData.customerProfile ?? data.customerProfile
    const tailorProfile = shellData.tailorProfile ?? data.tailorProfile
    const role = tailorProfile ? 'TAILOR' : 'CUSTOMER'

    return {
      userId,
      role,
      defaultCurrency: shellData.accountCurrency ?? data.accountCurrency,
      customerProfile: customerProfile
        ? {
            userId: customerProfile.user_id,
            displayName: safeEntityName(customerProfile.display_name, '') || null,
            avatarUrl: customerProfile.avatar_url,
          }
        : null,
      tailorProfile: tailorProfile
        ? {
            id: tailorProfile.id,
            userId: tailorProfile.user_id,
            displayName: safeEntityName(tailorProfile.display_name, '') || null,
            businessName: safeEntityName(tailorProfile.business_name, '') || null,
            avatarUrl: tailorProfile.avatar_url,
          }
        : null,
    }
  }, [
    data.accountCurrency,
    data.customerProfile,
    data.tailorProfile,
    data.userId,
    session?.user.id,
    shellData.accountCurrency,
    shellData.customerProfile,
    shellData.tailorProfile,
    shellData.userId,
  ])

  if (loading || (session?.user.id && data.userId !== session.user.id)) {
    const loadingLabel = surface === 'profile'
      ? 'Loading tailor setup…'
      : surface === 'messages'
        ? 'Loading conversations…'
        : 'Loading your account…'
    return embedded ? <div className="app-surface min-h-52 animate-pulse p-6"><p className="text-sm font-semibold text-ink/55">{loadingLabel}</p></div> : <LoadingCard />
  }
  if (!session) return <AuthRequiredCard />
  if (!accountContextValue) return <LoadingCard />

  const routeContent = (
    <AccountContextProvider value={accountContextValue}>
      {ORDER_REALTIME_SURFACES.has(surface) ? (
        <AccountDesktopAlertsPrompt
          permission={orderNotificationPermission}
          onEnable={() => {
            void requestOrderNotifications()
          }}
        />
      ) : null}
      {content}
    </AccountContextProvider>
  )

  if (embedded) return routeContent

  return (
    <AccountContextProvider value={accountContextValue}>
      <AccountRouteShell session={session} data={data} shellData={shellData} surface={surface}>
        {ORDER_REALTIME_SURFACES.has(surface) ? (
          <AccountDesktopAlertsPrompt
            permission={orderNotificationPermission}
            onEnable={() => {
              void requestOrderNotifications()
            }}
          />
        ) : null}
        {content}
      </AccountRouteShell>
    </AccountContextProvider>
  )
}
