import type { MarketplaceCategory } from './marketplace-category.ts'

type QueryResult<T> = { data: T | null; error: unknown; schemaFallback?: boolean }

export function isMarketplaceCategorySchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code.toUpperCase() : ''
  const message = typeof value.message === 'string' ? value.message : ''
  const postgresMissingColumn = /column [\w.]*marketplace_category does not exist/i.test(message)
  const postgrestMissingColumn = /could not find the ['"]marketplace_category['"] column of ['"]tailor_profiles['"] in the schema cache/i.test(message)
  if (code === '42703') return postgresMissingColumn
  return code === 'PGRST204' && (postgresMissingColumn || postgrestMissingColumn)
}

export function isMarketplaceCategoryDecisionsTableUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code.toUpperCase() : ''
  const message = typeof value.message === 'string' ? value.message : ''
  const relation = String.raw`["']?(?:public\.)?marketplace_category_decisions["']?`
  if (code === '42P01') return new RegExp(String.raw`relation\s+${relation}\s+does not exist`, 'i').test(message)
  if (code === 'PGRST205') return new RegExp(String.raw`could not find the table\s+${relation}\s+in the schema cache`, 'i').test(message)
  return false
}

export function marketplaceCategoryCapabilities(schemaAvailable: boolean) {
  return { categories: schemaAvailable ? ['TAILORING', 'STREETWEAR'] as const : ['TAILORING'] as const }
}

export async function queryWithMarketplaceCategoryFallback<T>(
  category: MarketplaceCategory,
  queryWithCategory: () => PromiseLike<QueryResult<T>>,
  queryWithoutCategory: () => PromiseLike<QueryResult<T>>,
  emptyData: T,
): Promise<QueryResult<T>> {
  let result: QueryResult<T>
  try {
    result = await queryWithCategory()
  } catch (error) {
    result = { data: null, error }
  }

  if (!result.error || !isMarketplaceCategorySchemaUnavailable(result.error)) return result
  if (category === 'STREETWEAR') return { data: emptyData, error: null, schemaFallback: true }

  try {
    return { ...await queryWithoutCategory(), schemaFallback: true }
  } catch (error) {
    return { data: null, error, schemaFallback: true }
  }
}
