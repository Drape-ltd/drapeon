import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { jobFailureCause } from './job-failure-cause.ts'

Deno.test('recognized shared failures have stable bounded causes', () => {
  for (const message of ['Invalid API key', 'API_KEY is revoked', 'missing api-key']) assertEquals(jobFailureCause(message),'PROVIDER_AUTH')
  for (const message of ['HTTP 429', 'Too many requests', 'rate limit exceeded']) assertEquals(jobFailureCause(message),'RATE_LIMIT')
  for (const message of ['Request timed out after 25000ms','ETIMEDOUT','timeout']) assertEquals(jobFailureCause(message),'TIMEOUT')
  for (const message of ['connect ECONNREFUSED','getaddrinfo ENOTFOUND']) assertEquals(jobFailureCause(message),'NETWORK')
})
Deno.test('unrecognized or recipient-specific failures stay separate', () => {
  for (const message of ['Invalid recipient person@example.test','Unauthorized customer','Missing order 123','Provider returned 500','', 'Invalid password']) assertEquals(jobFailureCause(message),'OTHER')
})
