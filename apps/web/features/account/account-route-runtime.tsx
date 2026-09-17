'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { resolveAccountRuntimeRole } from '@drape/shared/auth-role'
import { createClient } from '../../lib/supabase'
import { useSessionTimeout } from '../../hooks/use-session-timeout'
import {
  WEB_ACCOUNT_CACHE_INVALIDATE_EVENT,
  WEB_ACCOUNT_IDENTITY_UPDATE_EVENT,
  type WebAccountIdentityUpdate,
} from '../../lib/web-account-cache-events'
import { invalidateAccountData } from '../../lib/account-data-cache'
import { AccountWorkspaceShell } from './account-workspace-shell'
import { accountHomeRoute, accountSurfaceAllowedForRole } from './navigation-contract'
import type { AccountSurface } from './surface-contract'

export type AccountRouteIdentity = {
  role: 'CUSTOMER' | 'TAILOR'
  email: string
  displayName: string
  avatarUrl: string | null
  activeOrders: number
  unreadMessages: number
  unreadNotifications: number
  checkoutPendingCount: number
  payoutNeedsSetup: boolean
  setupRequired: boolean
  customerSetupRequired: boolean
}

type RuntimeState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'ready'; session: Session; identity: AccountRouteIdentity }
  | { status: 'error'; message: string }

const terminalStages = new Set([
  'COMPLETE',
  'COMPLETED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
])
const identityCache = new Map<string, { value: AccountRouteIdentity; expiresAt: number }>()
const identityRequests = new Map<string, Promise<AccountRouteIdentity>>()
const IDENTITY_CACHE_TTL_MS = 45_000
const CUSTOMER_SETUP_PROMPT_DISMISSED_EVENT = 'drapeon:customer-setup-prompt-dismissed'
const dismissedCustomerSetupPromptUserIds = new Set<string>()
type AccountRuntimeContextValue = { session: Session; identity: AccountRouteIdentity }
const AccountRuntimeContext = createContext<AccountRuntimeContextValue | null>(null)

function customerSetupPromptStorageKey(userId: string) {
  return `drapeon.customer-setup-prompt.dismissed.${userId}`
}

function subscribeToCustomerSetupPromptDismissal(onStoreChange: () => void) {
  window.addEventListener(CUSTOMER_SETUP_PROMPT_DISMISSED_EVENT, onStoreChange)
  return () => window.removeEventListener(CUSTOMER_SETUP_PROMPT_DISMISSED_EVENT, onStoreChange)
}

function customerSetupPromptNotDismissed() {
  return false
}

function useCustomerSetupPromptDismissed(userId: string | null) {
  const getSnapshot = useCallback(() => {
    if (!userId) return false
    if (dismissedCustomerSetupPromptUserIds.has(userId)) return true
    try {
      return window.sessionStorage.getItem(customerSetupPromptStorageKey(userId)) === '1'
    } catch {
      return false
    }
  }, [userId])

  return useSyncExternalStore(
    subscribeToCustomerSetupPromptDismissal,
    getSnapshot,
    customerSetupPromptNotDismissed,
  )
}

const workspaceRoutes = [
  '/account/dashboard',
  '/account/explore',
  '/account/saved',
  '/account/brief',
  '/account/orders',
  '/account/messages',
  '/account/measurements',
  '/account/shop',
  '/account/items',
  '/account/checkout',
  '/account/work',
  '/account/earnings',
  '/account/payout',
  '/account/profile',
  '/account/notifications',
  '/account/settings',
  '/account/support',
  '/account/tailors',
  '/account/call-join',
]

