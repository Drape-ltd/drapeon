import type { MarketplaceCategory } from './marketplace-category.ts'

type QueryResult<T> = { data: T | null; error: unknown }

export function isMarketplaceCategorySchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code.toUpperCase() : ''
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : ''
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('marketplace_category')
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
  if (category === 'STREETWEAR') return { data: emptyData, error: null }

  try {
    return await queryWithoutCategory()
  } catch (error) {
    return { data: null, error }
  }
}
