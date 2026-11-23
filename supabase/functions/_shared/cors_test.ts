import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { getCorsHeaders } from './cors.ts'

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) Deno.env.delete(name)
  else Deno.env.set(name, value)
}

Deno.test('local browser origins are allowed only for the exact Dev project', () => {
  const previousUrl = Deno.env.get('SUPABASE_URL')
  const request = new Request('http://localhost:54321/functions/v1/test', {
    headers: { origin: 'http://localhost:3000' },
  })

  try {
    Deno.env.set('SUPABASE_URL', 'https://pqptfuqogvrajozfsqzi.attacker.example')
    assertEquals(getCorsHeaders(request)['Access-Control-Allow-Origin'], 'https://drapeon.co')

    Deno.env.set('SUPABASE_URL', 'https://pqptfuqogvrajozfsqzi.supabase.co')
    assertEquals(getCorsHeaders(request)['Access-Control-Allow-Origin'], 'http://localhost:3000')
  } finally {
    restoreEnv('SUPABASE_URL', previousUrl)
  }
})
