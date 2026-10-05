'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'

const samples = [
  { title: 'Teal occasion', image: '/studio-preview/teal-occasion.jpg', detail: 'Gown · gele · embroidered cloth' },
  { title: 'Adire ensemble', image: '/studio-preview/adire-ensemble.jpg', detail: 'Bùbá · ìró · indigo cloth' },
  { title: 'Easy everyday', image: '/studio-preview/easy-everyday.jpg', detail: 'Relaxed shirt · wide trousers' },
]

export function StudioGuestPreview({ returnTo }: { returnTo: string }) {
  const [selected, setSelected] = useState(0)
  const destination = `/studio?returnTo=${encodeURIComponent(returnTo)}`
  const sample = samples[selected]!
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-7 px-5 py-7 sm:px-7 md:grid-cols-[.88fr_1.12fr] md:items-center md:gap-10 md:py-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-needle/70">A place for the idea</p>
        <h1 className="mt-3 text-4xl leading-[1.03] sm:text-5xl">Put the idea down.</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-ink/70 sm:text-base sm:leading-7">
          Draw a thought, upload a paper sketch, or pin a look beside your marks for colour and mood.
          Add clear directions before you bring it to a tailor.
        </p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs text-ink/65" aria-label="What you can do">
          <span className="rounded-full border border-needle/15 bg-white/70 px-3 py-2">Sketch or upload</span>
          <span className="rounded-full border border-needle/15 bg-white/70 px-3 py-2">Pin a look</span>
          <span className="rounded-full border border-needle/15 bg-white/70 px-3 py-2">Share with a tailor</span>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white" href={`/sign-in?returnTo=${encodeURIComponent(destination)}` as Route}>Sign in to start sketching</Link>
          <Link className="rounded-full border border-needle/25 bg-white/65 px-5 py-3 text-sm font-semibold text-needle" href={`/sign-up?returnTo=${encodeURIComponent(destination)}` as Route}>Create an account</Link>
        </div>
        <p className="mt-4 max-w-md text-xs leading-5 text-ink/50">You can browse these references first. Sign in to draw, upload, save, or attach an idea to a brief.</p>
        <p className="mt-3 text-xs leading-5 text-ink/50">Your sketch shares design intent; you and your tailor confirm fit, construction, and fabric together.</p>
      </div>
      <div className="rounded-2xl border border-needle/10 bg-[#f0f0e7] p-3 sm:p-4">
        <div className="relative mx-auto aspect-[4/3] max-h-[440px] overflow-hidden rounded-xl border border-[#deded2] bg-[#fffdf8] shadow-sm">
          <div aria-hidden="true" className="absolute inset-0 opacity-50" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 34px, #a5b6ad1a 35px, transparent 36px)' }} />
          <div className="absolute left-5 top-4 text-[9px] font-semibold tracking-[.16em] text-needle/45">DRAPEON · IDEA PAD</div>
          <div className="absolute inset-0 grid place-items-center px-6 pt-6">
            <p className="absolute left-[8%] top-1/2 max-w-[26%] -translate-y-1/2 text-left font-serif text-lg leading-6 text-needle/35 sm:text-xl">Your marks go here.</p>
          </div>
          <div className="absolute bottom-[8%] right-[7%] h-[72%] w-[34%] rotate-[3deg] rounded-md border border-white bg-white p-1.5 shadow-[0_8px_22px_rgba(31,58,48,.18)] sm:p-2">
            <img src={sample.image} alt={`${sample.title}, shown as a reference sticker`} className="h-full w-full object-contain" />
          </div>
          <div className="absolute bottom-3 left-4 text-[8px] font-medium tracking-[.14em] text-needle/35">SKETCH · REFERENCE · DIRECTIONS</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <div><p className="text-sm font-semibold text-needle">{sample.title}</p><p className="text-xs text-needle/60">{sample.detail}</p></div>
          <span className="text-[10px] font-semibold tracking-[.12em] text-needle/50">{String(selected + 1).padStart(2, '0')} / 03</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Preview reference looks">
          {samples.map((item, index) => <button type="button" key={item.title} aria-pressed={selected === index} onClick={() => setSelected(index)} className={`min-h-10 rounded-full border px-3 py-2 text-xs ${selected === index ? 'border-needle bg-needle text-white' : 'border-needle/20 bg-white/70 text-needle'}`}>{item.title}</button>)}
        </div>
      </div>
    </section>
  )
}