function surfaceForPath(pathname: string): AccountSurface {
  if (pathname.startsWith('/account/orders/')) return 'order-detail'
  if (pathname.startsWith('/account/items/')) return 'item-detail'
  if (pathname.startsWith('/account/tailors/')) return 'explore'
  if (pathname.startsWith('/account/brief/')) return 'brief'
  if (pathname.startsWith('/account/checkout')) return 'checkout'
  if (pathname.startsWith('/account/call-join')) return 'call'
  const segment = pathname.split('/')[2]
  const known: Partial<Record<string, AccountSurface>> = {
    dashboard: 'work',
    explore: 'explore',
    saved: 'saved',
    orders: 'orders',
    messages: 'messages',
    measurements: 'measurements',
    shop: 'shop',
    work: 'work',
    earnings: 'earnings',
    payout: 'payout',
    profile: 'profile',
    notifications: 'notifications',
    settings: 'settings',
    support: 'support',
  }
  return (segment ? known[segment] : undefined) ?? 'work'
}

function payoutNeedsSetup(profile: Record<string, unknown> | null) {
  return profile?.payout_reverification_required === true
}

function sessionRole(session: Session): AccountRouteIdentity['role'] | null {
  const role = session.user.user_metadata?.role
  return role === 'CUSTOMER' || role === 'TAILOR' ? role : null
}

function identityCacheKey(session: Session) {
  return `${session.user.id}:${sessionRole(session) ?? 'UNSET'}`
}

