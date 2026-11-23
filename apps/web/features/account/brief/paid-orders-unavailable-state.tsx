'use client'

import Link from 'next/link'
import type { Route } from 'next'

export function PaidOrdersUnavailableState({
  tailorId,
  onCheckAgain,
}: {
  tailorId: string
  onCheckAgain: () => void
}) {
  return (
    <section className="app-surface p-7" role="status">
      <h2 className="text-2xl font-semibold text-ink">Paid orders aren’t available on this route yet</h2>
      <p className="mt-2 text-sm leading-6 text-ink/62">
        This tailor isn’t taking paid orders right now. You can still view their profile and come back when the route is ready.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href={`/account/tailors/${encodeURIComponent(tailorId)}` as Route}
          className="inline-flex h-10 items-center rounded-[8px] bg-drape-green px-4 text-sm font-semibold text-white"
        >
          View tailor profile
        </Link>
        <button
          type="button"
          onClick={onCheckAgain}
          className="inline-flex h-10 items-center rounded-[8px] border border-ink/12 px-4 text-sm font-semibold text-ink"
        >
          Check again
        </button>
      </div>
    </section>
  )
}
