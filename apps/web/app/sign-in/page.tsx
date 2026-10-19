import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Suspense } from 'react'
import { AccountAuthForm } from '../../components/account-auth-form'
import { AccountSignedInRedirect } from '../../components/account-signed-in-redirect'
import { AppStoreLinks } from '../../components/app-store-links'
import { buildMetadata } from '../../lib/metadata'
import { SignedOutFlash } from './signed-out-flash'

export const metadata: Metadata = buildMetadata({
  title: 'Sign in',
  description: 'Sign in to Drapeon as a customer or tailor.',
  path: '/sign-in',
  noindex: true,
})

export default function SignInPage(): React.JSX.Element {
  return (
    <main className="min-h-[100svh] bg-ui-canvas p-3 sm:p-4">
      <AccountSignedInRedirect to="/account/orders" />
      {/*
        One rounded card filling the viewport, split evenly between the form
        and the image. The wordmark stands in for the site navbar here, as the
        way back home from a focused sign-in screen.
      */}
      <div className="grid min-h-[calc(100svh-1.5rem)] overflow-hidden rounded-[28px] bg-white sm:min-h-[calc(100svh-2rem)] lg:grid-cols-2">
        <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16 lg:py-12">
          <Link href="/" className="w-fit text-3xl leading-none text-needle [font-family:var(--font-display)]">
            Drapeon
          </Link>
          <div className="flex flex-1 items-center py-10">
            <div className="w-full max-w-md">
              <Suspense>
                <SignedOutFlash />
              </Suspense>
              <AccountAuthForm mode="sign-in" />
              <AppStoreLinks
                label="Prefer your phone? Get the Drapeon app."
                placement="Sign in"
                className="mt-8 border-t border-ink/10 pt-6"
              />
            </div>
          </div>
        </div>

        <div className="hidden p-4 lg:block">
          <div className="relative h-full min-h-[36rem] overflow-hidden rounded-[22px] bg-illustration-canvas">
            <Image
              src="/editorial/drapeon-finishing-detail-v1.jpg"
              alt="A tailor finishing a garment by hand"
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 0px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,29,23,0.08)_30%,rgba(15,29,23,0.88)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 p-8 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Your Drapeon account</p>
              <h2 className="mt-3 max-w-md text-4xl leading-[1.02]">Pick up where the work left off.</h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-white/70">Orders, conversations, measurements, and approvals stay connected.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
