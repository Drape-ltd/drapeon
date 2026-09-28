'use client'

import { useEffect, useState } from 'react'
import { FULFILLMENT_METHODS, type FulfillmentMethod } from '@drape/shared'
import { invokeAccountFunction } from './account-data-queries'

/** Request-keyed results prevent a previous seller or retry's methods flashing. */
export function useFulfillmentOptions(tailorId: string | null | undefined, enabled = true) {
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${tailorId ?? ''}:${attempt}`
  const [result, setResult] = useState<{ key: string; methods: FulfillmentMethod[] | null; failed: boolean } | null>(null)
  useEffect(() => {
    if (!tailorId || !enabled) return
    let active = true
    void invokeAccountFunction<{ data: { methods: unknown } }>('read-gateway', {
      action: 'fulfillment-options', tailorId,
    }).then(response => {
      if (!active) return
      const methods = response.data?.methods
      if (!Array.isArray(methods) || !methods.every(method => FULFILLMENT_METHODS.includes(method))) throw new Error('Options unavailable')
      setResult({ key: requestKey, methods: methods as FulfillmentMethod[], failed: false })
    }).catch(() => { if (active) setResult({ key: requestKey, methods: null, failed: true }) })
    return () => { active = false }
  }, [tailorId, enabled, requestKey])
  const current = result?.key === requestKey ? result : null
  return { methods: current?.methods ?? null, failed: current?.failed ?? false, retry: () => setAttempt(value => value + 1) }
}
