import {
  getSurveyDefinition,
  summarizeSurveyResponses,
  type SurveyKind,
  type SurveyOpsResponseRecord,
} from '@drape/shared/lifecycle-surveys'

const PREVIEW_RESPONSES: readonly SurveyOpsResponseRecord[] = [
  { kind: 'CUSTOMER_POST_COMPLETION_CSAT', score: 5, status: 'RECORDED' },
  { kind: 'CUSTOMER_POST_COMPLETION_CSAT', score: 2, status: 'ROUTED' },
  { kind: 'TAILOR_FIRST_ORDER_CSAT', score: 4, status: 'RECORDED' },
  { kind: 'SUPPORT_RESOLUTION_CSAT', score: 3, status: 'SUPPRESSED' },
]

const KIND_LABELS: Record<SurveyKind, string> = {
  CUSTOMER_POST_COMPLETION_CSAT: 'Customer post-completion',
  SUPPORT_RESOLUTION_CSAT: 'Support resolution',
  TAILOR_FIRST_ORDER_CSAT: 'Tailor first order',
  ONBOARDING_PULSE: 'Onboarding pulse',
}

export function SurveyOpsPreview() {
  const summary = summarizeSurveyResponses(PREVIEW_RESPONSES)
  const activeKinds = summary.byKind.filter((row) => row.responseCount > 0)

  return (
    <div className="grid gap-5" data-testid="survey-ops-preview">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Feedback summary">
        <SummaryCard label="Responses" value={summary.responseCount} detail="Private rows received" />
        <SummaryCard label="Average score" value={summary.averageScore ?? '—'} detail="Across permitted surveys" />
        <SummaryCard label="Needs follow-up" value={summary.routedCount} detail="Negative responses routed" tone="warning" />
        <SummaryCard label="Review candidates" value={summary.reviewEligibleCount} detail="Explicit threshold met" tone="positive" />
      </section>

      <section className="rounded-[8px] border border-ui-border bg-ui-surface p-5" aria-labelledby="survey-ops-routing-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Operator view</p>
            <h2 id="survey-ops-routing-heading" className="mt-1 text-2xl text-ink">Feedback creates a next step, not noise.</h2>
          </div>
          <span className="rounded-full border border-needle/20 bg-needle/5 px-3 py-1 text-xs font-semibold text-needle">Development preview</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatusRow label="Negative routing" value={`${summary.routedCount} queued`} detail="Support/Ops follow-up" tone="warning" />
          <StatusRow label="Suppressed" value={`${summary.suppressedCount} held`} detail="Incident or open-work boundary" tone="muted" />
          <StatusRow label="Positive threshold" value={`${summary.reviewEligibleCount} eligible`} detail="Invitation remains explicit" tone="positive" />
        </div>
        <p className="mt-5 text-sm leading-6 text-ink/60">This view intentionally omits respondent identity, order or case IDs, comments, measurements, payment details, and marketing contact data. Operators open the private source record only through the governed support path.</p>
      </section>

      <section className="rounded-[8px] border border-ui-border bg-ui-surface p-5" aria-labelledby="survey-ops-kinds-heading">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">By survey kind</p>
          <h2 id="survey-ops-kinds-heading" className="mt-1 text-2xl text-ink">What the signal is about.</h2>
        </div>
        <div className="mt-4 grid gap-3">
          {activeKinds.map((row) => {
            const definition = getSurveyDefinition(row.kind)
            return (
              <article key={row.kind} className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-ui-muted/45 px-4 py-3" data-testid={`survey-ops-kind-${row.kind}`}>
                <div>
                  <h3 className="font-semibold text-ink">{KIND_LABELS[row.kind]}</h3>
                  <p className="mt-1 text-xs text-ink/55">Negative at {definition.negativeScoreThreshold} or below · review invitation at {definition.positiveReviewThreshold} or above</p>
                </div>
                <div className="text-right"><strong className="block text-lg text-ink">{row.responseCount}</strong><span className="text-xs text-ink/55">{row.averageScore ?? '—'} average</span></div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, detail, tone = 'neutral' }: { label: string; value: number | string; detail: string; tone?: 'neutral' | 'warning' | 'positive' }) {
  const valueClass = tone === 'warning' ? 'text-rust' : tone === 'positive' ? 'text-needle' : 'text-ink'
  return <article className="rounded-[8px] border border-ui-border bg-ui-surface p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/50">{label}</p><p className={`mt-2 text-3xl font-semibold ${valueClass}`}>{value}</p><p className="mt-1 text-xs text-ink/55">{detail}</p></article>
}

function StatusRow({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'warning' | 'muted' | 'positive' }) {
  const markerClass = tone === 'warning' ? 'bg-rust' : tone === 'positive' ? 'bg-needle' : 'bg-ink/25'
  return <div className="rounded-[8px] border border-ui-border bg-ui-muted/45 p-4"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${markerClass}`} aria-hidden="true" /><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/55">{label}</p></div><p className="mt-2 font-semibold text-ink">{value}</p><p className="mt-1 text-xs text-ink/55">{detail}</p></div>
}
