import Link from 'next/link'
import type { Route } from 'next'

import { Button } from '../../../components/ui/button'

export function AccountAuthRequiredState({
  pathname,
}: {
  pathname: string | null
}): React.JSX.Element {
  const signInHref = pathname?.startsWith('/account/')
    ? (`/sign-in?next=${encodeURIComponent(pathname)}` as Route)
    : ('/sign-in' as Route)

  return (
    <main className="min-h-screen bg-ui-canvas">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <div className="app-surface p-7">
          <p className="text-xs font-semibold uppercase text-needle/80">Account</p>
          <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Sign in to continue.</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">
            Access your protected orders, messages, measurements, payments, and support.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={signInHref}>Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/sign-up">Create account</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}

export function AccountRouteLoadingState(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-ui-canvas">
      <p className="sr-only">Loading account.</p>
      <div className="animate-pulse">
        <div className="h-14 border-b border-ui-border bg-white" />
        <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 pt-8">
          <div className="h-7 w-36 rounded-[8px] bg-ui-border" />
          <div className="h-4 w-52 rounded-[6px] bg-ui-border" />
          <div className="mt-2 h-28 rounded-[8px] bg-ui-border" />
          <div className="h-16 rounded-[8px] bg-ui-border" />
          <div className="h-16 rounded-[8px] bg-ui-border" />
          <div className="flex gap-3">
            <div className="h-20 flex-1 rounded-[8px] bg-ui-border" />
            <div className="h-20 flex-1 rounded-[8px] bg-ui-border" />
          </div>
        </div>
      </div>
    </main>
  )
}
