import type { Metadata } from 'next'
import {
  DRAPEON_ANDROID_STORE_URL,
  DRAPEON_IOS_STORE_URL,
  normalizeDrapeonAppUrl,
  normalizeEmailWebPath,
} from '@drape/shared/email-links'

export const metadata: Metadata = {
  title: 'Open in Drapeon',
  description: 'Choose how you want to continue with Drapeon.',
  robots: { index: false, follow: false },
}

type OpenPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function OpenPage({
  searchParams,
}: OpenPageProps): Promise<React.JSX.Element> {
  const params = await searchParams
  const webPath = normalizeEmailWebPath(firstParam(params.next))
  const appUrl = normalizeDrapeonAppUrl(firstParam(params.app))
  const webUrl = webPath

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-8 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center justify-center">
        <section
          className="w-full rounded-[16px] border border-ink/10 bg-white p-7 shadow-sm sm:p-10"
          aria-labelledby="open-heading"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">Drapeon</p>
          <h1 id="open-heading" className="mt-4 text-4xl leading-[1.02] sm:text-5xl">
            Open this in Drapeon.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-ink/65">
            Use the app for the quickest path, or continue on the web if that suits you better.
          </p>

          <div className="mt-8 grid gap-3">
            {appUrl ? (
              <a
                href={appUrl}
                data-testid="open-in-app"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle/90"
              >
                Open in Drapeon
              </a>
            ) : null}
            <a
              href={webUrl}
              data-testid="continue-on-web"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-ink/15 px-5 py-3 text-sm font-semibold text-ink transition hover:bg-ui-canvas"
            >
              Continue on the web
            </a>
          </div>

          <div className="mt-9 border-t border-ink/10 pt-6">
            <p className="text-sm font-semibold text-ink">Need the app?</p>
            <p className="mt-2 text-sm leading-6 text-ink/60">
              Install it first, then return to this email and choose Open in Drapeon.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <a
                href={DRAPEON_IOS_STORE_URL}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ui-canvas"
              >
                App Store
              </a>
              <a
                href={DRAPEON_ANDROID_STORE_URL}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-ui-canvas"
              >
                Google Play
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
