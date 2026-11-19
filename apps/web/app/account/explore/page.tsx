import type { Metadata } from 'next'
import { TailorDirectory, type TailorDirectoryParams } from '../../../components/tailor-directory'
import { buildMetadata } from '../../../lib/metadata'
import { getExploreTailorPage } from '../../../lib/public-marketplace'

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
  const section = params.filter === 'ready-made' ? 'READY_TO_WEAR' : 'TAILORING'
  const [directory, nextPage] = await Promise.all([
    getExploreTailorPage(40, offset, query, section),
    getExploreTailorPage(1, offset + 40, query, section),
  ])
  return (
    <TailorDirectory
      tailors={directory.tailors}
      readyMadeSupported={directory.readyMadeSupported}
      params={params}
      basePath="/account/explore"
      profileBasePath="/account/tailors"
      pagination={{ page, hasNextPage: nextPage.tailors.length > 0 }}
    />
  )
}
