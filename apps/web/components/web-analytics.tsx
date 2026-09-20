'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

type AnalyticsProperties = Record<string, boolean | number | string | null | undefined>

const fastlaneEventEndpoint =
  'https://aromatic-caribou-889.convex.site/api/v1/events/'
const fastlaneTrackingId = 'am_G-ks8L1yVCn_Gwfz'
const publicMarketingPaths = new Set([
  '/',
  '/about',
  '/careers',
  '/contact',
  '/customers',
  '/discover',
  '/explore',
  '/faq',
  '/help',
  '/how-it-works',
  '/legal',
  '/partnerships',
  '/payouts',
  '/press',
  '/pricing',
  '/privacy',
  '/security',
  '/status',
  '/tailors',
  '/terms',
  '/trust',
  '/vision',
])

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function isPublicMarketingPath(pathname: string) {
  return publicMarketingPaths.has(pathname) || pathname.startsWith('/tailors/')
}

function isProductionDrapeonHost() {
  const hostname = window.location.hostname.toLowerCase()
  return hostname === 'drapeon.co' || hostname === 'www.drapeon.co'
}

function sendFastlaneEvent(event: Record<string, string | number>) {
  const body = JSON.stringify({
    batchId: newId(),
    trackingId: fastlaneTrackingId,
    events: [event],
  })
  const blob = new Blob([body], { type: 'application/json' })

  if (navigator.sendBeacon?.(fastlaneEventEndpoint, blob)) return

  void fetch(fastlaneEventEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

function publicPageUrl(pathname: string) {
  return `${window.location.origin}${pathname}`
}

export function trackWebEvent(eventName: string, properties: AnalyticsProperties = {}): void {
  if (typeof window === 'undefined') return
  if (process.env.NEXT_PUBLIC_WEB_ANALYTICS_DEBUG !== '1') return

  const cleanedProperties = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value != null)
  ) as AnalyticsProperties
  console.info('[web analytics disabled]', eventName, cleanedProperties)
}

export function WebAnalytics(): null {
  const pathname = usePathname()
  const visitorId = useRef<string | null>(null)
  const sessionId = useRef<string | null>(null)

  useEffect(() => {
    if (!isProductionDrapeonHost() || !isPublicMarketingPath(pathname)) return

    visitorId.current ??= newId()
    sessionId.current ??= newId()

    const enteredAt = Date.now()
    const url = publicPageUrl(pathname)
    let pageLeaveSent = false

    sendFastlaneEvent({
      eventType: 'page_view',
      visitorId: visitorId.current,
      sessionId: sessionId.current,
      // Never include query parameters, hashes, auth paths, or account paths.
      url,
      path: pathname,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: navigator.language,
      timestamp: enteredAt,
    })

    const sendPageLeave = () => {
      if (pageLeaveSent) return
      pageLeaveSent = true
      sendFastlaneEvent({
        eventType: 'page_leave',
        visitorId: visitorId.current ?? newId(),
        sessionId: sessionId.current ?? newId(),
        url,
        path: pathname,
        scrollDepth: Math.round(
          100 * Math.max(0, Math.min(1, (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight))
        ),
        timeOnPage: Date.now() - enteredAt,
        timestamp: Date.now(),
      })
    }

    window.addEventListener('pagehide', sendPageLeave)
    return () => {
      window.removeEventListener('pagehide', sendPageLeave)
      sendPageLeave()
    }
  }, [pathname])

  return null
}
