import { LifecycleSurveyCard } from '../../../components/lifecycle-survey-card'
import { notFound } from 'next/navigation'

export default function SubmittedSurveyPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <main className="min-h-screen bg-ui-canvas p-6">
      <div className="mx-auto max-w-2xl pt-12">
        <LifecycleSurveyCard
          kind="CUSTOMER_POST_COMPLETION_CSAT"
          subjectType="ORDER"
          subjectId="preview-order"
          preview
          previewState="submitted"
        />
      </div>
    </main>
  )
}
