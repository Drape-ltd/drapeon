import { getTaxRateFromZiptax } from './tax.ts'

export type ZiptaxSyntheticResult = {
  ok: boolean
  status: 'ok' | 'fail'
  message: string
  latencyMs: number
  details: { attempts: number; postal_code: string }
}

export async function runZiptaxSynthetic(input: {
  lookup?: typeof getTaxRateFromZiptax
  wait?: (milliseconds: number) => Promise<void>
  now?: () => number
} = {}): Promise<ZiptaxSyntheticResult> {
  const lookup = input.lookup ?? getTaxRateFromZiptax
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const now = input.now ?? Date.now
  const postalCode = '10001'
  const startedAt = now()

  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
        details: { attempts: attempt, postal_code: postalCode },
      }
    } catch {
      if (attempt === 1) await wait(250)
    }
  }

  return {
    ok: false,
    status: 'fail',
    message: 'ZipTax lookup is unavailable',
    latencyMs: Math.max(0, now() - startedAt),
    details: { attempts: 2, postal_code: postalCode },
  }
}
