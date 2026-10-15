import { supabase } from '@/lib/supabase'

type CacheEntry = {
  expiresAt: number
  data: unknown
}

type FetchReadGatewayOptions = {
  cacheTtlMs?: number
  forceRefresh?: boolean
  onTiming?: (timing: ReadGatewayTiming) => void
}

export type ReadGatewayTiming = {
  source: 'cache' | 'network' | 'stale_fallback' | 'coalesced'
  durationMs: number
}

const responseCache = new Map<string, CacheEntry>()
const inFlightRequests = new Map<string, Promise<unknown>>()
const READ_GATEWAY_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out. Check your connection and try again.`))
    }, READ_GATEWAY_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function cacheTtlFor(body: Record<string, unknown>) {
  switch (body.action) {
    case 'explore-tailors':
      return 90_000
    case 'tailor-shop':
    case 'seller-item':
      return 120_000
    // Tailor profile carries viewer-specific saved state. Keep it uncached
    // on-device; the Edge gateway caches only the public profile portion.
    default:
      return 0
  }
}

function stableCacheKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCacheKey).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCacheKey(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function fetchReadGateway<T>(
  body: Record<string, unknown>,
  options: FetchReadGatewayOptions = {},
): Promise<T> {
  const startedAt = Date.now()
  const report = (source: ReadGatewayTiming['source']) => {
    // Observability must never turn a successful public read into a failed one.
    try {
      options.onTiming?.({ source, durationMs: Math.max(0, Date.now() - startedAt) })
    } catch {
      // Ignore a caller's diagnostic callback failure.
    }
  }
  const cacheKey = stableCacheKey(body)
  const ttlMs = options.cacheTtlMs ?? cacheTtlFor(body)
  const now = Date.now()
  const cached = responseCache.get(cacheKey)

  if (!options.forceRefresh && ttlMs > 0 && cached && cached.expiresAt > now) {
    report('cache')
    return cached.data as T
  }

  const existingRequest = inFlightRequests.get(cacheKey)
  if (existingRequest) {
    try {
      const result = await existingRequest as T
      report('coalesced')
      return result
    } catch (error) {
      report('coalesced')
      throw error
    }
  }

  let usedStaleFallback = false
  const request = (async () => {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('read-gateway', { body }),
      'Browse data',
    )
    if (error) {
      if (cached) {
        usedStaleFallback = true
        return cached.data as T
      }
      throw error
    }

    const payload = data as { ok?: boolean; data?: unknown; message?: string } | null
    if (!payload?.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
      if (cached) {
        usedStaleFallback = true
        return cached.data as T
      }
      throw new Error(payload?.message ?? 'Browse data returned an incomplete response.')
    }

    if (ttlMs > 0) {
      responseCache.set(cacheKey, { data: payload.data, expiresAt: Date.now() + ttlMs })
    }

    return payload.data as T
  })()

  inFlightRequests.set(cacheKey, request)
  try {
    const result = await request
    report(usedStaleFallback ? 'stale_fallback' : 'network')
    return result
  } catch (error) {
    report('network')
    throw error
  } finally {
    inFlightRequests.delete(cacheKey)
  }
}
