'use client'

import { GuideMessageCards } from '../user-education/guide-messages'
import { parseGuideReferences } from '@drape/shared/guide-library'

import {
  buildGoogleCalendarEventUrl,
  callSchedulingReasonFor,
  formatCallCountdown,
  getCallLifecycleState,
  isVideoMediaUrl,
  videoPosterFrameUrl,
} from '@drape/shared'
import { CalendarDays, Pause, Play, Reply, Video, Volume2, VolumeX, X } from 'lucide-react'
import type { Route } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../../components/ui/button'
import { IconButton } from '../../../components/ui/icon-button'
import { MediaViewerDialog } from '../../../components/ui/media-viewer-dialog'
import { safeUserText } from '../../../lib/safe-display'
import type {
  AccountMessage,
  AccountMessageReaction,
  AccountOrderQuote,
} from '../shared/account-data-contracts'

import { createMessageMediaSignedUrl, formatDateTime, safeMediaUrl } from './message-core-helpers'
export * from './message-core-helpers'

export type MutedVideoProps = {
  src: string
  className?: string
  ariaLabel?: string
  loop?: boolean
  autoPlay?: boolean
  controls?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  showMuteToggle?: boolean
}

export function MutedVideo({
  src,
  className,
  ariaLabel,
  loop = true,
  autoPlay = true,
  controls = false,
  preload = 'metadata',
  showMuteToggle,
}: MutedVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const shouldShowMuteToggle = showMuteToggle ?? controls
  const playbackSrc = isVideoMediaUrl(src) ? videoPosterFrameUrl(src) : src

  useEffect(() => {
    const node = videoRef.current
    if (!node) return
    node.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    const node = videoRef.current
    return () => {
      if (!node) return
      node.pause()
      node.removeAttribute('src')
      node.load()
    }
  }, [playbackSrc])

  useEffect(() => {
    function pauseWhenHidden() {
      if (document.visibilityState === 'hidden') videoRef.current?.pause()
    }

    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [])

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        // `preload="metadata"` loads dimensions but paints nothing, so a
        // portfolio video showed as a black tile. Seeking to 0.1s with a media
        // fragment makes the browser decode and paint that frame as a poster.
        // Fragments stay client-side, so signed URLs are unaffected.
        src={autoPlay ? playbackSrc : `${playbackSrc}#t=0.1`}
        muted={isMuted}
        loop={loop}
        playsInline={true}
        autoPlay={autoPlay}
        controls={controls}
        preload={preload}
        className={className}
        aria-label={ariaLabel}
      />
      {shouldShowMuteToggle ? (
        <button
          type="button"
          onClick={() => setIsMuted((value) => !value)}
          className="absolute bottom-3 right-3 z-10 rounded-full bg-black/58 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/72"
          aria-label={isMuted ? 'Unmute video' : 'Mute video'}
        >
          {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      ) : null}
    </div>
  )
}

export function MediaViewerOverlay({
  src,
  label,
  video = false,
  onClose,
}: {
  src: string
  label: string
  video?: boolean
  onClose: () => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/88 p-3 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 grid size-11 place-items-center rounded-full bg-white text-ink shadow-xl"
        aria-label="Close media viewer"
      >
        <X className="size-5" />
      </button>
      <div
        className="relative h-full max-h-[92vh] w-full max-w-6xl"
        onClick={(event) => event.stopPropagation()}
      >
        {video ? (
          <video
            src={src}
            controls
            playsInline
            autoPlay
            className="h-full w-full rounded-[8px] bg-black object-contain"
            aria-label={label}
          />
        ) : (
          <Image src={src} alt={label} fill sizes="100vw" className="object-contain" unoptimized />
        )}
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-[8px] border border-ui-border bg-white p-6 shadow-sm">
      <h2 className="text-2xl text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/66">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ActionNotice({ error, success }: { error: string | null; success: string | null }) {
  if (!error && !success) return null
  return (
    <p
      // Without a live role these never reached assistive technology — the
      // message appeared on screen and nowhere else.
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      className={`rounded-[8px] px-4 py-3 text-sm leading-6 ${error ? 'border border-rust/20 bg-rust/8 text-rust-700' : 'border border-needle/14 bg-needle/8 text-needle'}`}
    >
      {error || success}
    </p>
  )
}

export function DisclosurePanel({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string
  summary?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[8px] border border-ink/8 bg-white/84 shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:hidden">
        <span>
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {summary ? (
            <span className="mt-1 block text-xs leading-5 text-ink/56">{summary}</span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-needle group-open:hidden">
          Show
        </span>
        <span className="hidden shrink-0 rounded-full border border-ink/8 bg-white px-3 py-1 text-xs font-semibold text-ink/52 group-open:inline-flex">
          Hide
        </span>
      </summary>
      <div className="border-t border-ink/6 px-4 py-4">{children}</div>
    </details>
  )
}

export function activeQuoteForOrder(quotes: AccountOrderQuote[], orderId: string) {
  return quotes.find((quote) => quote.order_id === orderId && quote.status === 'ACTIVE') ?? null
}

export function useMessageMediaUrl(raw: string | null | undefined): string | null {
  const immediate = useMemo(() => safeMediaUrl(raw) ?? null, [raw])
  const storagePath = useMemo(() => {
    if (!raw || immediate) return null
    if (raw.startsWith('messages/')) return raw
    if (raw.startsWith('message-media/')) return raw.replace(/^message-media\//, '')
    return null
  }, [immediate, raw])
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!storagePath) return undefined
    let cancelled = false
    void createMessageMediaSignedUrl(storagePath).then((url) => {
      if (!cancelled) setSigned({ path: storagePath, url })
    })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (immediate) return immediate
  if (!storagePath) return null
  return signed?.path === storagePath ? signed.url : null
}

export function messageMediaStoragePath(raw: string | null | undefined) {
  if (!raw) return null
  if (raw.startsWith('messages/')) return raw
  if (raw.startsWith('message-media/')) return raw.replace(/^message-media\//, '')
  return null
}

export function useMessageMediaUrls(messages: AccountMessage[]) {
  const sourceKey = messages.map((message) => message.photo_url ?? '').join('|')
  const [resolved, setResolved] = useState<{ key: string; urls: Array<string | null> } | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      messages.map(async (message) => {
        const immediate = safeMediaUrl(message.photo_url)
        if (immediate) return immediate
        const storagePath = messageMediaStoragePath(message.photo_url)
        return storagePath ? createMessageMediaSignedUrl(storagePath) : null
      })
    ).then((urls) => {
      if (!cancelled) setResolved({ key: sourceKey, urls })
    })
    return () => {
      cancelled = true
    }
  }, [messages, sourceKey])

  return resolved?.key === sourceKey ? resolved.urls : messages.map(() => null)
}

export function voicePlaybackMimeType(raw: string | null | undefined, fallback?: string | null) {
  const normalizedFallback = fallback?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalizedFallback === 'audio/m4a' || normalizedFallback === 'audio/x-m4a') return 'audio/mp4'
  if (normalizedFallback.startsWith('audio/')) return normalizedFallback

  const source = (raw ?? '').split('?')[0]?.toLowerCase() ?? ''
  if (/\.(m4a|mp4)$/u.test(source)) return 'audio/mp4'
  if (/\.aac$/u.test(source)) return 'audio/aac'
  if (/\.webm$/u.test(source)) return 'audio/webm'
  if (/\.ogg$/u.test(source)) return 'audio/ogg'
  if (/\.wav$/u.test(source)) return 'audio/wav'
  return 'audio/mp4'
}

export async function recordedAudioDurationSeconds(blob: Blob, fallbackSeconds: number) {
  try {
    const audioContext = new AudioContext()
    try {
      const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer())
      if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
        return Math.max(1, Math.round(decoded.duration))
      }
    } finally {
      await audioContext.close().catch(() => undefined)
    }
  } catch {
    // Some Safari/managed-browser combinations cannot decode a fresh recorder blob here.
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const duration = await new Promise<number | null>((resolve) => {
      const audio = new Audio()
      let settled = false
      const finish = (value: number | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        audio.onloadedmetadata = null
        audio.onerror = null
        audio.removeAttribute('src')
        audio.load()
        resolve(value)
      }
      const timeout = window.setTimeout(() => finish(null), 3_000)
      audio.preload = 'metadata'
      audio.onloadedmetadata = () =>
        finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null)
      audio.onerror = () => finish(null)
      audio.src = objectUrl
    })
    return Math.max(1, Math.round(duration ?? fallbackSeconds))
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function useMessageVoicePlayback(raw: string | null | undefined) {
  const signedUrl = useMessageMediaUrl(raw)
  const [playback, setPlayback] = useState<{
    source: string
    url: string
    mimeType: string
  } | null>(null)

  useEffect(() => {
    if (!signedUrl) return undefined

    const controller = new AbortController()
    let objectUrl: string | null = null
    void fetch(signedUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Voice note could not load.')
        const sourceBlob = await response.blob()
        const mimeType = voicePlaybackMimeType(raw, sourceBlob.type)
        const playbackBlob =
          sourceBlob.type === mimeType ? sourceBlob : new Blob([sourceBlob], { type: mimeType })
        objectUrl = URL.createObjectURL(playbackBlob)
        setPlayback({ source: signedUrl, url: objectUrl, mimeType })
      })
      .catch((playbackError) => {
        if (playbackError instanceof DOMException && playbackError.name === 'AbortError') return
        setPlayback({ source: signedUrl, url: signedUrl, mimeType: voicePlaybackMimeType(raw) })
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [raw, signedUrl])

  if (!signedUrl)
    return { url: null, fallbackUrl: null, mimeType: voicePlaybackMimeType(raw), loading: true }
  if (playback?.source !== signedUrl) {
    return {
      url: null,
      fallbackUrl: signedUrl,
      mimeType: voicePlaybackMimeType(raw),
      loading: true,
    }
  }
  return { ...playback, fallbackUrl: signedUrl, loading: false }
}

export function VoiceMessagePlayer({ raw }: { raw: string | null | undefined }) {
  const playback = useMessageVoicePlayback(raw)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  function formatPlaybackTime(seconds: number) {
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
    const minutes = Math.floor(safeSeconds / 60)
    return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`
  }

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || failedSource === playback.url) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    try {
      await audio.play()
    } catch {
      setFailedSource(playback.url)
    }
  }

  function cyclePlaybackRate() {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1
    setPlaybackRate(nextRate)
    if (audioRef.current) audioRef.current.playbackRate = nextRate
  }

  if (playback.loading || !playback.url) {
    return (
      <div
        className="h-12 w-full animate-pulse rounded-[8px] bg-ink/8"
        aria-label="Loading voice note"
      />
    )
  }
  const failed = failedSource === playback.url

  return (
    <div className="grid w-full min-w-0 gap-2">
      <audio
        key={playback.url}
        ref={audioRef}
        src={playback.url}
        preload="metadata"
        className="hidden"
        muted={muted}
        onLoadStart={() => {
          setPlaying(false)
          setCurrentTime(0)
          setDuration(0)
          setFailedSource(null)
        }}
        onLoadedMetadata={(event) =>
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0
          )
        }
        onDurationChange={(event) =>
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0
          )
        }
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        onCanPlay={() => setFailedSource(null)}
        onError={() => setFailedSource(playback.url)}
      />
      {!failed ? (
        <div className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-[8px] border border-current/10 bg-current/[0.045] px-2.5 py-2">
          <button
            type="button"
            onClick={() => {
              void togglePlayback()
            }}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-current/10 transition hover:bg-current/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
            aria-label={playing ? 'Pause voice note' : 'Play voice note'}
          >
            {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
          </button>
          <div className="grid min-w-0 flex-1 gap-1">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.1}
              value={Math.min(currentTime, duration > 0 ? duration : 1)}
              onChange={(event) => {
                const nextTime = Number(event.target.value)
                setCurrentTime(nextTime)
                if (audioRef.current) audioRef.current.currentTime = nextTime
              }}
              className="h-1.5 w-full cursor-pointer accent-current"
              aria-label="Voice note position"
            />
            <div className="flex items-center justify-between gap-2 text-[0.68rem] font-medium opacity-65">
              <span>
                {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
              </span>
              <span>Voice note</span>
            </div>
          </div>
          <button
            type="button"
            onClick={cyclePlaybackRate}
            className="min-w-9 shrink-0 rounded-[6px] px-1.5 py-1 text-xs font-semibold transition hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
            aria-label={`Playback speed ${playbackRate} times`}
          >
            {playbackRate}x
          </button>
          <button
            type="button"
            onClick={() => setMuted((current) => !current)}
            className="grid size-8 shrink-0 place-items-center rounded-[6px] transition hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
            aria-label={muted ? 'Unmute voice note' : 'Mute voice note'}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      ) : null}
      {failed ? (
        <p className="rounded-[8px] border border-rust/20 bg-rust/6 px-3 py-2 text-xs leading-5 text-rust">
          This legacy voice note cannot be decoded by this browser.{' '}
          {playback.fallbackUrl ? (
            <a
              href={playback.fallbackUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline"
            >
              Open the original audio
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

export function MessageContent({
  message,
  compact = false,
  returnTo = '/account/messages',
}: {
  message: AccountMessage
  compact?: boolean
  returnTo?: string
}) {
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const hasVoiceAttachment = Boolean(message.voice_url)
  const rawText = safeUserText(message.body, '')
  const visibleText = parseGuideReferences(rawText).reduce((text, reference) => text.replace(reference.token, ''), rawText).trim()
  const text = hasVoiceAttachment && /^\d+(?:\.\d+)?$/u.test(rawText) ? '' : visibleText
  const hasVideoAttachment = isVideoMediaUrl(photoUrl)

  return (
    <div className="grid min-w-0 gap-2.5">
      {text ? (
        <p
          className={`${compact ? 'line-clamp-3' : ''} whitespace-pre-wrap break-words text-xs leading-4 text-ink/72`}
        >
          {text}
        </p>
      ) : null}
      <GuideMessageCards body={rawText} returnTo={returnTo} />
      {photoUrl && hasVideoAttachment ? (
        <MediaViewerDialog src={photoUrl} kind="video" title="Video attachment">
          <button
            type="button"
            className="group/media relative block w-full cursor-pointer overflow-hidden rounded-[8px] border border-ink/10 bg-ink text-left"
          >
            <MutedVideo
              src={photoUrl}
              autoPlay={false}
              loop={false}
              controls={false}
              className="aspect-video max-h-72 w-full object-cover"
              ariaLabel="Open video attachment"
              showMuteToggle={false}
            />
            <span className="absolute inset-0 grid place-items-center bg-black/12 transition-colors group-hover/media:bg-black/22">
              <span className="grid size-11 place-items-center rounded-full bg-white/92 text-ink shadow-md">
                <Video className="size-5" />
              </span>
            </span>
          </button>
        </MediaViewerDialog>
      ) : photoUrl ? (
        <MediaViewerDialog src={photoUrl} kind="image" title="Photo attachment">
          <button
            type="button"
            className="group/media block w-full cursor-zoom-in overflow-hidden rounded-[8px] border border-ink/10 bg-white text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt="Order message attachment"
              className="max-h-72 w-full object-cover transition-opacity group-hover/media:opacity-90"
            />
          </button>
        </MediaViewerDialog>
      ) : null}
      {hasVoiceAttachment ? <VoiceMessagePlayer raw={message.voice_url} /> : null}
    </div>
  )
}

export function MessageMediaMosaic({
  messages,
  onReply,
}: {
  messages: AccountMessage[]
  onReply: (message: AccountMessage) => void
}) {
  const urls = useMessageMediaUrls(messages)
  const gallery = messages.flatMap((message, index) => {
    const src = urls[index]
    return src
      ? [
          {
            src,
            kind: isVideoMediaUrl(src) ? ('video' as const) : ('image' as const),
            title: `Attachment ${index + 1} of ${messages.length}`,
          },
        ]
      : []
  })
  const visible = messages.slice(0, 4)
  const count = messages.length
  const gridClass = count === 1 ? 'grid-cols-1' : 'grid-cols-2'

  return (
    <div className={`grid min-h-40 overflow-hidden rounded-[8px] bg-black/8 ${gridClass} gap-1`}>
      {visible.map((message, index) => {
        const src = urls[index]
        const galleryIndex = src ? gallery.findIndex((item) => item.src === src) : 0
        const extra = index === 3 ? Math.max(0, count - 4) : 0
        const tallFirst = count === 3 && index === 0
        const kind = src && isVideoMediaUrl(src) ? ('video' as const) : ('image' as const)

        if (!src) {
          return (
            <div
              key={message.id}
              className={`${tallFirst ? 'row-span-2' : ''} min-h-36 animate-pulse bg-ink/8`}
              aria-label="Loading attachment"
            />
          )
        }

        return (
          <MediaViewerDialog
            key={message.id}
            src={src}
            kind={kind}
            title={`Attachment ${index + 1}`}
            items={gallery}
            initialIndex={Math.max(galleryIndex, 0)}
          >
            <div
              role="button"
              tabIndex={0}
              aria-label={`Open attachment ${index + 1} of ${count}`}
              className={`group/tile relative min-h-36 cursor-zoom-in overflow-hidden bg-black ${tallFirst ? 'row-span-2' : ''}`}
            >
              {kind === 'video' ? (
                <video
                  src={src}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full min-h-36 w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Message attachment ${index + 1}`}
                  className="h-full min-h-36 w-full object-cover"
                />
              )}
              {kind === 'video' ? (
                <span className="absolute inset-0 grid place-items-center bg-black/10">
                  <span className="grid size-10 place-items-center rounded-full bg-white/92 text-ink shadow">
                    <Video className="size-4" />
                  </span>
                </span>
              ) : null}
              <IconButton
                type="button"
                size="icon-sm"
                variant="secondary"
                label={`Reply to attachment ${index + 1}`}
                className="absolute right-2 top-2 z-10 opacity-0 shadow-md transition-opacity group-hover/tile:opacity-100 group-focus-within/tile:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  onReply(message)
                }}
              >
                <Reply />
              </IconButton>
              {extra > 0 ? (
                <span className="absolute inset-0 grid place-items-center bg-black/58 text-xl font-bold text-white">
                  +{extra}
                </span>
              ) : null}
            </div>
          </MediaViewerDialog>
        )
      })}
    </div>
  )
}

