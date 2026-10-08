'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PublicSiteHeader } from './public-site-header'

const HERO_VIDEO_SRC = 'https://media.drapeon.co/homepage/drapeon-home-hero-v1.mp4'
const HERO_POSTER_SRC = 'https://media.drapeon.co/homepage/drapeon-home-hero-poster-v1.jpg'

/**
 * Autoplay is never guaranteed. iOS Low Power Mode, data-saver modes, managed
 * browser policies, and a failed media request all refuse or delay it. Reveal
 * the copy on this deadline regardless so the hero can never settle as an
 * empty frame while someone waits on a `playing` event that never arrives.
 */
const COPY_REVEAL_FALLBACK_MS = 1800

/** Staggers one copy block behind the previous one, in seconds. */
function copyDelay(seconds: number): CSSProperties {
  return { '--hero-copy-delay': `${seconds}s` } as CSSProperties
}

export function HomeHero(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [copyState, setCopyState] = useState<'pending' | 'revealed'>('pending')
  // Returning the current value keeps repeat calls (onTimeUpdate fires several
  // times a second) from queueing further renders once the copy is revealed.
  const revealCopy = useCallback(() => {
    setCopyState((current) => (current === 'revealed' ? current : 'revealed'))
  }, [])

  useEffect(() => {
    // A looping background video is motion this viewer asked not to receive.
    // Hold the frame and let the copy in on the next tick instead of waiting
    // on a `playing` event that will now never arrive.
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) videoRef.current?.pause()

    // The reveal stays inside the timer callback on purpose: revealing
    // synchronously here would set state during the effect and cascade renders.
    const timer = window.setTimeout(
      revealCopy,
      prefersReducedMotion ? 0 : COPY_REVEAL_FALLBACK_MS
    )
    return () => window.clearTimeout(timer)
  }, [revealCopy])

  return (
    <section
      data-hero-copy={copyState}
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-ink"
    >
      <noscript>
        {/* Nothing can reveal the copy without hydration, so keep it visible. */}
        <style>{'.hero-copy-item{opacity:1!important;animation:none!important}'}</style>
      </noscript>

      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        src={HERO_VIDEO_SRC}
        poster={HERO_POSTER_SRC}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={revealCopy}
        // A cached video can already be playing before hydration attaches
        // onPlaying, so that event never fires. timeupdate still does.
        onTimeUpdate={revealCopy}
        onError={revealCopy}
      />

      {/* Keeps the white copy legible over whatever frame is on screen. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,12,10,0.88)_0%,rgba(10,12,10,0.6)_40%,rgba(10,12,10,0.12)_76%),linear-gradient(0deg,rgba(10,12,10,0.38)_0%,transparent_52%)]"
      />

      <PublicSiteHeader tone="overlay" />

      <div className="relative z-10 flex flex-1 items-end px-6 pb-12 pt-24 sm:px-10 lg:px-16 lg:pb-16">
        <div className="max-w-3xl xl:max-w-5xl text-white">
          <p
            className="hero-copy-item text-[11px] xl:text-sm font-semibold uppercase tracking-[0.22em] text-white/68 sm:text-xs"
            style={copyDelay(0)}
          >
            Drapeon · custom clothing without borders
          </p>
          <h1
            className="hero-copy-item mt-5 text-[clamp(3.4rem,8vw,7.6rem)] xl:text-[clamp(10rem,8vw,10rem)] leading-[0.84] tracking-[-0.045em] text-white"
            style={copyDelay(0.14)}
          >
            From idea<br />to garment.
          </h1>
          <p
            className="hero-copy-item mt-7 max-w-xl text-base leading-7 text-white/76 sm:text-lg xl:text-xl sm:leading-8"
            style={copyDelay(0.3)}
          >
            A clearer way to commission, shape, and follow clothing made for you.
          </p>
          <div className="mt-8 flex max-w-2xl flex-col gap-3">
            {/* <div className="hero-copy-item flex flex-wrap items-center gap-3" style={copyDelay(0.44)}>
              <Link href="/explore" className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-ink shadow-[0_14px_36px_rgba(0,0,0,0.18)] transition duration-300 hover:bg-bone hover:shadow-[0_18px_44px_rgba(0,0,0,0.23)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" data-analytics-event="primary_cta_click" data-analytics-label="Homepage explore marketplace">
                <span className="relative flex size-3.5 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-needle opacity-40 motion-reduce:animate-none" /><span className="relative inline-flex size-3.5 rounded-full bg-needle" /></span>
                Explore tailors
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-needle text-white transition-transform duration-300 group-hover:translate-x-0.5"><ArrowRight aria-hidden="true" size={15} /></span>
              </Link>
            </div> */}
            <div className="hero-copy-item flex flex-wrap items-center gap-2.5 text-sm" style={copyDelay(0.56)}>
              {/* <Link href="/how-it-works" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/24 bg-black/14 px-4 font-semibold text-white/82 backdrop-blur transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white" data-analytics-event="secondary_cta_click" data-analytics-label="Homepage how it works">See how it works <ArrowRight aria-hidden="true" size={14} /></Link> */}
              <Link href="/explore" className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 text-sm font-semibold text-ink shadow-[0_14px_36px_rgba(0,0,0,0.18)] transition duration-300 hover:bg-bone hover:shadow-[0_18px_44px_rgba(0,0,0,0.23)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" data-analytics-event="primary_cta_click" data-analytics-label="Homepage explore marketplace">
                <span className="relative flex size-3.5 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-needle opacity-40 motion-reduce:animate-none" /><span className="relative inline-flex size-3.5 rounded-full bg-needle" /></span>
                Explore tailors
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-needle text-white transition-transform duration-300 group-hover:translate-x-0.5"><ArrowRight aria-hidden="true" size={15} /></span>
              </Link>
              <Link href="/sign-up?role=TAILOR" className="inline-flex min-h-12 items-center rounded-full border border-white/18 bg-black/14 px-4 font-semibold text-white/72 backdrop-blur transition-colors hover:border-white/36 hover:bg-white/10 hover:text-white" data-analytics-event="secondary_cta_click" data-analytics-label="Homepage join as tailor">Join as a tailor</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
