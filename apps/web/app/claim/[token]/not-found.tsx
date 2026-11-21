import Link from 'next/link'

export default function ClaimLinkNotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center bg-bone px-5 py-16 text-ink sm:px-10">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-needle">
          Your Drapeon shop
        </p>
        <h1 className="mt-5 font-serif text-5xl leading-tight sm:text-6xl">
          This private link is no longer available.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-ink/70">
          If you already claimed your shop, sign in to continue setup. If you have not claimed it
          yet, ask the person who sent your link for a new one.
        </p>
        <Link
          href="/sign-in"
          className="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-needle px-7 py-3 text-sm font-semibold text-white"
        >
          Sign in to continue
        </Link>
      </div>
    </main>
  )
}
