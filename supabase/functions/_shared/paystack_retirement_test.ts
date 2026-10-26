Deno.test('Paystack adapter no longer exposes new recipient creation', async () => {
  const paystack = await import('./paystack.ts')
  if ('createPaystackTransferRecipient' in paystack) {
    throw new Error('New Paystack recipient creation must remain retired.')
  }
})
