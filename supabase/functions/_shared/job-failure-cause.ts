/** Conservative grouping: never use raw messages (recipient IDs/secrets) as case keys. */
export function jobFailureCause(message: string): string {
  if (/\b(?:invalid|missing|expired|revoked) api[ _-]?key\b|\bapi[ _-]?key (?:is )?(?:invalid|missing|expired|revoked)\b/i.test(message)) return 'PROVIDER_AUTH'
  if (/\brate limit(?:ed| exceeded)?\b|\btoo many requests\b|\bHTTP 429\b/i.test(message)) return 'RATE_LIMIT'
  if (/\btimed? out\b|\btimeout\b|\bETIMEDOUT\b/i.test(message)) return 'TIMEOUT'
  if (/\bECONNRESET\b|\bECONNREFUSED\b|\bENOTFOUND\b|\bEAI_AGAIN\b/i.test(message)) return 'NETWORK'
  return 'OTHER'
}
