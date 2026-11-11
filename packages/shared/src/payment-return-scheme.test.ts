import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentReturnDeepLink, paymentReturnScheme } from './payment-return-scheme.ts'

test('Paystack return link opens only the named Dev, Preview or store app', () => {
  for (const scheme of ['drape-dev', 'drape-preview', 'drape']) {
    assert.equal(paymentReturnScheme(scheme), scheme)
    assert.equal(
      paymentReturnDeepLink(scheme, 'reference=DRAPE-QA-RETURN&status=success'),
      `${scheme}:///payment-redirect?reference=DRAPE-QA-RETURN&status=success`,
    )
  }
  assert.equal(paymentReturnDeepLink('drape-dev.attacker', 'reference=QA'), null)
  assert.equal(paymentReturnDeepLink(null, ''), 'drape:///payment-redirect')
})
