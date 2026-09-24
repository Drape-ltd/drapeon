import { notFound } from 'next/navigation'
import { LifecycleProfilePreviewStatus } from '../../../components/lifecycle-profile-preview-status'
import { LifecycleProfileViewTracker } from '../../../components/lifecycle-profile-view-tracker'

export const metadata = {
  title: 'Lifecycle missing-media preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function LifecycleMissingMediaPreview(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-2xl rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm">
        <LifecycleProfilePreviewStatus />
        <LifecycleProfileViewTracker
          enabled
          tailorId="lifecycle-preview-tailor-missing-media"
          mediaReady={false}
          profileVariant="public-preview"
        />
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Negative preview</p>
        <h1 className="mt-3 text-4xl">Missing media is not a conversion.</h1>
        <p className="mt-3 text-sm leading-7 text-ink/65">
          A profile with unavailable approved media stays visible for QA, but the lifecycle tracker
          must emit no profile-view success event.
        </p>
      </div>
    </main>
  )
}
