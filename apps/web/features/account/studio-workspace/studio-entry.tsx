'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
export function StudioEntry({ returnTo, brief = false, beforeOpen, onUpload }: { returnTo: string; brief?: boolean; beforeOpen?: () => Promise<void>; onUpload?: () => void }) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const studioEnabled = true
  if (brief) {
    const openStudio = async (mode: 'create' | 'saved') => {
      setOpening(true)
      setError('')
      try {
        await beforeOpen?.()
        router.push(`/studio?${new URLSearchParams({ returnTo, mode })}` as Route)
      } catch {
        setError('Your brief could not be saved before opening Sketch Room. Try again.')
      } finally { setOpening(false) }
    }
    return (
    <section id="brief-references" className="grid gap-3 rounded-[12px] border border-needle/15 bg-needle/[0.035] p-4">
      <div><p className="text-sm font-semibold text-ink">Show the tailor your idea</p><p className="mt-1 text-xs leading-5 text-ink/60">Attach a source image directly, or use Sketch Room to sample a reference photo or draw over a paper sketch.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onUpload} className="rounded-[9px] bg-needle px-3 py-3 text-sm font-semibold text-white hover:bg-needle/90">Attach a source image</button>
        {studioEnabled ? <button type="button" disabled={opening} onClick={() => void openStudio('create')} className="rounded-[9px] border border-needle/20 bg-white px-3 py-3 text-sm font-semibold text-needle hover:bg-needle/[0.04] disabled:opacity-60">Open Sketch Room</button> : null}
      </div>
      {studioEnabled ? <button type="button" disabled={opening} onClick={() => void openStudio('saved')} className="justify-self-start text-xs font-semibold text-needle underline underline-offset-2 disabled:opacity-60">Use a saved sketch</button> : null}
      {error ? <p role="alert" className="text-xs text-red-800">{error}</p> : null}
    </section>
    )
  }
  if (!studioEnabled) return null
  return <Link href={{ pathname: '/studio', query: { returnTo } }} className="block rounded-lg px-3 py-3 text-sm font-semibold text-white hover:bg-white/10">Sketch Room · Start an idea</Link>
}
