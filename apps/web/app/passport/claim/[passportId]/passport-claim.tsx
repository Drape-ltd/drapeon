'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'

type Preview = { clientName: string; tailorName: string; measurementCount: number; alreadyClaimed: boolean; expired: boolean }
type ClaimState = { status: 'loading' | 'signed-out' | 'ready' | 'claiming' | 'claimed' | 'error'; preview?: Preview; message?: string }

async function fetchPassportPreview(passportId: string): Promise<ClaimState> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(passportId)) {
      return { status: 'error', message: 'This invite link is invalid. Ask your tailor to resend it.' }
    }
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return { status: 'signed-out' }
      const { data, error } = await supabase.functions.invoke('claim-passport', { body: { passportId, action: 'preview' } })
      if (error || !data || data.error) throw new Error(data?.error || 'The passport could not be opened. Please try again.')
      return { status: 'ready', preview: data as Preview }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : 'The passport could not be opened.' }
    }
}

export function PassportClaim({ passportId }: { passportId: string }) {
  const [state, setState] = useState<ClaimState>({ status: 'loading' })
  const destination = `/passport/claim/${encodeURIComponent(passportId)}`

  useEffect(() => {
    let active = true
    void fetchPassportPreview(passportId).then(next => { if (active) setState(next) })
    return () => { active = false }
  }, [passportId])

  async function load() {
    setState({ status: 'loading' })
    setState(await fetchPassportPreview(passportId))
  }

  async function claim() {
    if (state.status !== 'ready') return
    setState({ ...state, status: 'claiming' })
    try {
      const { data, error } = await createClient().functions.invoke('claim-passport', { body: { passportId, action: 'claim' } })
      if (error || !data?.success) throw new Error(data?.error || 'We could not add these measurements. Please retry.')
      setState({ status: 'claimed' })
    } catch (error) {
      setState({ ...state, status: 'error', message: error instanceof Error ? error.message : 'We could not claim this passport.' })
    }
  }

  return <main className="min-h-screen bg-ui-canvas px-5 py-16 text-ink">
    <section className="mx-auto max-w-lg rounded-[12px] border border-ui-border bg-white p-7 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-needle">Drapeon Client Passport</p>
      <h1 className="mt-3 text-3xl">Your fit details, ready to carry forward</h1>
      {state.status === 'loading' ? <p className="mt-5">Checking your invitation…</p> : null}
      {state.status === 'signed-out' ? (
        <>
          <p className="mt-5">
            Sign in or create a customer account to review and add the measurements your tailor
            prepared. Your passport will be waiting when you return.
          </p>
          <div className="mt-6 flex gap-3">
            <Link
              className="rounded-full bg-needle px-5 py-3 font-semibold text-white"
              href={`/sign-in?role=customer&next=${encodeURIComponent(destination)}`}
            >
              Sign in
            </Link>
            <Link
              className="rounded-full border border-needle px-5 py-3 font-semibold text-needle"
              href={`/sign-up?role=customer&next=${encodeURIComponent(destination)}`}
            >
              Create account
            </Link>
          </div>
        </>
      ) : null}
      {state.status === 'ready' && state.preview ? <><p className="mt-5">{state.preview.tailorName} prepared a fit profile for {state.preview.clientName} with {state.preview.measurementCount} measurements.</p>{state.preview.expired || state.preview.alreadyClaimed ? <p className="mt-4 text-rust">{state.preview.expired ? 'This invitation has expired. Ask your tailor for a fresh link.' : 'This passport has already been claimed.'}</p> : <button className="mt-6 rounded-full bg-needle px-5 py-3 font-semibold text-white" onClick={() => void claim()}>Add measurements to my account</button>}</> : null}
      {state.status === 'claiming' ? <p className="mt-5">Adding your measurements…</p> : null}
      {state.status === 'claimed' ? <><p className="mt-5">Your passport has been claimed.</p><Link className="mt-5 inline-block rounded-full bg-needle px-5 py-3 font-semibold text-white" href="/account/measurements">Review measurements</Link></> : null}
      {state.status === 'error' ? <><p className="mt-5 text-rust" role="alert">{state.message}</p><button className="mt-5 rounded-full border border-needle px-5 py-3 text-needle" onClick={() => void load()}>Try again</button></> : null}
    </section>
  </main>
}
