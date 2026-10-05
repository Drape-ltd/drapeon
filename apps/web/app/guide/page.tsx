import { Suspense } from 'react'
import { PublicSiteHeader } from '../../components/public-site-header'
import { SiteFooter } from '../../components/site-footer'
import { buildMetadata } from '../../lib/metadata'
import { GuideLibrary } from '../../features/account/user-education/guide-library'
import { GuideBack, GuideContextLink } from '../../features/account/user-education/guide-navigation'
import styles from '../../features/account/user-education/guide.module.css'
export const metadata = buildMetadata({
  title: 'Drapeon Guide — create, measure and care',
  description:
    'Practical illustrated guides for Sketch Room, measurements, tailoring, ordering and clothing care.',
  path: '/guide',
})
export default function Page() {
  return (
    <main id="main-content" className="min-h-screen bg-[#f7f5ed] text-ink">
      <div className={styles.shell}>
        <div className="pt-4">
          <PublicSiteHeader />
        </div>
        <div className="pt-3">
          <Suspense>
            <GuideBack library />
          </Suspense>
        </div>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>The Drapeon library</p>
            <h1>
              A little help.
              <br />
              Every step of the way.
            </h1>
            <p className={styles.intro}>
              Choose a guide, then explore the sections you need—from your first idea to caring for
              the finished piece.
            </p>
          </div>
        </header>
        <GuideLibrary />
        <p className="border-t border-ink/10 py-8 text-sm text-ink/60">
          Something wrong with an account or order?{' '}
          <a href="/help" className="text-needle underline">
            Visit Help & support
          </a>
        </p>
      </div>
      <SiteFooter />
    </main>
  )
}
