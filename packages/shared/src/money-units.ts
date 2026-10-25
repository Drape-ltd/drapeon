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
  const digits = CURRENCY_FRACTION_DIGITS[currency.trim().toUpperCase()]
  if (digits === undefined) throw new Error(`Unsupported currency: ${currency}`)
  return digits
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
