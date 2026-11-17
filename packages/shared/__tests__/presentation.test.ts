import { formatBrowseMoney, formatDate, formatMoney, formatRelative, parseDateValue } from '../src/presentation'

describe('shared presentation contract', () => {
  it('formats stored minor units without changing their value', () => {
    expect(formatMoney(38400, 'GBP')).toBe('£384.00')
    expect(formatMoney(24000, 'USD')).toBe('$240.00')
    expect(formatMoney(-1234, 'GBP')).toBe('-£12.34')
    expect(formatMoney(null, 'USD')).toBe('Quote pending')
  })

  it('falls back safely when a legacy currency is invalid', () => {
    expect(formatMoney(1200, 'not-a-currency')).toBe('$12.00')
  })

  it('keeps browse prices concise without hiding fractional minor units', () => {
    expect(formatBrowseMoney(13_500, 'USD')).toBe('$135')
    expect(formatBrowseMoney(13_531, 'USD')).toBe('$135.31')
    expect(formatBrowseMoney(12_000_000, 'NGN')).toBe('₦120,000')
    expect(formatBrowseMoney(12_000_050, 'NGN')).toBe('₦120,000.50')
    expect(formatBrowseMoney(13_500, 'GBP')).toBe('£135')
    expect(formatBrowseMoney(13_531, 'GBP')).toBe('£135.31')
  })

  it('treats legacy timestamp strings without a suffix as UTC', () => {
    expect(parseDateValue('2026-09-02T12:00:00')?.toISOString()).toBe('2026-09-02T12:00:00.000Z')
    expect(parseDateValue('not-a-date')).toBeNull()
  })

  it('formats calendar and relative dates from a deterministic clock', () => {
    expect(formatDate('2026-09-02T12:00:00Z', { timeZone: 'UTC' })).toBe('Sep 2, 2026')
    expect(formatRelative('2026-09-02T11:30:00Z', { now: Date.parse('2026-09-02T12:00:00Z') })).toBe('30 minutes ago')
    expect(formatRelative('2026-09-01T12:00:00Z', { now: Date.parse('2026-09-02T12:00:00Z') })).toBe('yesterday')
  })
})
