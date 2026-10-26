import type { Metadata } from 'next'
import { CONTACTS } from '@drape/shared'
import { MarketingCard, MarketingShell, SectionTitle } from '../../components/marketing-shell'
import { buildMetadata } from '../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Payouts',
  description: 'See the staged payout milestones, transfer status, and reasons an eligible portion may pause.',
  path: '/payouts',
})

const payoutSteps = [
  ['1. Payment confirmed', 'Customer payment is confirmed before paid work begins.'],
  ['2. Verified milestone', 'For shipped orders, 70% can become eligible after Drapeon or carrier custody. For local collection, 80% can become eligible after authenticated handoff.'],
  ['3. Remaining portions', 'Shipped orders: 20% becomes eligible 72 hours after verified delivery and the final 10% after 14 days. Local collection: the remaining 20% becomes eligible after 72 hours. Open disputes or refunds pause unreleased portions.'],
  ['4. Transfer to provider balance', 'After route and payout checks pass, eligible portions are transferred to the tailor’s provider balance. Bank withdrawals are tracked separately at account level.'],
]

const payoutBlocks = [
  ['Still in review', 'Required custody, delivery, or authenticated handoff evidence—or an applicable waiting period—is not complete.'],
  ['Dispute or refund', 'An open dispute, refund, or payment reversal stops release until it is resolved.'],
  ['Payout account needs attention', 'The destination is not verified, is changing, or cannot accept the payout currency.'],
  ['Provider problem', 'The payment or payout provider has delayed, rejected, or needs a retry for the transfer.'],
] as const

export default function PayoutsPage(): React.JSX.Element {
  return (
    <MarketingShell
      eyebrow="Payouts"
      title="Know where your payout stands."
      description="Tailor payouts follow verified order milestones. The portions and next eligibility date depend on delivery method and appear in the order timeline."
      cta={
        <a
          href={`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20question`}
          className="inline-flex items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white"
          data-analytics-event="contact_cta_click"
          data-analytics-label="Payouts contact"
        >
          Contact payouts
        </a>
      }
    >
      <section className="py-8">
        <SectionTitle
          eyebrow="How it works"
          title="From paid order to payout."
          description="Shipment and local collection use different milestones; your order timeline shows each portion and its current status."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {payoutSteps.map(([title, body]) => (
            <div key={title} className="rounded-[8px] border border-ink/6 bg-white/82 p-5 shadow-sm">
              <h3 className="text-xl text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-7 text-ink/68">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="public-section-compact border-t border-ink/6">
        <SectionTitle eyebrow="If it pauses" title="See the reason, then the next step." description="Your order will show what needs attention." />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {payoutBlocks.map(([title, body]) => (
            <MarketingCard key={title} title={title} body={body} />
          ))}
        </div>
      </section>

      <section className="public-section-compact border-t border-ink/6">
        <SectionTitle eyebrow="Fees and support" title="No surprise deductions." description="Before public paid launch, each order will show the customer payment and your payout amount." />
        <div className="mt-10 rounded-lg border border-ink/6 bg-white/82 p-6 shadow-sm">
          <ul className="grid gap-3 text-sm leading-7 text-ink/72 md:grid-cols-2">
            <li className="rounded-2xl bg-bone/70 px-4 py-3">Check your order timeline for the latest status.</li>
            <li className="rounded-2xl bg-bone/70 px-4 py-3">Contact payouts if an amount or block is unclear.</li>
          </ul>
          <a
            href={`mailto:${CONTACTS.payouts}?subject=Drapeon%20payout%20question`}
            className="mt-6 inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-6 py-4 text-sm font-semibold text-ink shadow-sm"
            data-analytics-event="contact_cta_click"
            data-analytics-label="Payouts inbox"
          >
            {CONTACTS.payouts}
          </a>
        </div>
      </section>
    </MarketingShell>
  )
}
