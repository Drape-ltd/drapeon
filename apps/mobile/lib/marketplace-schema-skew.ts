export function isMarketplaceSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code.toUpperCase() : ''
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : ''
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('marketplace_category')
    || message.includes('marketplace_category_decisions')
}

export function marketplaceCategoryFromOptionalResult(result: {
  data?: { marketplace_category?: unknown } | null
  error?: unknown
}): 'TAILORING' | 'STREETWEAR' {
  if (result.error && !isMarketplaceSchemaUnavailable(result.error)) throw result.error
  return result.data?.marketplace_category === 'STREETWEAR' ? 'STREETWEAR' : 'TAILORING'
}