async function loadIdentity(session: Session): Promise<AccountRouteIdentity> {
  const userId = session.user.id
  const supabase = createClient()
  const [customerResult, tailorResult, userResult] = await Promise.all([
    supabase
      .from('customer_profiles')
      .select('display_name, avatar_url, phone, unit_preference, garment_context, measurements')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select('id, display_name, business_name, avatar_url, profile_completed, is_live')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('users').select('role').eq('id', userId).maybeSingle(),
  ])
  if (customerResult.error && tailorResult.error) throw new Error('Your account could not load.')

  const customer = customerResult.data as {
    display_name?: string | null
    avatar_url?: string | null
    phone?: string | null
    unit_preference?: string | null
    garment_context?: string | null
    measurements?: { unit?: unknown; garmentContext?: unknown } | null
  } | null
  let tailor = tailorResult.data as
    | (Record<string, unknown> & {
        id: string
        display_name?: string | null
        business_name?: string | null
        avatar_url?: string | null
      })
    | null
  const storedRole =
    userResult.data?.role === 'CUSTOMER' || userResult.data?.role === 'TAILOR'
      ? userResult.data.role
      : null
  const requestedRole = sessionRole(session) ?? storedRole
  const role: AccountRouteIdentity['role'] = resolveAccountRuntimeRole({
    requestedRole,
    hasTailorProfile: Boolean(tailor),
  })
  if (tailor?.id) {
    // Only columns `authenticated` may read. Payout provider identifiers
    // (stripe_*, paystack_*, manual_bank_*) are revoked at the column-privilege
    // layer and live behind service-role Edge Functions. Asking for even one of
    // them makes Postgres refuse the WHOLE select with 42501, which silently
    // wiped the payout and setup flags this identity depends on.
    const payoutResult = await supabase
      .from('tailor_profiles')
      .select('payout_reverification_required, payout_account_verified')
      .eq('user_id', userId)
      .maybeSingle()
    if (!payoutResult.error && payoutResult.data) tailor = { ...tailor, ...payoutResult.data }
  }
  const orderFilter = tailor?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailor.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`
  const ordersResult = await supabase
    .from('orders')
    .select('id, stage, order_kind, seller_item_id, customer_id, tailor_id, tailor_profile_id')
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)
  const orders = (ordersResult.data ?? []) as Array<{
    id: string
    stage: string | null
    order_kind: string | null
    seller_item_id: string | null
    customer_id: string | null
    tailor_id: string | null
    tailor_profile_id: string | null
  }>
  const active = orders.filter((order) => !terminalStages.has(order.stage ?? ''))
  const customerActive = active.filter(
    (order) =>
      order.customer_id === userId &&
      !(order.order_kind === 'READY_MADE' && order.seller_item_id == null)
  )
  const tailorActive = active.filter(
    (order) => order.tailor_id === userId || order.tailor_profile_id === tailor?.id
  )
  const checkoutPendingCount = orders.filter((order) =>
    ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  ).length
  let unreadMessages = 0
  let unreadNotifications = 0
  if (orders.length > 0) {
    const messagesResult = await supabase
      .from('messages')
      .select('sender_id, read_at')
      .in(
        'order_id',
        orders.map((order) => order.id)
      )
      .order('created_at', { ascending: false })
      .limit(100)
    unreadMessages = (
      (messagesResult.data ?? []) as Array<{ sender_id: string | null; read_at: string | null }>
    ).filter((message) => message.sender_id !== userId && !message.read_at).length
  }
  const inboxResult = await supabase.functions.invoke('communications-action', {
    body: { action: 'INBOX_LIST', limit: 1 },
  })
  if (!inboxResult.error && typeof inboxResult.data?.unreadCount === 'number') {
    unreadNotifications = inboxResult.data.unreadCount
  }
  const metadataName =
    typeof session.user.user_metadata?.display_name === 'string'
      ? session.user.user_metadata.display_name.trim()
      : ''
  const email = session.user.email ?? ''
  const activeProfile = role === 'TAILOR' ? tailor : customer
  const activeProfileName =
    role === 'TAILOR' ? tailor?.business_name || tailor?.display_name : customer?.display_name
  const displayName = String(activeProfileName || metadataName || email.split('@')[0] || 'Drapeon')
  const customerMeasurements = customer?.measurements ?? {}
  const customerPhone = String(customer?.phone || session.user.user_metadata?.phone || '').trim()
  const customerSetupRequired =
    role === 'CUSTOMER' &&
    !(
      String(customer?.display_name || '').trim() &&
      customerPhone &&
      (customer?.unit_preference === 'in' ||
        customer?.unit_preference === 'cm' ||
        customerMeasurements.unit === 'in' ||
        customerMeasurements.unit === 'cm') &&
      (customer?.garment_context === 'MENSWEAR' ||
        customer?.garment_context === 'WOMENSWEAR' ||
        customer?.garment_context === 'BOTH' ||
        customer?.garment_context === 'PREFER_NOT_TO_SAY' ||
        customerMeasurements.garmentContext === 'MENSWEAR' ||
        customerMeasurements.garmentContext === 'WOMENSWEAR' ||
        customerMeasurements.garmentContext === 'BOTH' ||
        customerMeasurements.garmentContext === 'PREFER_NOT_TO_SAY')
    )
  return {
    role,
    email,
    displayName,
    avatarUrl: String(activeProfile?.avatar_url || '') || null,
    activeOrders: role === 'TAILOR' ? tailorActive.length : customerActive.length,
    unreadMessages,
    unreadNotifications,
    checkoutPendingCount,
    payoutNeedsSetup: role === 'TAILOR' && payoutNeedsSetup(tailor),
    setupRequired:
      role === 'TAILOR' && tailor?.profile_completed !== true && tailor?.is_live !== true,
    customerSetupRequired,
  }
}

function loadIdentityCached(session: Session) {
  const cacheKey = identityCacheKey(session)
  const cached = identityCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  const pending = identityRequests.get(cacheKey)
  if (pending) return pending
  const request = loadIdentity(session)
    .then((value) => {
      identityCache.set(cacheKey, { value, expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS })
      return value
    })
    .finally(() => identityRequests.delete(cacheKey))
  identityRequests.set(cacheKey, request)
  return request
}

function SignedOut() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentPath = pathname || '/account'
  const query = searchParams.toString()
  const returnPath = query ? `${currentPath}?${query}` : currentPath
  return (
    <main className="min-h-screen bg-ui-canvas">
      <div className="mx-auto max-w-xl px-5 py-20">
        <div className="app-surface p-7">
          <p className="text-xs font-semibold uppercase text-needle/80">Account</p>
          <h1 className="mt-3 text-4xl text-ink">Sign in to continue.</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">
            Access your protected orders, messages, measurements, payments, and saved work.
          </p>
          <Link
            href={`/sign-in?next=${encodeURIComponent(returnPath)}`}
            className="mt-6 inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  )
}

function StandaloneAccountRouteRuntime({
  surface,
  children,
}: {
  surface: AccountSurface
  children: (context: AccountRuntimeContextValue) => ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname() || '/account'
  const searchParams = useSearchParams()
  const [state, setState] = useState<RuntimeState>({ status: 'loading' })
  const userId = state.status === 'ready' ? state.session.user.id : null
  const customerSetupPromptDismissed = useCustomerSetupPromptDismissed(userId)
  const showCustomerSetupPrompt =
    state.status === 'ready' &&
    state.identity.customerSetupRequired &&
    pathname !== '/account/customer/setup' &&
    !customerSetupPromptDismissed
  const onboardingInProgress =
    state.status === 'ready' &&
    (state.identity.setupRequired ||
      pathname === '/account/customer/setup' ||
      (pathname === '/account/profile' && searchParams.get('setup') === '1'))
  useSessionTimeout({
    enabled: Boolean(userId),
    pauseWhileHidden: onboardingInProgress,
  })

  useEffect(() => {
    const supabase = createClient()
    let active = true
    let initialized = false
    let pendingSession: Session | null | undefined
    let validationId = 0
    async function acceptSession(session: Session | null) {
      const currentValidationId = ++validationId
      if (!active) return
      if (!session) {
        if (currentValidationId === validationId) setState({ status: 'signed-out' })
        return
      }
      setState({ status: 'loading' })
      try {
        // getSession() can return a locally cached JWT after Ops has deleted the
        // Auth user. Verify the session against GoTrue before rendering any
        // protected account data so account deletion revokes an open web tab
        // immediately instead of waiting for the access token to expire.
        const { data: verified, error: verificationError } = await supabase.auth.getUser()
        if (verificationError || !verified.user || verified.user.id !== session.user.id) {
          identityCache.clear()
          identityRequests.clear()
          invalidateAccountData()
          await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          if (active && currentValidationId === validationId) setState({ status: 'signed-out' })
          return
        }
        const identity = await loadIdentityCached(session)
        if (active && currentValidationId === validationId)
          setState({ status: 'ready', session, identity })
      } catch (error) {
        if (active && currentValidationId === validationId)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Your account could not load.',
          })
      }
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase emits INITIAL_SESSION while the first getSession() call is
      // still resolving. Ignore that duplicate event, but retain any real
      // sign-out/token event so it cannot race the initial validation.
      if (!initialized) {
        if (event !== 'INITIAL_SESSION') pendingSession = session
        return
      }
      void acceptSession(session)
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      initialized = true
      const session = pendingSession === undefined ? data.session : pendingSession
      pendingSession = undefined
      void acceptSession(session)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (state.status !== 'ready') return
    if (!accountSurfaceAllowedForRole(state.identity.role, surface))
      router.replace(accountHomeRoute(state.identity.role))
    else if (
      state.identity.setupRequired &&
      (pathname !== '/account/profile' || searchParams.get('setup') !== '1')
    )
      router.replace('/account/profile?setup=1')
  }, [pathname, router, searchParams, state, surface])

  function dismissCustomerSetupPrompt() {
    if (state.status === 'ready') {
      dismissedCustomerSetupPromptUserIds.add(state.session.user.id)
      try {
        window.sessionStorage.setItem(customerSetupPromptStorageKey(state.session.user.id), '1')
      } catch {
        // Storage can be unavailable in private browsing. The prompt still
        // closes for the current render cycle through the external-store event.
      }
      window.dispatchEvent(new Event(CUSTOMER_SETUP_PROMPT_DISMISSED_EVENT))
    }
  }

  useEffect(() => {
    const invalidate = () => {
      identityCache.clear()
      identityRequests.clear()
      invalidateAccountData()
    }
    window.addEventListener(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, invalidate)
    return () => window.removeEventListener(WEB_ACCOUNT_CACHE_INVALIDATE_EVENT, invalidate)
  }, [])

  useEffect(() => {
    const updateIdentity = (event: Event) => {
      const update = (event as CustomEvent<WebAccountIdentityUpdate>).detail
      if (!update || !Object.prototype.hasOwnProperty.call(update, 'avatarUrl')) return
      setState((current) => {
        if (current.status !== 'ready') return current
        const identity = { ...current.identity, avatarUrl: update.avatarUrl ?? null }
        identityCache.set(identityCacheKey(current.session), {
          value: identity,
          expiresAt: Date.now() + IDENTITY_CACHE_TTL_MS,
        })
        return { ...current, identity }
      })
    }
    window.addEventListener(WEB_ACCOUNT_IDENTITY_UPDATE_EVENT, updateIdentity)
    return () => window.removeEventListener(WEB_ACCOUNT_IDENTITY_UPDATE_EVENT, updateIdentity)
  }, [])

  if (state.status === 'loading')
    return (
      <main className="grid min-h-screen place-items-center bg-ui-canvas">
        <p className="text-sm font-semibold text-ink/60">Loading your account…</p>
      </main>
    )
  if (state.status === 'signed-out') return <SignedOut />
  if (state.status === 'error')
    return (
      <main className="grid min-h-screen place-items-center bg-ui-canvas">
        <div className="app-surface max-w-md p-7">
          <h1 className="text-2xl font-semibold text-ink">Account unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-ink/64">{state.message} Refresh to retry.</p>
        </div>
      </main>
    )
  const invalidRoleSurface = !accountSurfaceAllowedForRole(state.identity.role, surface)
  const redirectingToSetup =
    state.identity.setupRequired &&
    (pathname !== '/account/profile' || searchParams.get('setup') !== '1')
  if (invalidRoleSurface || redirectingToSetup)
    return (
      <main className="grid min-h-screen place-items-center bg-ui-canvas">
        <p className="text-sm font-semibold text-ink/60">
          Opening your{' '}
          {redirectingToSetup
              ? 'tailor setup'
              : state.identity.role === 'TAILOR'
                ? 'tailor dashboard'
                : 'account'}
          …
        </p>
      </main>
    )
  if (state.identity.setupRequired) {
    return <>{children({ session: state.session, identity: state.identity })}</>
  }
  return (
    <>
      <AccountWorkspaceShell {...state.identity} surface={surface}>
        {children({ session: state.session, identity: state.identity })}
      </AccountWorkspaceShell>
      {showCustomerSetupPrompt ? (
        <div className="fixed inset-0 z-[120] grid place-items-end bg-ink/35 p-4 sm:place-items-center sm:p-6" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-setup-prompt-title"
            className="w-full max-w-md rounded-[20px] border border-ink/10 bg-white p-6 shadow-2xl"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Welcome to Drapeon</p>
            <h2 id="customer-setup-prompt-title" className="mt-3 text-3xl leading-tight text-ink">
              Your account is ready.
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink/64">
              Add a few preferences now so your first brief and fit experience feel personal. You can
              keep exploring and finish it later.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={dismissCustomerSetupPrompt}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-bone"
              >
                I&apos;ll do this later
              </button>
              <Link
                href="/account/customer/setup"
                onClick={dismissCustomerSetupPrompt}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-needle-600"
              >
                Complete setup
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

export function AccountRouteRuntime({
  surface,
  children,
}: {
  surface: AccountSurface
  children: (context: AccountRuntimeContextValue) => ReactNode
}) {
  const inherited = useContext(AccountRuntimeContext)
  return inherited ? (
    children(inherited)
  ) : (
    <StandaloneAccountRouteRuntime surface={surface}>{children}</StandaloneAccountRouteRuntime>
  )
}

export function PersistentAccountRuntime({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/account'
  const managed = workspaceRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
  if (!managed) return children
  return (
    <AccountRouteRuntime surface={surfaceForPath(pathname)}>
      {(context) => (
        <AccountRuntimeContext.Provider value={context}>{children}</AccountRuntimeContext.Provider>
      )}
    </AccountRouteRuntime>
  )
}
