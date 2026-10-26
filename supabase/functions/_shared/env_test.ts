import { getPaymentReturnUrl, supabaseProjectEnvironment } from './env.ts'

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
}

Deno.test('payment return URL uses the provider-neutral route by default', () => {
  const names = ['PAYMENT_RETURN_URL', 'PAYSTACK_CALLBACK_URL', 'SITE_URL', 'NEXT_PUBLIC_SITE_URL']
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]))
  try {
    for (const name of names) Deno.env.delete(name)
    assertEquals(getPaymentReturnUrl(), 'https://drapeon.co/payments/return')
  } finally {
    for (const name of names) restoreEnv(name, previous[name])
  }
})

Deno.test('Supabase environment classification requires an exact trusted endpoint', () => {
  const cases = [
    ['https://pqptfuqogvrajozfsqzi.supabase.co', 'DEVELOPMENT'],
    ['http://127.0.0.1:54321', 'DEVELOPMENT'],
    ['http://localhost:54321', 'DEVELOPMENT'],
    ['https://wkfsrunetmgjdtcurmoj.supabase.co', 'PRODUCTION'],
    ['https://auth.drapeon.co', 'PRODUCTION'],
    ['https://pqptfuqogvrajozfsqzi.attacker.example', 'UNKNOWN'],
    ['https://pqptfuqogvrajozfsqzi.supabase.co.attacker.example', 'UNKNOWN'],
    ['https://attacker.example/?next=pqptfuqogvrajozfsqzi.supabase.co', 'UNKNOWN'],
    ['http://pqptfuqogvrajozfsqzi.supabase.co', 'UNKNOWN'],
    ['not a URL', 'UNKNOWN'],
  ] as const

  for (const [url, expected] of cases) {
    assertEquals(supabaseProjectEnvironment(url), expected)
  }
})

Deno.test('payment return URL honors its explicit setting and migrates the legacy callback path', () => {
  const names = ['PAYMENT_RETURN_URL', 'PAYSTACK_CALLBACK_URL', 'SITE_URL', 'NEXT_PUBLIC_SITE_URL']
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]))
  try {
    Deno.env.set('PAYMENT_RETURN_URL', 'https://qa.drapeon.co')
    Deno.env.set('PAYSTACK_CALLBACK_URL', 'https://legacy.drapeon.co/payments/paystack/callback')
    assertEquals(getPaymentReturnUrl(), 'https://qa.drapeon.co/payments/return')

    Deno.env.delete('PAYMENT_RETURN_URL')
    assertEquals(getPaymentReturnUrl(), 'https://legacy.drapeon.co/payments/return')
  } finally {
    for (const name of names) restoreEnv(name, previous[name])
  }
})

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
}
