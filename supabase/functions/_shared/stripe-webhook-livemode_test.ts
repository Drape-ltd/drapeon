import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { verifyStripeWebhookLivemode } from './stripe-webhook-livemode.ts'

Deno.test('Stripe production accepts only live-mode events', () => {
  assertEquals(verifyStripeWebhookLivemode({
    supabaseUrl: 'https://wkfsrunetmgjdtcurmoj.supabase.co',
    livemode: true,
  }), { accepted: true, expectedLivemode: true })
  assertEquals(verifyStripeWebhookLivemode({
    supabaseUrl: 'https://wkfsrunetmgjdtcurmoj.supabase.co',
    livemode: false,
  }), { accepted: false, code: 'LIVEMODE_MISMATCH', expectedLivemode: true })
})

Deno.test('Stripe Dev accepts only sandbox events', () => {
  assertEquals(verifyStripeWebhookLivemode({
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    livemode: false,
  }), { accepted: true, expectedLivemode: false })
  assertEquals(verifyStripeWebhookLivemode({
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    livemode: true,
  }), { accepted: false, code: 'LIVEMODE_MISMATCH', expectedLivemode: false })
})

Deno.test('Stripe webhook mode checks fail closed for missing mode or an unknown host', () => {
  assertEquals(verifyStripeWebhookLivemode({
    supabaseUrl: 'https://untrusted.example.test',
    livemode: false,
  }), { accepted: false, code: 'UNKNOWN_ENVIRONMENT', expectedLivemode: null })
  assertEquals(verifyStripeWebhookLivemode({
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    livemode: null,
  }), { accepted: false, code: 'MISSING_LIVEMODE', expectedLivemode: false })
})
