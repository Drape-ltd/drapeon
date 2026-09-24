import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LifecycleSurveyCard } from '../../components/lifecycle-survey-card'
import { MarketingShell } from '../../components/marketing-shell'

export const metadata: Metadata = {
  title: 'Survey preview',
  robots: { index: false, follow: false },
}

export default function SurveyPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <MarketingShell
      eyebrow="Development preview"
      title="Private feedback, without pressure."
      description="A local preview of the post-completion CSAT surface. Production only renders this after a durable, eligible invite is available."
    >
      <div className="mx-auto max-w-2xl py-8">
        <LifecycleSurveyCard
          kind="CUSTOMER_POST_COMPLETION_CSAT"
          subjectType="ORDER"
          subjectId="preview-order"
          preview
        />
      </div>
    </MarketingShell>
  )
}