export const MESSAGE_REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '🙏'] as const

export function MessageReactionBar({
  reactions,
  userId,
  mine,
  open,
  onOpenChange,
  onToggle,
}: {
  reactions: AccountMessageReaction[]
  userId: string | null
  mine: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (emoji: string) => void
}) {
  const counts = MESSAGE_REACTION_OPTIONS.map((emoji) => {
    const matching = reactions.filter((reaction) => reaction.emoji === emoji)
    return {
      emoji,
      count: matching.length,
      selected: Boolean(userId && matching.some((reaction) => reaction.user_id === userId)),
    }
  })
  const visibleCounts = counts.filter(({ count }) => count > 0)

  return (
    <div className="relative mr-auto flex items-center gap-1">
      {visibleCounts.map(({ emoji, count, selected }) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={
            selected
              ? mine
                ? 'rounded-full bg-white/22 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white'
                : 'rounded-full bg-needle/12 px-1.5 py-0.5 text-[0.65rem] font-semibold text-needle'
              : mine
                ? 'rounded-full bg-white/12 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white/78 transition hover:bg-white/22'
                : 'rounded-full bg-ink/5 px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink/64 transition hover:bg-needle/10 hover:text-needle'
          }
          aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
        >
          <span aria-hidden="true">{emoji}</span>
          <span className="ml-1">{count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={
          mine
            ? 'rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold text-white/48 transition hover:bg-white/12 hover:text-white'
            : 'rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold text-ink/36 transition hover:bg-ink/5 hover:text-ink'
        }
        aria-expanded={open}
        aria-label={open ? 'Hide reactions' : 'React to message'}
      >
        +
      </button>
      {open ? (
        <div
          className={`absolute bottom-full z-20 mb-1 flex gap-1 rounded-full border border-ink/8 bg-white p-1 shadow-lg ${mine ? 'right-0' : 'left-0'}`}
        >
          {counts.map(({ emoji, count, selected }) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggle(emoji)
                onOpenChange(false)
              }}
              className={`rounded-full px-2 py-1 text-sm transition ${selected ? 'bg-needle/12 text-needle' : 'text-ink/64 hover:bg-ink/5 hover:text-ink'}`}
              aria-pressed={selected}
              aria-label={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
            >
              <span aria-hidden="true">{emoji}</span>
              {count > 0 ? <span className="ml-1 text-xs font-semibold">{count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export type WebCallLifecycleEvent = {
  kind: 'consultation' | 'ready-made'
  scheduledStartAt?: string | null
  timezone?: string | null
  reason?: string | null
  status?: string | null
  paymentRequired?: boolean
  paymentPaid?: boolean
  actionLoading?: boolean
  onJoinVideo?: () => void
  joinHref?: Route
  callType?: 'audio' | 'video'
  onReschedule?: () => void
  rescheduleLabel?: string
  rescheduleHref?: Route
  paymentActionLabel?: string | null
  paymentHref?: Route
}

export function CallLifecycleEventCard({
  event,
  compact = false,
}: {
  event: WebCallLifecycleEvent
  compact?: boolean
}) {
  const [now, setNow] = useState(0)

  useEffect(() => {
    const updateNow = () => setNow(Date.now())
    const bootTimer = window.setTimeout(updateNow, 0)
    const timer = window.setInterval(updateNow, 30_000)
    return () => {
      window.clearTimeout(bootTimer)
      window.clearInterval(timer)
    }
  }, [])

  const lifecycle = getCallLifecycleState(event.scheduledStartAt, now)
  if (lifecycle.status === 'unscheduled') return null

  const reason =
    event.kind === 'consultation' ? 'Consultation' : callSchedulingReasonFor(event.reason).label
  const title = event.kind === 'consultation' ? 'Consultation call' : 'Ready-made coordination call'
  const scheduledLabel =
    formatDateTime(event.scheduledStartAt ?? null, event.timezone) ?? 'Time not set'
  const isPaymentBlocked = event.paymentRequired === true && event.paymentPaid !== true
  const isExpired =
    event.status === 'EXPIRED' ||
    event.status === 'DECLINED' ||
    event.status === 'COMPLETED' ||
    lifecycle.status === 'expired'
  const calendarUrl = event.scheduledStartAt
    ? buildGoogleCalendarEventUrl({
        startsAt: event.scheduledStartAt,
        durationMinutes: 30,
        title: `Drapeon — ${title}`,
        description: `${reason}. Open Drapeon near the scheduled time to start or join the protected call.`,
      })
    : null

  if (compact) {
    const statusLabel = isPaymentBlocked
      ? 'Payment required'
      : isExpired
        ? 'Window ended'
        : lifecycle.status === 'active'
          ? 'Open now'
          : formatCallCountdown(lifecycle.msUntilOpen)

    return (
      <div
        className={`mb-2 flex flex-wrap items-center gap-2 rounded-[8px] border px-3 py-2 ${isExpired ? 'border-ink/8 bg-bone/65' : 'border-needle/14 bg-white'}`}
      >
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full ${isExpired ? 'bg-ink/8 text-ink/44' : 'bg-needle/10 text-needle'}`}
        >
          <Video className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-[10rem] flex-1">
          <p className="truncate text-xs font-semibold text-ink">{title}</p>
          <p className="truncate text-[0.68rem] text-ink/48">{scheduledLabel}</p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-[0.65rem] font-semibold ${lifecycle.status === 'active' && !isPaymentBlocked && !isExpired ? 'bg-needle/10 text-needle' : 'bg-ink/6 text-ink/54'}`}
        >
          {statusLabel}
        </span>
        {isPaymentBlocked && event.paymentHref && event.paymentActionLabel ? (
          <Link href={event.paymentHref} className="text-xs font-semibold text-needle">
            {event.paymentActionLabel}
          </Link>
        ) : isExpired && event.rescheduleHref ? (
          <Link href={event.rescheduleHref} className="text-xs font-semibold text-needle">
            {event.rescheduleLabel ?? 'Reschedule'}
          </Link>
        ) : lifecycle.status === 'active' && event.joinHref ? (
          <Link
            href={event.joinHref}
            className="inline-flex min-h-8 items-center justify-center rounded-full bg-needle px-3 text-xs font-semibold text-white transition-colors hover:bg-needle/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle focus-visible:ring-offset-2"
          >
            Join call
          </Link>
        ) : lifecycle.status === 'active' && event.onJoinVideo ? (
          <button
            type="button"
            onClick={event.onJoinVideo}
            disabled={event.actionLoading}
            className="inline-flex min-h-8 items-center justify-center rounded-full bg-needle px-3 text-xs font-semibold text-white transition-colors hover:bg-needle/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {event.actionLoading ? 'Opening…' : 'Join call'}
          </button>
        ) : null}
        {!isExpired && calendarUrl ? (
          <a
            href={calendarUrl}
            target="_blank"
            rel="noreferrer"
            title="Add consultation to calendar"
            aria-label="Add consultation to calendar"
            className="grid size-8 place-items-center rounded-full text-needle transition hover:bg-needle/8"
          >
            <CalendarDays className="size-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={`mb-3 grid gap-3 rounded-[8px] border p-3 shadow-sm ${isExpired ? 'border-ink/8 bg-bone/65' : 'border-needle/14 bg-white'}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isExpired ? 'bg-ink/8 text-ink/44' : 'bg-needle/10 text-needle'}`}
        >
          <Video className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-needle">
            Order lifecycle event
          </p>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs leading-5 text-ink/54">{scheduledLabel}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink/8 pt-2 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-ink/42">Reason</span>
        <span className="text-right font-semibold text-ink">{reason}</span>
      </div>

      {isPaymentBlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-rust/16 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
          <span className="font-semibold">Consultation fee required before the room can open</span>
          {event.paymentHref && event.paymentActionLabel ? (
            <Link href={event.paymentHref} className="font-semibold text-needle">
              {event.paymentActionLabel}
            </Link>
          ) : null}
        </div>
      ) : isExpired ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-ink/6 px-3 py-2 text-xs leading-5 text-ink/54">
          <span className="font-semibold">Call Missed / Window Expired</span>
          {event.rescheduleHref ? (
            <Link href={event.rescheduleHref} className="font-semibold text-needle">
              {event.rescheduleLabel ?? 'Reschedule'}
            </Link>
          ) : event.onReschedule ? (
            <button
              type="button"
              onClick={event.onReschedule}
              className="font-semibold text-needle"
            >
              {event.rescheduleLabel ?? 'Reschedule'}
            </button>
          ) : null}
        </div>
      ) : lifecycle.status === 'active' ? (
        event.joinHref ? (
          <Button asChild>
            <Link href={event.joinHref}>
              Open {event.callType === 'audio' ? 'Audio' : 'Video'} Call
            </Link>
          </Button>
        ) : (
          <Button onClick={event.onJoinVideo} disabled={event.actionLoading || !event.onJoinVideo}>
            {event.actionLoading
              ? 'Opening...'
              : `Join ${event.callType === 'audio' ? 'Audio' : 'Video'} Call Now`}
          </Button>
        )
      ) : (
        <Button disabled variant="secondary">
          {formatCallCountdown(lifecycle.msUntilOpen)}
        </Button>
      )}

      {!isExpired && calendarUrl ? (
        <a
          href={calendarUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-2 justify-self-start px-1 text-xs font-semibold text-needle"
        >
          <CalendarDays className="size-4" aria-hidden="true" />
          Add to calendar
        </a>
      ) : null}
    </div>
  )
}
