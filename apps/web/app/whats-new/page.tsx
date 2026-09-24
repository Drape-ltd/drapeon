import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { getVisibleProductUpdates } from '@drape/shared/product-updates'
import { MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: "What's new",
  description: 'A calm record of what is new at Drapeon and why it matters to customers and tailors.',
  path: '/whats-new',
})

export default function WhatsNewPage(): React.JSX.Element {
  const updates = getVisibleProductUpdates({ surface: 'web', role: 'ALL', now: new Date() })

  return (
    <MarketingShell
      eyebrow="What’s new"
      title="Small improvements, clearly explained."
      description="A simple record of what changed at Drapeon, who it helps, and where to take the next step."
    >
      <section className="py-8" aria-labelledby="updates-heading">
        <SectionTitle
          eyebrow="The latest from Drapeon"
          title="Useful context, not a noisy feed."
          description="Updates stay short, link to the exact place they matter, and never interrupt an active order or payment flow."
        />
        <div id="updates-heading" className="mt-10 grid gap-5">
          {updates.map((update) => (
            <article key={update.id} className="rounded-lg border border-ink/6 bg-white/82 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-needle/80">
                <span>{update.audience === 'ALL' ? 'Everyone' : update.audience.toLowerCase()}</span>
                <time dateTime={update.publishedAt}>
                  {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(update.publishedAt))}
                </time>
              </div>
              <h2 className="mt-3 text-3xl text-ink">{update.title}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/68">{update.summary}</p>
              {update.route && update.ctaLabel ? (
                <Link
                  href={update.route as Route}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
                  data-analytics-event="product_update_opened"
                  data-analytics-label={update.id}
                  aria-label={`${update.ctaLabel}: ${update.accessibilityText}`}
                >
                  {update.ctaLabel}
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  )
}
