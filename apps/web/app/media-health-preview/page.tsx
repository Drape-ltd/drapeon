import { notFound } from 'next/navigation'
import { PublicMediaImage, PublicMediaVideo } from '../../components/public-media'

export const metadata = {
  title: 'Media health preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function MediaHealthPreview(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-2xl rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
        <h1 className="mt-3 text-4xl">Media failure recovery</h1>
        <p className="mt-3 text-sm leading-7 text-ink/65">
          This intentionally missing public asset must render the approved fallback and report
          only safe host/path metadata. It must never take the page down or expose a signed URL.
        </p>
        <div className="relative mt-6 aspect-[4/3] overflow-hidden rounded-[8px] border border-ui-border bg-ui-muted">
          <PublicMediaImage
            src="/__drapeon-missing-media__.jpg?proof=media-health"
            alt="Intentional media health failure"
            sizes="(min-width: 768px) 672px, 100vw"
          />
        </div>
        <div className="relative mt-4 aspect-[16/9] overflow-hidden rounded-[8px] border border-ui-border bg-ui-muted">
          <PublicMediaVideo
            src="/__drapeon-missing-media__.mp4?proof=media-health"
            poster="/__drapeon-missing-media__.jpg?proof=media-health-video"
            label="Intentional media health video failure"
          />
        </div>
        <p className="mt-4 text-xs text-ink/55">Expected state: “Media temporarily unavailable.”</p>
      </div>
    </main>
  )
}
