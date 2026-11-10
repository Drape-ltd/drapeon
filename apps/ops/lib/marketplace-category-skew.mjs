export function isMarketplaceSchemaUnavailable(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '').toLowerCase()
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code) || message.includes('marketplace_category') || message.includes('marketplace_category_decisions')
}
export function marketplaceProjection(categoryResult, decisionsResult) {
  if (isMarketplaceSchemaUnavailable(categoryResult?.error) || isMarketplaceSchemaUnavailable(decisionsResult?.error)) return { supported: false, category: 'TAILORING', decisions: [] }
  if (categoryResult?.error) throw categoryResult.error
  if (decisionsResult?.error) throw decisionsResult.error
  return { supported: true, category: categoryResult?.data?.marketplace_category === 'STREETWEAR' ? 'STREETWEAR' : 'TAILORING', decisions: decisionsResult?.data ?? [] }
}
