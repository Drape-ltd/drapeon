import { notFound } from 'next/navigation'
import { LifecycleProfileViewTracker } from '../../../components/lifecycle-profile-view-tracker'
import { LifecycleProfilePreviewStatus } from '../../../components/lifecycle-profile-preview-status'

export const metadata = {
  title: 'Lifecycle profile analytics preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function LifecycleProfileAnalyticsPreview(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-2xl rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm">
        <LifecycleProfilePreviewStatus />
        <LifecycleProfileViewTracker
          enabled
          tailorId="lifecycle-preview-tailor-001"
          mediaReady
          profileVariant="public-preview"
        />
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
        <h1 className="mt-3 text-4xl">Public tailor profile analytics</h1>
        <p className="mt-3 text-sm leading-7 text-ink/65">
          This preview proves that an approved profile view can emit only after explicit analytics
          consent, with a hashed tailor identifier and no private profile data.
        </p>
        <div className="mt-6 grid gap-3 rounded-[8px] border border-ui-border bg-ui-muted p-4 text-sm">
          <p><span className="font-semibold">Media state:</span> approved media available</p>
          <p><span className="font-semibold">Event:</span> tailor_profile_viewed.v1</p>
          <p><span className="font-semibold">Negative case:</span> missing media emits no conversion</p>
        </div>
      </div>
    </main>
  )
}
