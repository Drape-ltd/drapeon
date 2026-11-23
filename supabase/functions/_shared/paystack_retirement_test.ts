Deno.test('Paystack adapter no longer exposes new recipient creation', async () => {
  const paystack = await import('./paystack.ts')
  const setupExports = [
    'createPaystackTransferRecipient',
    'listPaystackBanks',
    'fallbackPaystackBanks',
    'resolvePaystackAccountNumber',
  ]
  const restoredSetupExports = setupExports.filter((name) => name in paystack)
  if (restoredSetupExports.length > 0) {
    throw new Error(`New Paystack payout setup remains retired: ${restoredSetupExports.join(', ')}`)
  }
})

Deno.test('Paystack refuses new checkout initialization without contacting the provider', async () => {
  const { initializePaystackTransaction, verifyPaystackTransaction, refundPaystackTransaction } =
    await import('./paystack.ts')
  const originalFetch = globalThis.fetch
  let providerCalled = false
  globalThis.fetch = (() => {
    providerCalled = true
    throw new Error('Provider must not be called')
  }) as typeof fetch
  try {
    let errorMessage = ''
    try {
      await initializePaystackTransaction({
        amount: 100,
        currency: 'NGN',
        email: 'retirement@example.invalid',
        reference: 'retirement-test',
        callbackUrl: 'https://example.invalid/return',
      })
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }
    if (errorMessage !== 'PAYSTACK_NEW_TRANSACTIONS_RETIRED' || providerCalled) {
      throw new Error(`New Paystack checkout was not refused locally: ${errorMessage}`)
    }
    if (typeof verifyPaystackTransaction !== 'function' || typeof refundPaystackTransaction !== 'function') {
      throw new Error('Historical Paystack verification/refund paths must remain available')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
