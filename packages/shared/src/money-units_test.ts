import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { decimalStringToMinor, minorToDecimalString, providerMinorUnitsMatch } from './money-units.ts'

Deno.test('supported payment currencies round-trip exact minor units', () => {
  for (const currency of ['NGN', 'GHS', 'KES', 'USD', 'GBP', 'EUR', 'CAD']) {
    assertEquals(decimalStringToMinor('7000.01', currency), 700001)
    assertEquals(minorToDecimalString(700001, currency), '7000.01')
  }
})

Deno.test('provider minor-unit comparisons reject either factor-of-100 mismatch', () => {
  assertEquals(providerMinorUnitsMatch(500, 500, 'USD'), true)
  assertEquals(providerMinorUnitsMatch(500, 5, 'USD'), false)
  assertEquals(providerMinorUnitsMatch(500, 50000, 'USD'), false)
  assertEquals(providerMinorUnitsMatch(500, 500.5, 'USD'), false)
})

Deno.test('decimal conversion rejects unsupported precision, notation, and unsafe values', () => {
  assertThrows(() => decimalStringToMinor('10.001', 'NGN'))
  assertThrows(() => decimalStringToMinor('1e3', 'NGN'))
  assertThrows(() => decimalStringToMinor('900719925474099.99', 'USD'))
})
