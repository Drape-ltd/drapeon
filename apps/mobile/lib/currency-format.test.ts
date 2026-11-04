import assert from 'node:assert/strict'
import test from 'node:test'
import { formatConvertedMinorAmount } from './currency-format.ts'

test('preserves exact cents for the ready-made checkout tax and total', () => {
  const rates = { USD: 1 } as const

  assert.equal(formatConvertedMinorAmount(1_031, 'USD', 'USD', rates, '$'), '$10.31')
  assert.equal(formatConvertedMinorAmount(13_531, 'USD', 'USD', rates, '$'), '$135.31')
  assert.equal(formatConvertedMinorAmount(12_500, 'USD', 'USD', rates, '$'), '$125.00')
})

test('preserves minor units across every supported account currency', () => {
  const currencies = ['USD', 'GBP', 'EUR', 'NGN', 'GHS', 'KES', 'CAD'] as const

  for (const currency of currencies) {
    assert.match(
      formatConvertedMinorAmount(1_031, currency, currency, { [currency]: 1 }, ''),
      /10\.31$/u,
      `${currency} must not round away its minor units`,
    )
  }
})

test('formats converted reference amounts to two decimal places', () => {
  assert.equal(formatConvertedMinorAmount(1_000, 'USD', 'CAD', { USD: 1, CAD: 1.36 }, 'C$'), 'C$13.60')
})
