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
