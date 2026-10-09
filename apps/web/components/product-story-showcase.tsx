'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type AnimationEvent,
  type FocusEvent,
  type PointerEvent,
} from 'react'
import { IconButton } from './ui/icon-button'

// Titles track the headline baked into each screenshot, so the open step and
// the phone beside it always say the same thing. 01–05 follow the customer,
// 06–09 the tailor.
const stories = [
  { number: '01', src: '/product2/drapeon_ios_01.png', alt: 'Drapeon Explore screen with a style search, active orders, and tailors in Accra and Lagos priced in local currency and US dollars', title: 'Find skilled tailors anywhere', body: 'Search by style, location, or tailor, and see local prices next to your own currency.' },
  { number: '02', src: '/product2/drapeon_ios_02.png', alt: 'Verified profile for Anna, a tailor in Accra, Ghana, showing a portfolio gown, a 4.9 rating from 48 reviews, and over 120 orders', title: 'See their work before you order', body: 'Browse a verified tailor’s portfolio, reviews, finished orders, and when they next take work.' },
  { number: '03', src: '/product2/drapeon_ios_03.png', alt: 'Measurement screen showing a saved Fit 360 profile with chest, waist, hip, and shoulder measurements, plus tools for bodices and lower body', title: 'Measure yourself at home', body: 'Scan with your phone camera to save a core fit profile, with focused tools for bodices, wrists, and headwear.' },
  { number: '04', src: '/product2/drapeon_ios_04.png', alt: 'Sketch Room showing a gown outline with notes about an off-the-shoulder neckline and a kente panel, ready to send to the tailor', title: 'Sketch your idea', body: 'Draw the piece, pin notes where they matter, and send it straight to your tailor.' },
  { number: '05', src: '/product2/drapeon_ios_05.png', alt: 'Quote for a wedding gown from Anna in Accra, itemising tailoring, a protected fabric allowance, and shipping, totalling 268 US dollars', title: 'Know the full price before you pay', body: 'One quote shows tailoring, protected fabric money, shipping, and fees. Unused fabric money comes back to you.' },
  { number: '06', src: '/product2/drapeon_ios_06.png', alt: 'Tailor cockpit for Bisola showing active and completed orders, quotes waiting for review, and the next payout in naira', title: 'Run your tailoring business', body: 'Tailors see active orders, replies waiting, quotes to review, and the next payout in one place.' },
  { number: '07', src: '/product2/drapeon_ios_07.png', alt: 'Tailor client list with saved measurements for each client and options to invite or export a record', title: 'Keep every client’s measurements', body: 'Store measurements for Drapeon customers and offline clients, then invite them or export their records.' },
  { number: '08', src: '/product2/drapeon_ios_08.png', alt: 'Shared Sketch Room for an agbada with a tailor note about gold embroidery and a client question about sleeve length', title: 'Work out the design together', body: 'Tailor and client mark up the same sketch, line by line, so changes are settled in one place.' },
  { number: '09', src: '/product2/drapeon_ios_09.png', alt: 'Tailor shop screen showing 14 pieces sold this month, shipping to 5 countries, and live listings with sizes and naira prices', title: 'Sell ready-made pieces worldwide', body: 'List finished pieces with sizes and stock, then track what sold and where it shipped.' },
] as const

/** How long each step stays open before the next one takes over. */
const STEP_DURATION_MS = 4000

// 44px targets, per the icon-button minimum in docs/design-foundation.md.
const controlClassName =
  'size-11 rounded-full border border-white/18 bg-black/20 text-white backdrop-blur hover:bg-white/10 hover:text-white focus-visible:ring-white/70 focus-visible:ring-offset-0'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

// The server cannot know the preference. Rendering as if motion is allowed is
// safe because the tour stays paused until it scrolls into view, which only
// happens after hydration has swapped in the real value.
function readReducedMotionOnServer(): boolean {
  return false
}

