import { Suspense } from 'react'
import { GuideBack } from '../../../features/account/user-education/guide-navigation'
import { notFound } from 'next/navigation'
import { GUIDE_ARTICLES, GUIDE_UPDATED, getGuide } from '@drape/shared/guide-library'
import { buildMetadata, siteUrl } from '../../../lib/metadata'
import { PublicSiteHeader } from '../../../components/public-site-header'
import { JsonLd } from '../../../components/json-ld'
import { GuideReader } from '../../../features/account/user-education/guide-reader'
export function generateStaticParams() {
  return GUIDE_ARTICLES.map((g) => ({ slug: g.id }))
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const g = getGuide((await params).slug)
  return g ? buildMetadata({ title: g.title, description: g.summary, path: `/guide/${g.id}` }) : {}
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const g = getGuide((await params).slug)
  if (!g) notFound()
  return (
    <main id="main-content" className="min-h-screen bg-[#f7f5ed] px-5 pb-16 text-ink">
      <div className="mx-auto max-w-6xl pt-4">
        <PublicSiteHeader />
      </div>
      <div className="mx-auto max-w-3xl py-8">
        <Suspense>
          <GuideBack />
        </Suspense>
      </div>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: g.title,
          description: g.summary,
          dateModified: GUIDE_UPDATED,
          author: { '@type': 'Organization', name: 'Drapeon' },
          mainEntityOfPage: `${siteUrl}/guide/${g.id}`,
        }}
      />
      <GuideReader guide={g} />
    </main>
  )
}
