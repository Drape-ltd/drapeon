'use client'

import { useEffect, useState } from 'react'
import {
  convertWithReferenceFxRates,
  formatMoney,
  parseReferenceFxRates,
  SUPPORTED_ACCOUNT_CURRENCIES,
  type AccountCurrencyCode,
} from '@drape/shared'

type Snapshot = ReturnType<typeof parseReferenceFxRates>

let cachedSnapshot: Snapshot = null
let cachedAt = 0
let pendingRequest: Promise<Snapshot> | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

async function loadReferenceRates(): Promise<Snapshot> {
  if (cachedSnapshot && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSnapshot
  if (pendingRequest) return pendingRequest

  pendingRequest = (async () => {
    try {
      const quotes = SUPPORTED_ACCOUNT_CURRENCIES.filter((code) => code !== 'USD').join(',')
      const response = await fetch(
        `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${quotes}`,
        {
          signal: AbortSignal.timeout(5000),
        }
      )
      if (!response.ok) return null
      const parsed = parseReferenceFxRates(await response.json(), SUPPORTED_ACCOUNT_CURRENCIES)
      if (!parsed) return null
      cachedSnapshot = parsed
      cachedAt = Date.now()
      return parsed
    } catch {
      return null
    } finally {
      pendingRequest = null
    }
  })()

  return pendingRequest
}

function formatRateDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) return date
  return parsed.toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Display-only conversion. Never use this component to derive a checkout amount. */
export function ReferenceCurrencyEstimate({
  amountMinor,
  from,
  to,
  className = 'mt-0.5 block text-[11px] font-semibold tracking-[0.01em] text-ink/68',
}: {
  amountMinor: number
  from: AccountCurrencyCode
  to: AccountCurrencyCode
  className?: string
}): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<Snapshot>(null)

  useEffect(() => {
    let cancelled = false
    void loadReferenceRates().then((next) => {
      if (!cancelled) setSnapshot(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (from === to || !snapshot) return null
  const estimate = convertWithReferenceFxRates(amountMinor, from, to, snapshot.rates)
  if (estimate === null) return null
  const formatted = formatMoney(estimate, to)
  const metadata = `Frankfurter reference rate · ${formatRateDate(snapshot.date)}`

  return (
    <span
      className={className}
      aria-label={`Approximately ${formatted} ${to}; ${metadata}`}
      title={metadata}
    >
      ≈ {formatted} {to} · {metadata}
    </span>
  )
}
