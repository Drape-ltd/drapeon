import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MarketingShell } from '../../components/marketing-shell'
import { SurveyOpsPreview } from '../../components/survey-ops-preview'

export const metadata: Metadata = {
  title: 'Survey Ops preview',
  robots: { index: false, follow: false },
}

export default function SurveyOpsPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <MarketingShell
      eyebrow="Development preview"
      title="Feedback that helps the team act."
      description="A local preview of the private survey summary used to route follow-up without turning responses into a marketing or analytics contact list."
    >
      <div className="mx-auto max-w-5xl py-8">
        <SurveyOpsPreview />
      </div>
    </MarketingShell>
  )
}
