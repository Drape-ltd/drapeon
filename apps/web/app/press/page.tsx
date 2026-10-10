import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { DRAPEON_ANDROID_STORE_URL, DRAPEON_IOS_STORE_URL } from '@drape/shared/email-links'
import Link from 'next/link'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Drapeon press and company facts',
  description: 'Official facts and links for Drapeon, the custom fashion platform connecting customers with independent tailors.',
  path: '/press',
})

export default function PressPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Press"
      title="Drapeon press and company facts."
      description="Official background, product links, and a contact point for reporting on Drapeon."
      cta={
        <a
          href={`mailto:${CONTACTS.press}?subject=Drapeon%20press%20inquiry`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
        >
          Contact press
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="At a glance"
          title="A clearer way to make custom fashion."
          description="Drapeon is a custom fashion platform operated by O4 Group LLC. It connects customers with independent tailors and keeps briefs, fit details, quotes, messages, and order progress together. The app is available on iPhone and Android, and Drapeon is onboarding tailors."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <MarketingCard title="Customers" body="Explore independent tailor profiles, prepare a clear brief, and follow the agreed order steps." />
          <MarketingCard title="Tailors" body="Showcase work, review customer briefs, and keep project details in one place." />
          <MarketingCard title="Product" body="Drapeon supports custom clothing and ready-made pieces through its web and mobile experiences." />
        </div>
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-needle">
          <Link href="/find-a-tailor" className="underline underline-offset-4">How to find a tailor on Drapeon</Link>
          <Link href="/tailors" className="underline underline-offset-4">For independent tailors</Link>
          <a href={DRAPEON_IOS_STORE_URL} className="underline underline-offset-4">Drapeon on iPhone</a>
          <a href={DRAPEON_ANDROID_STORE_URL} className="underline underline-offset-4">Drapeon on Android</a>
        </div>
      </section>

      <section className="public-section-compact border-t border-ink/6">
        <div className="overflow-hidden rounded-[8px] bg-needle px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Media inquiries</p>
          <h2 className="mt-3 text-3xl text-white sm:text-4xl">Contact the Drapeon press inbox.</h2>
          <p className="mt-3 text-sm leading-7 text-white/62">
            For background, founder conversation, product context, or editorial coordination, email us directly.
          </p>
          <a
            href={`mailto:${CONTACTS.press}?subject=Drapeon%20press%20inquiry`}
            className="mt-7 inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-ink"
          >
            {CONTACTS.press}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
