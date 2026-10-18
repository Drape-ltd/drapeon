'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { ChevronLeft, ChevronRight, ShieldCheck, Star } from 'lucide-react'
import { useEffect, useRef, useState, type UIEvent } from 'react'
import type { MarketplaceMediaKind } from '@drape/shared'
import type { PublicTailor } from '../lib/public-marketplace'
import { PublicMediaImage, reportPublicMediaFailure } from './public-media'
import { PublicPriceDisplay } from './public-price-display'
import { IconButton } from './ui/icon-button'

/** Enough to preview a portfolio without loading all of it into one card. */
const MAX_SLIDES = 6

type Slide = {
  key: string
  kind: MarketplaceMediaKind
  url: string
  posterUrl: string | null
  focalX: number
  focalY: number
  altText: string | null
}

// The primary item leads, then the rest in portfolio order. Tailors without
// structured media fall back to their portfolio photos, then their avatar.
function cardSlides(tailor: PublicTailor): Slide[] {
  if (tailor.media.length) {
    return [...tailor.media]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.position - b.position)
      .slice(0, MAX_SLIDES)
      .map((media) => ({
        key: media.id,
        kind: media.kind,
        url: media.url,
        posterUrl: media.posterUrl,
        focalX: media.focalX,
        focalY: media.focalY,
        altText: media.altText,
      }))
  }
  const photos = tailor.portfolioPhotos.length
    ? tailor.portfolioPhotos
    : tailor.avatarUrl
      ? [tailor.avatarUrl]
      : []
  return photos.slice(0, MAX_SLIDES).map((url) => ({
    key: url,
    kind: 'IMAGE' as const,
    url,
    posterUrl: null,
    focalX: 0.5,
    focalY: 0.5,
    altText: null,
  }))
}

function ViewportVideo({
  src,
  poster,
  label,
  position,
}: {
  src: string
  poster?: string
  label: string
  position: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const stopOthers = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== src) video.pause()
    }
    // The observer accounts for the carousel's clipping, so a video scrolled
    // out of the card sideways pauses the same way as one scrolled off-page.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          entry.intersectionRatio >= 0.65 &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          window.dispatchEvent(new CustomEvent('drapeon:marketplace-video-play', { detail: src }))
          void video.play().catch(() => undefined)
        } else video.pause()
      },
      { threshold: [0, 0.65] }
    )
    window.addEventListener('drapeon:marketplace-video-play', stopOthers)
    observer.observe(video)
    return () => {
      observer.disconnect()
      window.removeEventListener('drapeon:marketplace-video-play', stopOthers)
    }
  }, [src])
  if (failed) {
    return <div className="grid size-full place-items-center bg-ui-muted px-4 text-center text-xs font-semibold text-ink/50" role="img" aria-label={`${label} unavailable`}>Media temporarily unavailable</div>
  }
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      className="size-full object-cover"
      style={{ objectPosition: position }}
      aria-label={label}
      onError={() => {
        setFailed(true)
        reportPublicMediaFailure(src)
      }}
    />
  )
}

/**
 * One tailor in the explore grid. The images swipe natively on touch and
 * page with hover chevrons on desktop. The card is not one big link, because
 * the chevrons are buttons: the slides and the name each link to the profile
 * instead, and the name's link stretches over the text below the image.
 */
