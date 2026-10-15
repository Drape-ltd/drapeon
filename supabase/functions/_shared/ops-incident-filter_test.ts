import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { parseIncidentKey } from './ops-incident-filter.ts'

Deno.test('explicit incident keys fail closed rather than listing unrelated incidents', () => {
  assertEquals(parseIncidentKey(undefined), null)
  for (const value of ['', ' ', [], 42, 'x\n', 'x'.repeat(257)]) {
    assertThrows(() => parseIncidentKey(value), Error, 'Invalid incident key')
  }
})

Deno.test('incident keys preserve literal filter characters for equality, not OR grammar', () => {
  assertEquals(parseIncidentKey(' synthetic:monitor:ready '), 'synthetic:monitor:ready')
  assertEquals(parseIncidentKey('a,b.eq.c'), 'a,b.eq.c')
})