export function ProductStoryShowcase(): React.JSX.Element {
  const tourRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Only screens that are open, next in line, or being pointed at are mounted,
  // so each crossfade lands on a loaded image without fetching all eight.
  const [mountedScreens, setMountedScreens] = useState<ReadonlySet<number>>(() => new Set([0, 1]))
  const [inView, setInView] = useState(false)
  const [pointerInside, setPointerInside] = useState(false)
  const [keyboardFocusInside, setKeyboardFocusInside] = useState(false)
  const [pausedByViewer, setPausedByViewer] = useState(false)
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    readReducedMotion,
    readReducedMotionOnServer,
  )

  // Under reduced motion, globals.css shortens every animation to 0.01ms, so
  // an animation-driven timer would race through all eight steps. Autoplay is
  // switched off entirely instead and the list becomes a manual accordion.
  const autoplay = !reducedMotion
  const running = autoplay && inView && !pointerInside && !keyboardFocusInside && !pausedByViewer
  const previousIndex = (activeIndex - 1 + stories.length) % stories.length
  const nextIndex = (activeIndex + 1) % stories.length

  useEffect(() => {
    const tour = tourRef.current
    if (!tour || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.3 },
    )
    observer.observe(tour)
    return () => observer.disconnect()
  }, [])

  function prepareScreen(index: number): void {
    setMountedScreens((current) => (current.has(index) ? current : new Set([...current, index])))
  }

  function openStep(index: number): void {
    const upcoming = (index + 1) % stories.length
    setActiveIndex(index)
    setMountedScreens((current) =>
      current.has(index) && current.has(upcoming) ? current : new Set([...current, index, upcoming]),
    )
  }

  function handleStepElapsed(event: AnimationEvent<HTMLSpanElement>): void {
    if (event.target !== event.currentTarget) return
    openStep(nextIndex)
  }

  // Pause while a mouse rests on the tour so the open step can be read. Touch
  // pointers are ignored: they never send a matching leave event.
  function handlePointerEnter(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse') setPointerInside(true)
  }

  function handlePointerLeave(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse') setPointerInside(false)
  }

  // Keyboard focus pauses the tour so the open step cannot move away from
  // someone tabbing through it. Mouse clicks also focus a button, but are not
  // :focus-visible, so clicking a step leaves autoplay running from there.
  function handleFocus(event: FocusEvent<HTMLDivElement>): void {
    setKeyboardFocusInside(event.target.matches(':focus-visible'))
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocusInside(false)
  }

  return (
    <section id="product" className="scroll-mt-4 overflow-hidden bg-illustration-frame-canvas py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-8">
        <div className="grid gap-7 border-b border-white/12 pb-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-illustration-highlight-muted">The product, in view</p>
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] text-white sm:text-6xl">Nine moments. One connected experience.</h2>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-xl text-base leading-7 text-white/64">See the app from both sides—how customers find, measure, sketch, and pay, and how tailors run the work.</p>
            <Link href="/how-it-works" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/8">
              Follow the full journey <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>
        </div>

        <div
          ref={tourRef}
          className="mt-10 grid gap-10 lg:mt-14 lg:grid-cols-2 lg:items-center lg:gap-16"
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onFocus={handleFocus}
          onBlur={handleBlur}
        >
          <ol className="order-2 border-b border-white/12 lg:order-1">
            {stories.map((story, index) => {
              const isActive = index === activeIndex
              const triggerId = `product-story-trigger-${story.number}`
              const panelId = `product-story-panel-${story.number}`

              return (
                <li key={story.number}>
                  {/* The divider doubles as the open step's countdown. */}
                  <span aria-hidden="true" className="block h-px overflow-hidden bg-white/12">
                    {isActive ? (
                      <span
                        className={`block h-full origin-left bg-illustration-highlight-muted ${autoplay ? 'story-progress' : ''}`}
                        style={autoplay ? { animationDuration: `${STEP_DURATION_MS}ms`, animationPlayState: running ? 'running' : 'paused' } : undefined}
                        onAnimationEnd={autoplay ? handleStepElapsed : undefined}
                      />
                    ) : null}
                  </span>

                  <h3>
                    <button
                      id={triggerId}
                      type="button"
                      aria-expanded={isActive}
                      aria-controls={panelId}
                      onClick={() => {
                        if (!isActive) openStep(index)
                      }}
                      onPointerEnter={() => prepareScreen(index)}
                      onFocus={() => prepareScreen(index)}
                      className="group flex w-full cursor-pointer items-baseline gap-4 py-4 text-left focus-visible:outline-white sm:py-5"
                    >
                      <span className={`w-7 shrink-0 text-xs font-semibold tabular-nums transition-colors duration-300 ${isActive ? 'text-illustration-highlight-muted' : 'text-white/30'}`}>
                        {story.number}
                      </span>
                      <span className={`text-xl leading-snug transition-colors duration-300 sm:text-2xl ${isActive ? 'text-white' : 'text-white/42 group-hover:text-white/72'}`}>
                        {story.title}
                      </span>
                    </button>
                  </h3>

                  {/* Animating grid rows between 0fr and 1fr opens the panel to its natural height. */}
                  <div
                    id={panelId}
                    inert={!isActive}
                    className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isActive ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className="max-w-md pb-6 pl-11 text-sm leading-7 text-white/62 sm:text-[0.95rem]">{story.body}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          <div className="relative order-1 flex flex-col items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-illustration-frame-surface px-6 py-10 sm:py-12 lg:order-2">
            {/*
              Each screenshot already draws its own phone, bezel and status bar,
              so the image sits in a plain card: wrapping it in a device frame
              would show a phone inside a phone.
            */}
            <div className="relative aspect-[1290/2796] w-[176px] rounded-[1.75rem] shadow-[0_32px_90px_rgba(0,0,0,0.45)] sm:w-[212px] lg:w-[256px]">
              <div className="relative size-full overflow-hidden rounded-[1.75rem] bg-white/[0.06] ring-1 ring-white/12">
                {stories.map((story, index) => {
                  if (!mountedScreens.has(index)) return null
                  const isActive = index === activeIndex
                  return (
                    // The incoming screen fades in on top while the outgoing one
                    // holds full opacity underneath, then drops out once covered,
                    // so the crossfade never dips to the dark frame.
                    <Image
                      key={story.src}
                      src={story.src}
                      alt={isActive ? story.alt : ''}
                      fill
                      sizes="(min-width: 1024px) 256px, (min-width: 640px) 212px, 176px"
                      className={`object-cover object-top transition-opacity ease-out ${isActive ? 'z-10 opacity-100 duration-700' : 'z-0 opacity-0 delay-700 duration-0'}`}
                    />
                  )
                })}
              </div>
            </div>

            <div className="mt-7 flex items-center gap-3">
              <IconButton
                label={`Previous step: ${stories[previousIndex]?.title ?? ''}`}
                variant="ghost"
                onClick={() => openStep(previousIndex)}
                onPointerEnter={() => prepareScreen(previousIndex)}
                onFocus={() => prepareScreen(previousIndex)}
                className={controlClassName}
              >
                <ArrowLeft aria-hidden="true" />
              </IconButton>
              {autoplay ? (
                <IconButton
                  label={pausedByViewer ? 'Resume the product tour' : 'Pause the product tour'}
                  variant="ghost"
                  onClick={() => setPausedByViewer((paused) => !paused)}
                  className={controlClassName}
                >
                  {pausedByViewer ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                </IconButton>
              ) : null}
              <IconButton
                label={`Next step: ${stories[nextIndex]?.title ?? ''}`}
                variant="ghost"
                onClick={() => openStep(nextIndex)}
                onPointerEnter={() => prepareScreen(nextIndex)}
                onFocus={() => prepareScreen(nextIndex)}
                className={controlClassName}
              >
                <ArrowRight aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
