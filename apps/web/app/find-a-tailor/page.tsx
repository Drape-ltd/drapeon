import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketingShell } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Find a tailor on Drapeon',
  description:
    'How to browse Drapeon tailor profiles, compare real work, and prepare a clear custom clothing request before you order.',
  path: '/find-a-tailor',
})

const steps = [
  {
    title: 'Start with the work you want made',
    body: 'Browse Drapeon profiles in Explore. Look at the garments each tailor shows and whether their specialties fit your project. A strong match for bridalwear may be different from one for everyday alterations or menswear.',
  },
  {
    title: 'Compare the details behind the photos',
    body: 'Read the profile and portfolio, then check the information available about location, price range, availability, and customer feedback. Ask about anything important that is missing. A photo alone cannot confirm fit, timing, or the final cost.',
  },
  {
    title: 'Explain the garment before requesting a quote',
    body: 'Share the garment type, reference images, which details to keep or change, your fit preference, fabric plan, deadline, and delivery location. Clear information helps a tailor assess the work and tell you what is realistic.',
  },
  {
    title: 'Agree on the next step',
    body: 'Review the tailor’s response and quote. Confirm measurements, fabric, timing, and any approvals in the Drapeon order conversation before production begins. If a detail changes, record the new agreement there.',
  },
] as const

export default function FindATailorPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="For customers"
      title="Find a tailor on Drapeon"
      description="A good custom order starts with the right maker and a brief you both understand. Use these steps to move from browsing to a clear conversation."
      cta={
        <Link href="/explore" className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white">
          Browse Drapeon tailors
        </Link>
      }
    >
      <section className="public-section-compact border-t border-ink/6">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">Before you order</p>
            <h2 className="mt-3 text-3xl text-ink sm:text-4xl">Choose with context.</h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-ink/62">
              Drapeon brings independent tailors and customers into one order workflow. Each tailor remains responsible for confirming what they can make and when.
            </p>
          </div>
          <ol className="border-t border-ink/14">
            {steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-4 border-b border-ink/14 py-6">
                <span className="text-xs font-semibold tabular-nums text-needle/60">0{index + 1}</span>
                <div>
                  <h3 className="text-xl text-ink">{step.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-ink/66">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="public-section-compact border-t border-ink/6">
        <h2 className="text-2xl text-ink sm:text-3xl">Need help preparing your request?</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/66">
          Our guide shows how to explain what each inspiration photo means, so your tailor can distinguish the details you want to keep from those you want to change.
        </p>
        <div className="mt-5 flex flex-wrap gap-5 text-sm font-semibold text-needle">
          <Link href="/guide/reference-photos" className="underline underline-offset-4">Read the reference photo guide</Link>
          <Link href="/tailors" className="underline underline-offset-4">Are you a tailor? Join Drapeon</Link>
        </div>
      </section>
    </MarketingShell>
  )
}
