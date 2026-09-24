'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { ArrowRight, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../lib/supabase'
import { WishlistSaveControl } from './wishlist-save-control'

type AccountState = 'checking' | 'signed-out' | 'customer' | 'tailor' | 'unconfigured'

export function PublicTailorActions({
  tailorId,
  acceptsCustomOrders,
  tailorName,
  location,
}: {
  tailorId: string
  acceptsCustomOrders: boolean
  tailorName: string
  location?: string | null
}): React.JSX.Element {
  const [accountState, setAccountState] = useState<AccountState>('checking')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const briefHref = useMemo(() => `/account/brief/${tailorId}` as Route, [tailorId])
  const signInHref = useMemo(
    () => `/sign-in?next=${encodeURIComponent(briefHref)}` as Route,
    [briefHref],
  )
  const chooseRoleHref = useMemo(
    () => `/account/choose-role?next=${encodeURIComponent(briefHref)}` as Route,
    [briefHref],
  )

  async function shareProfile() {
    const url = window.location.href
    const shareText = `See ${tailorName} on Drapeon${location ? ` in ${location}` : ''}.`
    try {
      if (navigator.share) {
        await navigator.share({ title: `${tailorName} on Drapeon`, text: shareText, url })
        setShareMessage('Profile shared.')
        return
      }
      await navigator.clipboard.writeText(url)
      setShareMessage('Profile link copied.')
    } catch (error) {
      // Closing the native share sheet is a normal user outcome, not a failed
      // share. Keep the status quiet so the profile remains calm and reusable.
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareMessage('Copy the profile link from your browser to share it.')
    }
  }

  useEffect(() => {
    let active = true
    const supabase = createClient()

    async function resolveAccount(session: { user: { id: string } } | null) {
      if (!session) {
        if (active) setAccountState('signed-out')
        return
      }

      const [customerResult, tailorResult] = await Promise.all([
        supabase.from('customer_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('tailor_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle(),
      ])
      if (!active) return
      setCustomerId(customerResult.data ? session.user.id : null)
      setAccountState(customerResult.data ? 'customer' : tailorResult.data ? 'tailor' : 'unconfigured')
    }

    void supabase.auth.getSession().then(({ data }) => {
      void resolveAccount(data.session)
    }).catch(() => {
      if (active) setAccountState('signed-out')
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolveAccount(session)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [tailorId])

  return (
    <div aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        {!acceptsCustomOrders ? (
          <span className="text-sm text-ink/48">Custom briefs are not currently open.</span>
        ) : accountState === 'tailor' ? (
          <span className="text-sm text-ink/48">Switch to a customer account to send a brief.</span>
        ) : (
          <Link
            href={accountState === 'customer' ? briefHref : accountState === 'unconfigured' ? chooseRoleHref : signInHref}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-xs font-semibold text-white transition-colors hover:bg-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
          >
            Start a brief <ArrowRight aria-hidden="true" size={14} />
          </Link>
        )}
        {accountState === 'customer' && customerId ? <WishlistSaveControl userId={customerId} target={{ type: 'TAILOR', id: tailorId }} /> : null}
        <button
          type="button"
          onClick={() => void shareProfile()}
          className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-ink/14 px-4 text-xs font-semibold text-ink transition hover:border-needle hover:text-needle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
          aria-label={`Share ${tailorName} profile`}
        >
          <Share2 aria-hidden="true" size={14} /> Share profile
        </button>
      </div>
      {shareMessage ? <p role="status" className="mt-2 text-xs text-ink/54">{shareMessage}</p> : null}
      {accountState === 'signed-out' ? (
        <p className="mt-3 text-xs text-ink/48">Sign in or create an account, then return here.</p>
      ) : accountState === 'checking' ? (
        <p className="mt-3 text-xs text-ink/48">Checking your account…</p>
      ) : null}
    </div>
  )
}
