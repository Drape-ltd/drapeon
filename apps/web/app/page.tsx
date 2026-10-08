import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { HomeHero } from '../components/home-hero'
import { ProductStoryShowcase } from '../components/product-story-showcase'
import { SiteFooter } from '../components/site-footer'
import { SiteStructuredData } from '../components/site-structured-data'
import { buildMetadata, defaultTitle } from '../lib/metadata'

export const metadata: Metadata = {
  ...buildMetadata({
    title: 'Drapeon',
    description: 'Discover independent tailors, order custom or ready-made fashion, and follow every detail from brief to delivery.',
    path: '/',
  }),
  title: { absolute: defaultTitle },
}

const journey = [
  { number: '01', title: 'Start with the idea', body: 'Bring the garment, references, fit, timing, and delivery details into one clear brief.' },
  { number: '02', title: 'Work in context', body: 'Keep the quote, decisions, measurements, and conversation attached to the project.' },
  { number: '03', title: 'See what comes next', body: 'Follow each agreed stage from approval through production and handoff.' },
]

export default function Home(): React.JSX.Element {
  return (
    <main className="min-h-screen overflow-x-hidden bg-ui-canvas text-ink">
      <SiteStructuredData />
      <HomeHero />
      <section className="public-section-editorial mx-auto max-w-[92rem] px-5 sm:px-8">
        <div className="grid gap-9 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">The process</p>
            <h2 className="mt-4 max-w-md text-4xl leading-[1.02] sm:text-6xl">Clothing is personal. The process should feel that way.</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {journey.map((step) => (
              <article key={step.number} className="border-t border-ink/14 pt-5">
                <p className="text-xs font-semibold text-needle/64">{step.number}</p>
                <h3 className="mt-10 text-2xl text-ink">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-ink/62">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ProductStoryShowcase />

      <section className="px-3 py-3 sm:px-5 sm:py-5">
        <div className="relative mx-auto grid max-w-[92rem] overflow-hidden rounded-[18px] bg-needle px-7 py-10 text-white sm:px-10 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-16 lg:px-14 lg:py-12">
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/62">For independent tailors</p>
            <h2 className="mt-4 max-w-3xl text-4xl leading-[1.02] text-white sm:text-6xl">Make room for more of your work.</h2>
          </div>
          <div className="relative z-10 mt-8 border-t border-white/20 pt-6 lg:mt-0">
            <p className="max-w-lg text-base leading-7 text-white/74">A dedicated workspace for serious enquiries, clearer projects, and the craft behind every order.</p>
            <Link href="/sign-up?role=TAILOR" className="mt-7 inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-white px-6 text-sm font-semibold text-ink transition-colors hover:bg-bone">Join as a tailor <ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 rounded-full border border-dashed border-white/16" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 right-8 h-44 w-44 rounded-full border border-dashed border-white/12" />
        </div>
      </section>

      <div className="mx-auto max-w-[92rem] px-5 pt-8 sm:px-8"><SiteFooter /></div>
    </main>
  )
}
