import * as React from 'react'

type OpsLocalSessionViewProps = {
  reason: 'session-expired' | 'data-unavailable'
  signInHref?: string
}

export function OpsLocalSessionView({ reason, signInHref = 'http://127.0.0.1:3006/local-mfa' }: OpsLocalSessionViewProps): React.JSX.Element {
  const expired = reason === 'session-expired'

  return (
    <main className="flex min-h-screen items-center justify-center bg-bone px-5 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-ink/10 bg-white p-7 shadow-sm sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
          Dev Ops
        </p>
        <h1 className="mt-4 text-3xl text-ink">
          {expired ? 'Your Ops session expired' : 'Ops data could not load'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/65">
          {expired
            ? 'Sign in again, then return to this tab and reload to continue your work.'
            : 'Your sign-in is active. Try loading Ops again in a moment.'}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a
            href={expired ? signInHref : '/ops'}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-6 text-sm font-semibold text-white"
          >
            {expired ? 'Sign in to Ops' : 'Try again'}
          </a>
          {!expired ? (
            <form action="/ops/logout" method="post">
              <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink/10 px-6 text-sm font-semibold text-ink">
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  )
}

