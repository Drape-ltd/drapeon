'use client'

import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import {
  getLifecycleEventDefinition,
  sanitizeLifecycleProperties,
  type LifecycleEventName,
} from '@drape/shared/lifecycle-events'

type AnalyticsProperties = Record<string, boolean | number | string | null | undefined>
export type WebAnalyticsConsent = 'unknown' | 'granted' | 'denied'

export const ANALYTICS_CONSENT_KEY = 'drapeon.analytics-consent.v1'
export const ANALYTICS_QA_BUFFER_KEY = 'drapeon.analytics-buffer.v1'
const CONSENT_CHANGE_EVENT = 'drapeon:analytics-consent-change'
let runtimeConsent: WebAnalyticsConsent = 'unknown'

export type BufferedAnalyticsEvent = {
  name: string
  properties: AnalyticsProperties
  path: string
  capturedAt: string
}

declare global {
  interface Window {
    __DRAPEON_ANALYTICS_BUFFER__?: BufferedAnalyticsEvent[]
  }
}

const PUBLIC_ANALYTICS_ROUTES = new Set([
  '/',
  '/about',
  '/customers',
  '/explore',
  '/faq',
  '/help',
  '/how-it-works',
  '/partnerships',
  '/pricing',
  '/tailors',
  '/terms',
  '/trust',
  '/verify',
  '/vision',
  '/whats-new',
])

function isPublicAnalyticsRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return PUBLIC_ANALYTICS_ROUTES.has(pathname) || pathname.startsWith('/tailors/')
}

export function useWebAnalyticsConsent(): WebAnalyticsConsent {
  return useSyncExternalStore(
    subscribeToWebAnalyticsConsent,
    readWebAnalyticsConsent,
    getServerWebAnalyticsConsent,
  )
}

export function readWebAnalyticsConsent(): WebAnalyticsConsent {
  if (typeof window === 'undefined') return 'unknown'
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : runtimeConsent
  } catch {
    return runtimeConsent
  }
}

function writeWebAnalyticsConsent(value: Exclude<WebAnalyticsConsent, 'unknown'>): void {
  if (typeof window === 'undefined') return
  runtimeConsent = value
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value)
  } catch {
    // Private browsing/storage restrictions must fail closed: no analytics.
  }
  if (value === 'denied') {
    delete window.__DRAPEON_ANALYTICS_BUFFER__
    try {
      window.sessionStorage.removeItem(ANALYTICS_QA_BUFFER_KEY)
    } catch {
      // Storage restrictions are already fail-closed for analytics.
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: value }))
  } catch {
    // Event dispatch is only a cross-component convenience; the caller still
    // updates its own state when browser event APIs are unavailable.
  }
}

function subscribeToWebAnalyticsConsent(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(CONSENT_CHANGE_EVENT, onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

function getServerWebAnalyticsConsent(): WebAnalyticsConsent {
  return 'unknown'
}

export function readWebAnalyticsBuffer(): BufferedAnalyticsEvent[] {
  if (typeof window === 'undefined') return []
  if (window.__DRAPEON_ANALYTICS_BUFFER__) return window.__DRAPEON_ANALYTICS_BUFFER__
  if (process.env.NODE_ENV !== 'development') return []
  try {
    const raw = window.sessionStorage.getItem(ANALYTICS_QA_BUFFER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const buffer = parsed as BufferedAnalyticsEvent[]
    window.__DRAPEON_ANALYTICS_BUFFER__ = buffer
    return buffer
  } catch {
    return []
  }
}

function persistWebAnalyticsBuffer(buffer: BufferedAnalyticsEvent[]): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  try {
    window.sessionStorage.setItem(ANALYTICS_QA_BUFFER_KEY, JSON.stringify(buffer))
  } catch {
    // The in-memory buffer remains useful when session storage is unavailable.
  }
}

export function trackWebEvent(eventName: string, properties: AnalyticsProperties = {}): void {
  if (typeof window === 'undefined') return
  if (readWebAnalyticsConsent() !== 'granted') return

  const cleanedProperties = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value != null)
  ) as AnalyticsProperties
  const event: BufferedAnalyticsEvent = {
    name: eventName,
    properties: cleanedProperties,
    path: window.location.pathname,
    capturedAt: new Date().toISOString(),
  }
  const buffer = readWebAnalyticsBuffer()
  buffer.push(event)
  if (buffer.length > 200) buffer.splice(0, buffer.length - 200)
  window.__DRAPEON_ANALYTICS_BUFFER__ = buffer
  persistWebAnalyticsBuffer(buffer)
  try {
    window.dispatchEvent(new CustomEvent('drapeon:analytics', { detail: event }))
  } catch {
    // A telemetry hook must never turn an otherwise successful user action into an error.
  }
  if (process.env.NEXT_PUBLIC_WEB_ANALYTICS_DEBUG === '1') {
    console.info('[web analytics]', eventName, cleanedProperties)
  }
}

