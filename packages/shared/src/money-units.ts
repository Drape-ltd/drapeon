/** All persisted Drapeon amounts are integer minor units. */
const CURRENCY_FRACTION_DIGITS: Readonly<Record<string, number>> = {
  NGN: 2,
  GHS: 2,
  KES: 2,
  USD: 2,
  GBP: 2,
  EUR: 2,
  CAD: 2,
}

export function currencyFractionDigits(currency: string): number {
  const code = currency.trim().toUpperCase()
  const knownDigits = CURRENCY_FRACTION_DIGITS[code]
  if (knownDigits !== undefined) return knownDigits
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    throw new Error(`Unsupported currency: ${currency}`)
  }
}

export function assertMinorUnitInteger(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Money amount must be a non-negative, safe integer in minor units.')
  }
  return amount
}

export function assertMinorUnits(amount: number, currency: string): number {
  currencyFractionDigits(currency)
  return assertMinorUnitInteger(amount)
}

/** Validates an integer minor-unit amount before sending it to a provider. */
export function providerAmountMinorUnits(amount: number, currency?: string | null): number {
  return currency?.trim()
    ? assertMinorUnits(amount, currency)
    : assertMinorUnitInteger(amount)
}

export function minorUnitsMatch(expected: number, actual: unknown, currency: string): boolean {
  try {
    return assertMinorUnits(expected, currency) === assertMinorUnits(actual as number, currency)
  } catch {
    return false
  }
}

export function minorToDecimalString(amount: number, currency: string): string {
  const digits = currencyFractionDigits(currency)
  assertMinorUnits(amount, currency)
  const scale = 10 ** digits
  const whole = Math.floor(amount / scale)
  return digits === 0 ? String(whole) : `${whole}.${String(amount % scale).padStart(digits, '0')}`
}

/** Convert an exact decimal major-unit string to the persisted minor-unit representation. */
export function majorToMinorUnits(value: string, currency: string): number {
  return decimalStringToMinor(value, currency)
}

/** Convert persisted integer minor units to a major-unit number for display APIs. */
export function minorUnitsToMajorNumber(amount: number, currency: string): number {
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Money amount must be a safe integer in minor units.')
  }
  const sign = amount < 0 ? -1 : 1
  return sign * Number(minorToDecimalString(Math.abs(amount), currency))
}

export function decimalStringToMinor(value: string, currency: string): number {
  const digits = currencyFractionDigits(currency)
  const pattern = digits === 0 ? /^\d+$/u : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`, 'u')
  if (!pattern.test(value)) throw new Error('Money amount must be an exact decimal string.')
  const [whole, fraction = ''] = value.split('.')
  const amount = Number(whole) * (10 ** digits) + Number(fraction.padEnd(digits, '0') || '0')
  return assertMinorUnits(amount, currency)
}

/** Provider amounts for Stripe/Paystack are already in minor units: never scale them again. */
export function providerMinorUnitsMatch(expected: number, actual: unknown, currency: string): boolean {
  return minorUnitsMatch(expected, actual, currency)
}
