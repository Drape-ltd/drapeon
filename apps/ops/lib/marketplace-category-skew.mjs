export function isMarketplaceCategoryColumnUnavailable(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  const postgresMissingColumn = /column [\w.]*marketplace_category does not exist/i.test(message)
  const postgrestMissingColumn = /could not find the ['"]marketplace_category['"] column of ['"]tailor_profiles['"] in the schema cache/i.test(message)
  if (code === '42703') return postgresMissingColumn
  return code === 'PGRST204' && (postgresMissingColumn || postgrestMissingColumn)
}

function isMarketplaceCategoryDecisionsTableUnavailable(error) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  const relation = /["']?(?:public\.)?marketplace_category_decisions["']?/i
  if (code === '42P01') return new RegExp(`relation\\s+${relation.source}\\s+does not exist`, 'i').test(message)
  if (code === 'PGRST205') return new RegExp(`could not find the table\\s+${relation.source}\\s+in the schema cache`, 'i').test(message)
  return false
}

export function marketplaceProjection(categoryResult, decisionsResult) {
  const categoryUnavailable = isMarketplaceCategoryColumnUnavailable(categoryResult?.error)
  const decisionsUnavailable = isMarketplaceCategoryDecisionsTableUnavailable(decisionsResult?.error)
  if (categoryResult?.error && !categoryUnavailable) throw categoryResult.error
  if (decisionsResult?.error && !decisionsUnavailable) throw decisionsResult.error
  if (categoryUnavailable || decisionsUnavailable) return { supported: false, category: 'TAILORING', decisions: [] }
  return { supported: true, category: categoryResult?.data?.marketplace_category === 'STREETWEAR' ? 'STREETWEAR' : 'TAILORING', decisions: decisionsResult?.data ?? [] }
}