/**
 * Contract-aware entry point for conversion and education events. Web
 * analytics remains disabled until the consent path is explicitly enabled;
 * this helper only validates and sanitizes the event that would be sent.
 */
export function trackLifecycleEvent(
  eventName: LifecycleEventName,
  properties: Record<string, unknown> = {}
): void {
  const definition = getLifecycleEventDefinition(eventName)
  if (!definition || definition.source !== 'UI_ANALYTICS') return

  const { accepted, rejected } = sanitizeLifecycleProperties(eventName, properties)
  if (rejected.length > 0 && process.env.NEXT_PUBLIC_WEB_ANALYTICS_DEBUG === '1') {
    console.warn('[web analytics blocked properties]', eventName, rejected)
  }

  trackWebEvent(`${eventName}.v${definition.version}`, accepted)
}

function AnalyticsConsentBanner({ onDecision }: { onDecision: (value: 'granted' | 'denied') => void }): React.JSX.Element {
  return (
    <aside
      role="dialog"
      aria-label="Analytics preference"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-[14px] border border-ui-border bg-white p-4 shadow-[0_18px_60px_rgba(22,28,24,0.16)] sm:inset-x-auto sm:right-5 sm:w-[min(100%-2.5rem,34rem)]"
    >
      <p className="text-sm font-semibold text-ink">Help us improve Drapeon</p>
      <p className="mt-1 text-xs leading-5 text-ink/60">
        Optional, anonymous usage analytics help us see which public pages are useful. Nothing runs
        until you choose, and we never record account, message, measurement, payment, or replay data.
        <Link href="/privacy#analytics" className="ml-1 font-semibold text-needle underline underline-offset-2">
          Read our privacy policy.
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDecision('granted')}
          className="inline-flex min-h-9 items-center justify-center rounded-full bg-needle px-4 text-xs font-semibold text-white transition-colors hover:bg-needle-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        >
          Allow analytics
        </button>
        <button
          type="button"
          onClick={() => onDecision('denied')}
          className="inline-flex min-h-9 items-center justify-center rounded-full border border-ink/14 bg-white px-4 text-xs font-semibold text-ink transition-colors hover:bg-ui-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        >
          Keep analytics off
        </button>
      </div>
    </aside>
  )
}

export function WebAnalytics(): React.JSX.Element | null {
  const pathname = usePathname()
  const storedConsent = useWebAnalyticsConsent()
  const [decisionOverride, setDecisionOverride] = useState<WebAnalyticsConsent | null>(null)
  // A local decision closes the banner immediately even if a browser blocks storage events.
  // Once the external store has a value, it wins so a different tab can still update consent.
  const consent = storedConsent !== 'unknown' ? storedConsent : decisionOverride ?? 'unknown'

  useEffect(() => {
    if (consent !== 'granted' || !isPublicAnalyticsRoute(pathname)) return
    trackLifecycleEvent('marketing_page_viewed', {
      page: pathname === '/' ? 'home' : pathname.slice(1),
      entry_surface: 'web',
    })
  }, [consent, pathname])

  useEffect(() => {
    if (consent !== 'granted' || !isPublicAnalyticsRoute(pathname)) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-analytics-event]')
        : null
      if (!target) return
      const rawEvent = target.dataset.analyticsEvent?.trim()
      if (!rawEvent) return
      if (rawEvent === 'product_update_opened') {
        trackLifecycleEvent('product_update_opened', {
          update_id: target.dataset.analyticsLabel?.trim() || rawEvent,
          entry_surface: 'web',
        })
        return
      }
      if (rawEvent === 'guide_started') {
        const guideVersion = Number(target.dataset.analyticsVersion)
        trackLifecycleEvent('guide_started', {
          guide_id: target.dataset.analyticsLabel?.trim() || rawEvent,
          role: target.dataset.analyticsRole?.trim() || 'ANONYMOUS',
          entry_surface: 'web',
          guide_version: Number.isFinite(guideVersion) ? guideVersion : 1,
        })
        return
      }
      trackLifecycleEvent('marketing_cta_clicked', {
        page: pathname === '/' ? 'home' : pathname.slice(1),
        cta: target.dataset.analyticsLabel?.trim() || rawEvent,
        entry_surface: 'web',
      })
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [consent, pathname])

  if (!isPublicAnalyticsRoute(pathname) || consent !== 'unknown') return null
  return (
    <AnalyticsConsentBanner
      onDecision={(value) => {
        // Update this tree immediately; the store event keeps other consumers and tabs in sync.
        setDecisionOverride(value)
        writeWebAnalyticsConsent(value)
      }}
    />
  )
}
