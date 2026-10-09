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

const stories = [
  { number: '01', src: '/product/01-explore-tailors.jpg', alt: 'Drapeon mobile Explore screen showing verified independent tailors and an active order', title: 'Find the right tailor', body: 'Explore real work, return to active orders, and keep the next step in view.' },
  { number: '02', src: '/product/02-verified-profile.jpg', alt: 'Drapeon mobile screen showing a verified tailor profile and portfolio', title: 'See the person behind the work', body: 'Compare specialties, portfolio proof, location, reviews, and live availability.' },
  { number: '03', src: '/product/03-drapeon-vision.jpg', alt: 'Drapeon Vision mobile screen showing guided fit profile options', title: 'Build a fit profile', body: 'Use guided camera measurements or enter details manually—the final choice stays yours.' },
  { number: '04', src: '/product/04-saved-measurements.jpg', alt: 'Drapeon mobile screen showing saved clothing measurements', title: 'Reuse measurements with control', body: 'Review saved fit details and choose exactly when they are attached to an order.' },
  { number: '05', src: '/product/05-protected-quote.jpg', alt: 'Drapeon mobile quote screen showing construction, fabric allowance, tax, timing, and payment protection', title: 'Approve one clear quote', body: 'See construction, fabric, tax, timing, and protection before money moves.' },
  { number: '06', src: '/product/06-order-conversation.jpg', alt: 'Drapeon order conversation showing customer and tailor decisions in one thread', title: 'Keep decisions with the order', body: 'Messages, references, approvals, and voice notes stay attached to the right project.' },
  { number: '07', src: '/product/07-coordination-call.jpg', alt: 'Drapeon mobile screen for scheduling an order coordination call', title: 'Talk it through when needed', body: 'Schedule a protected call without losing the written decisions that matter.' },
  { number: '08', src: '/product/08-active-order.jpg', alt: 'Drapeon mobile orders screen showing the current status and action waiting for the customer', title: 'Always know what is next', body: 'Return to the exact order, status, price, and action that needs you.' },
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
            <h2 className="mt-4 max-w-2xl text-4xl leading-[1.02] text-white sm:text-6xl">Eight moments. One connected experience.</h2>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-xl text-base leading-7 text-white/64">Move through the app—from discovery and fit to the conversation, call, quote, and live order.</p>
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
            <div className="relative aspect-[739/1600] w-[176px] rounded-[2.5rem] bg-illustration-camera-surface p-[7px] shadow-[0_32px_90px_rgba(0,0,0,0.45)] ring-1 ring-white/12 sm:w-[212px] lg:w-[256px]">
              <div className="relative size-full overflow-hidden rounded-[2.1rem] bg-illustration-frame-canvas">
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