export function TailorCard({
  tailor,
  index,
  profileBasePath,
}: {
  tailor: PublicTailor
  /** Position in the grid; the first row's lead images load eagerly. */
  index: number
  profileBasePath: '/tailors' | '/account/tailors'
}): React.JSX.Element {
  const href = `${profileBasePath}/${tailor.id}` as Route
  const slides = cardSlides(tailor)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  const serviceLabels = [
    tailor.acceptsCustomOrders ? 'Custom orders' : null,
    tailor.supportsReadyMade ? 'Ready-made' : null,
  ].filter((value): value is string => value !== null)
  const hasStartingPrice = tailor.priceRangeMin !== null && tailor.priceRangeMin >= 1_000

  function showSlide(next: number): void {
    const scroller = scrollerRef.current
    if (!scroller) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ left: next * scroller.clientWidth, behavior: reduced ? 'auto' : 'smooth' })
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const { scrollLeft, clientWidth } = event.currentTarget
    const next = Math.round(scrollLeft / Math.max(1, clientWidth))
    setCurrent((value) => (value === next ? value : next))
  }

  return (
    <article className="relative min-w-0 rounded-[8px] has-[.tailor-card-link:focus-visible]:outline has-[.tailor-card-link:focus-visible]:outline-2 has-[.tailor-card-link:focus-visible]:outline-offset-2 has-[.tailor-card-link:focus-visible]:outline-needle">
      <div className="group/media relative aspect-[4/5] overflow-hidden rounded-[8px] bg-needle/10">
        {slides.length ? (
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            className="flex size-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((slide, slideIndex) => {
              const position = `${slide.focalX * 100}% ${slide.focalY * 100}%`
              return (
                // Every slide opens the profile; the name link below is the
                // one keyboard and screen-reader users land on.
                <Link
                  key={slide.key}
                  href={href}
                  tabIndex={-1}
                  aria-hidden="true"
                  draggable={false}
                  className="relative block size-full shrink-0 snap-center [&_img]:[-webkit-user-drag:none]"
                >
                  {slide.kind === 'VIDEO' ? (
                    <ViewportVideo
                      src={slide.url}
                      poster={slide.posterUrl ?? undefined}
                      position={position}
                      label={slide.altText ?? `Portfolio video by ${tailor.displayName}`}
                    />
                  ) : (
                    <PublicMediaImage
                      src={slide.url}
                      alt={slide.altText ?? `Selected work by ${tailor.displayName}`}
                      fill
                      priority={index < 4 && slideIndex === 0}
                      sizes="(min-width:1536px) 16vw,(min-width:1280px) 20vw,(min-width:640px) 30vw,48vw"
                      className="object-cover transition-opacity group-hover/media:opacity-95"
                      style={{ objectPosition: position }}
                    />
                  )}
                </Link>
              )
            })}
          </div>
        ) : (
          <Link
            href={href}
            tabIndex={-1}
            aria-hidden="true"
            className="grid size-full place-items-center text-sm font-semibold text-needle/60"
          >
            {tailor.displayName.slice(0, 2).toUpperCase()}
          </Link>
        )}

        {serviceLabels.length ? (
          <div className="pointer-events-none absolute left-2 right-11 top-2 flex flex-wrap gap-1">
            {serviceLabels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-needle shadow-sm"
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
        <span
          role="img"
          aria-label="Approved tailor"
          title="Approved tailor"
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-white/90 text-needle shadow-sm"
        >
          <ShieldCheck aria-hidden="true" size={14} />
        </span>

        {slides.length > 1 ? (
          <>
            {/* Desktop only; touch devices swipe. They show on hover or keyboard focus. */}
            {current > 0 ? (
              <IconButton
                label="Previous photo"
                variant="ghost"
                size="icon-sm"
                onClick={() => showSlide(current - 1)}
                className="absolute left-2 top-1/2 z-10 hidden size-8 -translate-y-1/2 rounded-full bg-white/90 text-ink opacity-0 shadow-md transition hover:bg-white hover:text-ink focus-visible:opacity-100 group-hover/media:opacity-100 md:inline-flex"
              >
                <ChevronLeft aria-hidden="true" />
              </IconButton>
            ) : null}
            {current < slides.length - 1 ? (
              <IconButton
                label="Next photo"
                variant="ghost"
                size="icon-sm"
                onClick={() => showSlide(current + 1)}
                className="absolute right-2 top-1/2 z-10 hidden size-8 -translate-y-1/2 rounded-full bg-white/90 text-ink opacity-0 shadow-md transition hover:bg-white hover:text-ink focus-visible:opacity-100 group-hover/media:opacity-100 md:inline-flex"
              >
                <ChevronRight aria-hidden="true" />
              </IconButton>
            ) : null}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
              {slides.map((slide, slideIndex) => (
                <span
                  key={slide.key}
                  className={`size-1.5 rounded-full shadow-[0_0_2px_rgba(0,0,0,0.45)] transition-colors ${slideIndex === current ? 'bg-white' : 'bg-white/50'}`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="relative pt-2.5">
        {/*
          Name and price share a row when the card is wide enough. On narrow
          cards (two-column mobile) the price wraps under the name rather than
          squeezing it: the name is what should never get cut short.
        */}
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-0.5">
          <h2 className="min-w-0 max-w-full truncate text-base font-semibold leading-tight text-ink">
            <Link href={href} className="tailor-card-link outline-none after:absolute after:inset-0">
              {tailor.displayName}
            </Link>
          </h2>
          {hasStartingPrice ? (
            <span className="shrink-0 text-sm font-semibold leading-tight text-ink">
              <PublicPriceDisplay
                amountMinor={tailor.priceRangeMin!}
                currency={tailor.currency}
                prefix="From "
                align="end"
                hideEstimateLabel
              />
            </span>
          ) : null}
        </div>
        <p className="mt-1 flex items-center justify-between gap-2 text-xs text-ink/60">
          <span className="truncate">{tailor.location || 'Location available in profile'}</span>
          {tailor.totalReviews ? (
            <span className="flex shrink-0 items-center gap-1">
              <Star aria-hidden="true" size={11} fill="currentColor" />
              {tailor.averageRating.toFixed(1)}
            </span>
          ) : null}
        </p>
        <p className="mt-1 truncate text-xs text-ink/60">
          {tailor.specialties.slice(0, 2).join(' · ') ||
            (tailor.acceptsCustomOrders ? 'Custom tailoring' : 'Ready-made')}
        </p>
        {tailor.fulfillment.length ? (
          <p className="mt-1 truncate text-[11px] text-ink/50">{tailor.fulfillment.join(' · ')}</p>
        ) : null}
      </div>
    </article>
  )
}
