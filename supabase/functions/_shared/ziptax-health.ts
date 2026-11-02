import { getTaxRateFromZiptax } from './tax.ts'

export const ZIPTAX_SYNTHETIC_INTERVAL_MS = 60 * 60 * 1_000

export type ZiptaxSyntheticResult = {
  ok: boolean
  status: 'ok' | 'warn' | 'fail'
  message: string
  latencyMs: number
  details: { attempts: number; postal_code: string; checked_at?: string; cached?: boolean }
}

export type ZiptaxSyntheticCache = {
  read(): Promise<ZiptaxSyntheticResult | null>
  claim(input: { checkedAt: string; staleBefore: string }): Promise<boolean>
  write(result: ZiptaxSyntheticResult): Promise<void>
}

export async function runZiptaxSynthetic(input: {
  lookup?: typeof getTaxRateFromZiptax
  now?: () => number
} = {}): Promise<ZiptaxSyntheticResult> {
  const lookup = input.lookup ?? getTaxRateFromZiptax
  const now = input.now ?? Date.now
  const postalCode = '10001'
  const startedAt = now()

  try {
    const result = await lookup('', postalCode, 'US')
    if (!Number.isFinite(result.rateBps) || result.rateBps <= 0) {
      throw new Error('ZipTax returned an invalid rate')
    }
    return {
      ok: true,
      status: 'ok',
      message: 'ZipTax lookup succeeded',
      latencyMs: Math.max(0, now() - startedAt),
      details: { attempts: 1, postal_code: postalCode },
    }
  } catch {
    return {
      ok: false,
      status: 'fail',
      message: 'ZipTax lookup is unavailable',
      latencyMs: Math.max(0, now() - startedAt),
      details: { attempts: 1, postal_code: postalCode },
    }
  }
}

export async function readOrRefreshZiptaxSynthetic(input: {
  cache: ZiptaxSyntheticCache
  lookup?: typeof getTaxRateFromZiptax
  now?: () => number
}): Promise<ZiptaxSyntheticResult> {
  const now = input.now ?? Date.now
  const nowMs = now()
  const checkedAt = new Date(nowMs).toISOString()
  const staleBefore = new Date(nowMs - ZIPTAX_SYNTHETIC_INTERVAL_MS).toISOString()
  const claimed = await input.cache.claim({ checkedAt, staleBefore })

  if (!claimed) {
    const cached = await input.cache.read()
    if (cached) {
      return { ...cached, details: { ...cached.details, cached: true } }
    }
    return {
      ok: true,
      status: 'warn',
      message: 'ZipTax synthetic is already running',
      latencyMs: 0,
      details: { attempts: 0, postal_code: '10001', cached: true },
    }
  }

  const result = await runZiptaxSynthetic({ lookup: input.lookup, now })
  const stored = {
    ...result,
    details: { ...result.details, checked_at: checkedAt, cached: false },
  }
  await input.cache.write(stored)
  return stored
}
