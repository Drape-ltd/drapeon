import type { Metadata } from 'next'
import { TailorDirectory, type TailorDirectoryParams } from '../../../components/tailor-directory'
import { buildMetadata } from '../../../lib/metadata'
import { getMarketplaceDirectoryPage } from '../../../lib/public-marketplace'
import { marketplaceCategoryFromExploreParam } from '@drape/shared'

export const metadata: Metadata = buildMetadata({
  title: 'Explore',
  description: 'Browse live Drapeon tailors and ready-made pieces from your web account.',
  path: '/account/explore',
})

export default async function AccountExplorePage({
  searchParams,
}: {
  searchParams: Promise<TailorDirectoryParams>
}) {
  const params = await searchParams
  const page = Math.max(1, Math.min(250, Number.parseInt(params.page ?? '1', 10) || 1))
  const offset = (page - 1) * 40
  const query = params.q?.trim() ?? ''
  const category = marketplaceCategoryFromExploreParam(params.category)
  const [pageResult, nextPage] = await Promise.all([
    getMarketplaceDirectoryPage(category, 40, offset, query),
    getMarketplaceDirectoryPage(category, 1, offset + 40, query),
  ])
  const effectiveCategory = pageResult.categories.includes(category) ? category : 'TAILORING'
  return (
    <TailorDirectory
      tailors={pageResult.tailors}
      params={params}
      basePath="/account/explore"
      profileBasePath="/account/tailors"
      pagination={{ page, hasNextPage: nextPage.tailors.length > 0 }}
      category={effectiveCategory}
      supportedCategories={pageResult.categories}
    />
  )
}
