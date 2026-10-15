'use client'

import { useEffect, useState } from 'react'
import type { OpsNavigationCounts } from '../../../supabase/functions/_shared/ops-queue-page'

export function useNavigationCounts(routeKey: string) {
  const [snapshot, setSnapshot] = useState<{ routeKey: string; counts: OpsNavigationCounts | null } | null>(null)
  useEffect(() => {
    let disposed = false
    let inFlight = false
    let lastAttempt = 0
    let controller: AbortController | null = null
    async function refresh() {
      if (document.hidden || inFlight || Date.now() - lastAttempt < 30_000) return
      inFlight = true
      lastAttempt = Date.now()
      controller = new AbortController()
      const requestController = controller
      const timeout = window.setTimeout(() => requestController.abort(), 10_000)
      try {
        const response = await fetch('/api/navigation-counts', { cache: 'no-store', signal: requestController.signal })
        if (!response.ok) throw new Error('Counts unavailable')
        const data = await response.json()
        if (!data || !['mine', 'open', 'approvals'].every((key) => Number.isSafeInteger(data[key]) && data[key] >= 0)) throw new Error('Invalid counts')
        if (!disposed) setSnapshot({ routeKey, counts: data })
      } catch {
        if (!disposed) setSnapshot({ routeKey, counts: null })
      } finally { window.clearTimeout(timeout); inFlight = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [routeKey])
  return snapshot?.routeKey === routeKey ? snapshot.counts : null
}
