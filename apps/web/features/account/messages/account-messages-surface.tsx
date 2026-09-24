'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { Route } from 'next'
import { useRouter, useSearchParams } from 'next/navigation'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive,
  ArchiveRestore,
  Banknote,
  BellRing,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  ClipboardList,
  Languages,
  LoaderCircle,
  MessageSquareText,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Play,
  Reply,
  Ruler,
  Send,
  ShoppingBag,
  SlidersHorizontal,
  Square,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  CALL_SCHEDULING_POLICY,
  FALLBACK_TRANSLATION_LANGUAGES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
  ORDER_EVENT_LABELS,
  QUOTE_REVISION_REASON_LABELS,
  buildGoogleCalendarEventUrl,
  callSchedulingReasonFor,
  conversationClusterPositionForMessage,
  deriveConversationEventPresentation,
  deriveOrderConversationActions,
  formatCallCountdown,
  formatDatabaseEnumLabel,
  formatExplicitZonedDateTime,
  formatRelative,
  getCallLifecycleState,
  groupMessageMediaClusters,
  isCallSchedulingStartValid,
  isVideoMediaUrl,
  languageName,
  parseDateValue,
  parseMoneyInputToMinorUnits,
  parseScheduledOrderCallMessage,
  recommendedSchedulingStartDate,
  translationTargetFromLocale,
  videoPosterFrameUrl,
  voiceRecordingErrorMessage,
  type ConversationTranslationPreference,
  type MessageTranslation,
  type OrderConversationAction,
  type TranslationLanguage,
} from '@drape/shared'
import type { OrderStage } from '@drape/shared/order-machine'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { friendlyActionError } from '@drape/shared/action-errors'
import { createClient } from '../../../lib/supabase'
import { safeEntityName, safeUserText } from '../../../lib/safe-display'
import { useAccountContext } from '../../../components/account-context'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Field } from '../../../components/ui/field'
import { IconButton } from '../../../components/ui/icon-button'
import { Input } from '../../../components/ui/input'
import { MediaViewerDialog } from '../../../components/ui/media-viewer-dialog'
import { StatusChip } from '../../../components/ui/status-chip'
import { Textarea } from '../../../components/ui/textarea'
import {
  invokeAccountFunction,
  isTerminalOrder,
} from '../shared/account-data-queries'
import { QUOTE_NEGOTIATION_UI_ENABLED } from '../shared/account-realtime-config'
import type {
  AccountMessage,
  AccountMessageReaction,
  AccountOrder,
  AccountOrderEvent,
  AccountOrderQuote,
  AccountQuoteRevision,
  ConsultationBookingSnapshot,
  MessagesRenderData,
} from '../shared/account-data-contracts'

export function supportMetaWithConsultationBooking(
  specialNote: string | null | undefined,
  booking: ConsultationBookingSnapshot | null | undefined
) {
  const rawSupportMeta = parseOrderSupportMeta(specialNote)
  if (booking?.status !== 'CONFIRMED' || !booking.scheduled_start_at) return rawSupportMeta
  return {
    ...rawSupportMeta,
    consultation: {
      status: 'SCHEDULED' as const,
      feeAmount: booking.fee_amount,
      feeCurrency: booking.fee_currency,
      paymentTiming:
        booking.fee_mode === 'PAID'
          ? ('BEFORE_CALL_STARTS' as const)
          : ('WAIVED_OR_FREE' as const),
      paidAt: booking.payment_status === 'PAID' ? booking.paid_at : null,
      scheduledStartAt: booking.scheduled_start_at,
      scheduledEndAt: booking.scheduled_end_at,
      callType: booking.call_type === 'AUDIO' ? ('AUDIO' as const) : ('VIDEO' as const),
    },
  }
}

export function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function cleanLabel(value: string | null | undefined, fallback = 'Not set') {
  return formatDatabaseEnumLabel(value, fallback)
}

export function timestampMs(value: string | null | undefined, fallback = 0) {
  return parseDateValue(value)?.getTime() ?? fallback
}

export function formatMessageRelative(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return 'Recently'
  if (date.getTime() > Date.now()) return 'Just now'
  return formatRelative(value)
}

export function orderTitle(order: AccountOrder) {
  return safeUserText(order.item_title || order.garment_type, 'Drapeon order')
}

const ORDER_CALL_STAGES = new Set([
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'DELIVERED',
  'COLLECTED',
])

type OrderSupportMeta = {
  quoteBreakdown?: {
    laborAmount?: number | null
    sourcingAmount?: number | null
    rushAmount?: number | null
    consultationCreditAmount?: number | null
    tailoringAmount?: number | null
    fabricAllowanceAmount?: number | null
    fabricAllowanceCoverage?: string[] | null
    fabricSourcingAssumptions?: string | null
    included?: string[] | null
    excluded?: string[] | null
    summary?: string | null
  } | null
  consultation?: {
    status?: string | null
    requestedBy?: string | null
    feeAmount?: number | null
    feeCurrency?: string | null
    feeCreditable?: boolean | null
    requestNote?: string | null
    requestedAt?: string | null
    requestExpiresAt?: string | null
    proposedStartAt?: string | null
    scheduledStartAt?: string | null
    scheduledEndAt?: string | null
    timezone?: string | null
    paidAt?: string | null
    paymentTiming?: string | null
    reminderStartSentAt?: string | null
    callType?: 'AUDIO' | 'VIDEO' | null
  } | null
  orderCall?: {
    status?: string | null
    reason?: string | null
    scheduledStartAt?: string | null
    scheduledEndAt?: string | null
    timezone?: string | null
    reminderStartSentAt?: string | null
    completedAt?: string | null
  } | null
  styleAlignment?: {
    requiredBeforeCutting?: boolean | null
    status?: string | null
    tailorInterpretation?: string | null
    instruction?: string | null
    customerExpectation?: string | null
    approvalRequestedAt?: string | null
    approvedAt?: string | null
    changeRequestedAt?: string | null
  } | null
  materialIssue?: {
    status?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
    response?: string | null
    responseLabel?: string | null
    responseNote?: string | null
  } | null
  scopeChange?: {
    status?: string | null
    requestedBy?: string | null
    type?: string | null
    typeLabel?: string | null
    summary?: string | null
    impacts?: string[] | null
    priceImpactMinor?: number | null
    deadlineImpact?: string | null
    responseNote?: string | null
  } | null
  cancellationReview?: {
    status?: string | null
    requestedBy?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
  } | null
  deliveryReview?: {
    status?: string | null
    requestedBy?: string | null
    reason?: string | null
    reasonLabel?: string | null
    note?: string | null
  } | null
  dispatchRecord?: {
    bookedAt?: string | null
    premiumException?: boolean | null
  } | null
  fitProfile?: {
    requiresTailorReview?: boolean | null
    tailorMeasurementOverride?: boolean | null
    tailorMeasurementOverrideReason?: string | null
  } | null
  fabricReceivedAt?: string | null
  fabricReceivedNote?: string | null
  fabricHandoffMode?: string | null
  fabricHandoffLabel?: string | null
}

export function parseOrderSupportMeta(value: string | null | undefined): OrderSupportMeta {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as OrderSupportMeta)
      : {}
  } catch {
    return {}
  }
}

export function formatDateTime(value: string | null | undefined, timezone?: string | null) {
  return formatExplicitZonedDateTime(value, { timeZone: timezone })
}

function canStartOrderCall(order: AccountOrder) {
  if (order.stage === 'CONSULTATION') return true
  return ORDER_CALL_STAGES.has(order.stage ?? '')
}

const CUSTOMER_ACTIVE_THREAD_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'IN_DISPUTE',
])

const TAILOR_ACTIVE_THREAD_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'IN_DISPUTE',
])

function isActiveConversationOrder(order: AccountOrder, userId: string | null) {
  const stage = order.stage ?? ''
  if (order.customer_id === userId) return CUSTOMER_ACTIVE_THREAD_STAGES.has(stage)
  return TAILOR_ACTIVE_THREAD_STAGES.has(stage)
}

export function partyName(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    const tailor = firstJoinedRow(order.tailor_profiles)
    return safeEntityName(tailor?.business_name || tailor?.display_name, 'Tailor')
  }
  const customer = firstJoinedRow(order.customer_profiles)
  return safeEntityName(customer?.display_name, 'Customer')
}

function partyAvatar(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    return safeMediaUrl(firstJoinedRow(order.tailor_profiles)?.avatar_url ?? null, 'avatars')
  }
  return safeMediaUrl(firstJoinedRow(order.customer_profiles)?.avatar_url ?? null, 'avatars')
}

function partyKey(order: AccountOrder, userId: string | null): string {
  return order.customer_id === userId
    ? (order.tailor_profile_id ?? order.tailor_id ?? `_${order.id}`)
    : (order.customer_id ?? `_${order.id}`)
}

type PublicMediaBucket = 'avatars' | 'portfolio-photos' | 'seller-item-media' | 'review-media'

const PUBLIC_MEDIA_BUCKETS: PublicMediaBucket[] = [
  'avatars',
  'portfolio-photos',
  'seller-item-media',
  'review-media',
]

const TRUSTED_EXTERNAL_IMAGE_HOSTS = new Set(['images.unsplash.com'])

function isPublicMediaBucket(value: string): value is PublicMediaBucket {
  return PUBLIC_MEDIA_BUCKETS.includes(value as PublicMediaBucket)
}

function runtimeSupabaseUrl() {
  const envUrl =
    process.env.DRAPEON_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (envUrl.trim()) return envUrl.replace(/\/+$/u, '')

  if (typeof window === 'undefined') return ''
  return window.__DRAPEON_PUBLIC_ENV__?.supabaseUrl?.trim().replace(/\/+$/u, '') ?? ''
}

function encodeStoragePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function publicStorageMediaUrl(src: string, fallbackBucket: PublicMediaBucket) {
  const supabaseUrl = runtimeSupabaseUrl()
  if (!supabaseUrl) return null

  const parts = src
    .trim()
    .replace(/^\/+/u, '')
    .replace(/^public\//u, '')
    .split('/')
    .filter(Boolean)

  const first = parts[0] ?? ''
  const bucket = isPublicMediaBucket(first) ? first : fallbackBucket
  const objectParts = isPublicMediaBucket(first) ? parts.slice(1) : parts
  if (objectParts[0] === 'public') objectParts.shift()
  const objectPath = encodeStoragePath(objectParts.join('/'))
  if (!objectPath) return null

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}

export function safeMediaUrl(src: string | null | undefined, bucket?: PublicMediaBucket) {
  if (!src) return null
  const value = src.trim()
  if (!value) return null
  if (value.startsWith('data:') || value.startsWith('blob:')) return value
  if (bucket && !/^(https?:)/iu.test(value)) return publicStorageMediaUrl(value, bucket)
  if (value.startsWith('/')) return value
  try {
    const url = new URL(value)
    const supabaseUrl = runtimeSupabaseUrl()
    const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : ''
    if (
      supabaseHost &&
      url.hostname === supabaseHost &&
      (url.pathname.startsWith('/storage/v1/object/public/') ||
        url.pathname.startsWith('/storage/v1/object/sign/'))
    ) {
      return value
    }
    if (url.protocol === 'https:' && TRUSTED_EXTERNAL_IMAGE_HOSTS.has(url.hostname)) {
      return value
    }
  } catch {
    return null
  }
  return null
}

function initialsForName(value: string | null | undefined) {
  const parts = safeEntityName(value, 'Drapeon').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'D'
  if (parts.length === 1) return (parts[0] ?? 'D').slice(0, 2).toUpperCase()
  return `${parts[0]?.charAt(0) ?? 'D'}${parts[parts.length - 1]?.charAt(0) ?? ''}`.toUpperCase()
}

export function accountRoute(path: string): Route {
  return path as Route
}

export function assertNoContactLeak(value: string, fallback?: string) {
  const filtered = filterContactInfo(value)
  if (filtered.blocked) {
    return fallback ?? filtered.userMessage
  }
  return null
}

export function parseMinorUnits(value: string) {
  return parseMoneyInputToMinorUnits(value)
}

function datetimeLocalToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function dateToDatetimeLocal(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const MESSAGE_MEDIA_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.messageVideo

const MESSAGE_MEDIA_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.messageVideo

const MESSAGE_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES)

export function extensionBackedMediaContentType(file: File, allowedContentTypes: ReadonlySet<string>) {
  const normalized = file.type.split(';')[0]?.trim().toLowerCase()
  if (normalized && allowedContentTypes.has(normalized)) return normalized
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return null
}

export function isVideoContentType(contentType: string | null | undefined) {
  return typeof contentType === 'string' && contentType.startsWith('video/')
}

export async function prepareOperationalMediaFile(
  file: File,
  options: {
    allowedContentTypes: ReadonlySet<string>
    videoMaxBytes: number
    videoMaxSeconds: number
  }
) {
  const contentType = extensionBackedMediaContentType(file, options.allowedContentTypes)
  if (!contentType || !options.allowedContentTypes.has(contentType)) {
    throw new Error(
      'That file type is not supported here. Please choose a photo or video from your device.'
    )
  }

  if (isVideoContentType(contentType)) {
    if (
      !ALLOWED_VIDEO_CONTENT_TYPES.includes(
        contentType as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number]
      )
    ) {
      throw new Error('Choose an MP4 or MOV video.')
    }
    if (file.size > options.videoMaxBytes) {
      throw new Error(
        `Choose videos under ${Math.round(options.videoMaxBytes / (1024 * 1024))} MB.`
      )
    }
    const duration = await portfolioVideoDuration(file)
    if (Number.isFinite(duration) && duration > options.videoMaxSeconds) {
      throw new Error(OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE)
    }
    return new File([file], file.name, {
      type: contentType,
      lastModified: file.lastModified,
    })
  }

  if (file.size > MEDIA_LIMITS_BYTES.image) {
    throw new Error('Choose a photo under 10 MB.')
  }
  return reencodeImageFile(file)
}

function prepareMessageMediaFile(file: File) {
  return prepareOperationalMediaFile(file, {
    allowedContentTypes: MESSAGE_MEDIA_CONTENT_TYPES,
    videoMaxBytes: MESSAGE_MEDIA_VIDEO_MAX_BYTES,
    videoMaxSeconds: MESSAGE_MEDIA_VIDEO_MAX_SECONDS,
  })
}

export async function portfolioVideoDuration(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.preload = 'metadata'
    return await new Promise<number>((resolve, reject) => {
      video.onloadedmetadata = () => resolve(video.duration)
      video.onerror = () => reject(new Error('The video could not be read.'))
      video.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function reencodeImageFile(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('The photo could not be prepared for upload.'))
      element.src = objectUrl
    })

    const maxDimension = 2400
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The photo could not be prepared for upload.')
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (nextBlob) => {
          if (nextBlob) resolve(nextBlob)
          else reject(new Error('The photo could not be prepared for upload.'))
        },
        'image/jpeg',
        0.88
      )
    })
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'message-photo'}.jpg`
    return new File([blob], name, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function uploadPrivateFile(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext =
    file.name
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'jpg'
  const filePath = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: MEDIA_CACHE_CONTROL_SECONDS.private,
    upsert: false,
  })
  if (error) throw new Error('The media could not upload. Try a smaller file.')
  return filePath
}

async function createMessageMediaSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage.from('message-media').createSignedUrl(storagePath, 3600)
  return data?.signedUrl ?? null
}

type MutedVideoProps = {
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

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
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

function useMessageMediaUrl(raw: string | null | undefined): string | null {
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

function messageMediaStoragePath(raw: string | null | undefined) {
  if (!raw) return null
  if (raw.startsWith('messages/')) return raw
  if (raw.startsWith('message-media/')) return raw.replace(/^message-media\//, '')
  return null
}

function useMessageMediaUrls(messages: AccountMessage[]) {
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

function voicePlaybackMimeType(raw: string | null | undefined, fallback?: string | null) {
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

async function recordedAudioDurationSeconds(blob: Blob, fallbackSeconds: number) {
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

function useMessageVoicePlayback(raw: string | null | undefined) {
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

function VoiceMessagePlayer({ raw }: { raw: string | null | undefined }) {
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
}: {
  message: AccountMessage
  compact?: boolean
}) {
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const hasVoiceAttachment = Boolean(message.voice_url)
  const rawText = safeUserText(message.body, '')
  const text = hasVoiceAttachment && /^\d+(?:\.\d+)?$/u.test(rawText) ? '' : rawText
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

function MessageMediaMosaic({
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

const MESSAGE_REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '🙏'] as const

function MessageReactionBar({
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

type WebCallLifecycleEvent = {
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

export function MessageComposer({
  order,
  consultationBooking,
  onRefresh,
  channelRef,
  replyingTo,
  onClearReply,
  editingMessage,
  onClearEdit,
}: {
  order: AccountOrder
  consultationBooking?: ConsultationBookingSnapshot | null
  onRefresh: () => void
  channelRef?: React.RefObject<RealtimeChannel | null>
  replyingTo?: AccountMessage | null
  onClearReply?: () => void
  editingMessage?: AccountMessage | null
  onClearEdit?: () => void
}) {
  const account = useAccountContext()
  const [body, setBody] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [callBusy, setCallBusy] = useState<string | null>(null)
  const [callTime, setCallTime] = useState('')
  const [callReason, setCallReason] = useState('OTHER')
  const [consultationTime, setConsultationTime] = useState('')
  const [consultationNote, setConsultationNote] = useState('')
  const [scheduleSuggestion, setScheduleSuggestion] = useState<{
    kind: 'call' | 'consultation'
    value: string
    label: string
  } | null>(null)
  const publishedConsultationCallType =
    firstJoinedRow(order.tailor_profiles)?.consultation_call_type ?? 'VIDEO'
  const [consultationCallType, setConsultationCallType] = useState<'AUDIO' | 'VIDEO'>(
    publishedConsultationCallType === 'AUDIO' ? 'AUDIO' : 'VIDEO'
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const readyMadeCallTimeInputRef = useRef<HTMLInputElement | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [webRecording, setWebRecording] = useState(false)
  const [webRecordingSeconds, setWebRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const webRecordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const webStreamRef = useRef<MediaStream | null>(null)
  const webRecordingStartingRef = useRef(false)
  const webRecordingStoppingRef = useRef(false)
  const webRecordingFinalizingRef = useRef(false)
  const webRecordingCancelledRef = useRef(false)
  const webRecordingSecondsRef = useRef(0)
  const canMessage = !isTerminalOrder(order)
  const isReadyMade = order.order_kind === 'READY_MADE'

  // Pre-populate body when entering edit mode
  const prevEditingIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (editingMessage && editingMessage.id !== prevEditingIdRef.current) {
      setBody(editingMessage.body ?? '')
    }
    prevEditingIdRef.current = editingMessage?.id ?? null
  }, [editingMessage])

  useEffect(
    () => () => {
      if (webRecordTimerRef.current) clearInterval(webRecordTimerRef.current)
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // The browser already released this recorder.
          }
        }
      }
      webStreamRef.current?.getTracks().forEach((track) => track.stop())
    },
    []
  )

  const photoPreviewUrl = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : null),
    [photoFile]
  )
  useEffect(
    () => () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    },
    [photoPreviewUrl]
  )

  function broadcastTyping(isTyping: boolean) {
    const channel = channelRef?.current ?? null
    if (!channel || !account.userId) return
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: account.userId, isTyping },
    })
  }
  const isCustomOrder = order.order_kind === 'CUSTOM' || !order.order_kind
  const supportMeta = useMemo(
    () => supportMetaWithConsultationBooking(order.special_note, consultationBooking),
    [consultationBooking, order.special_note]
  )
  const consultationMeta = supportMeta.consultation ?? null
  const orderCallMeta = supportMeta.orderCall ?? null
  const viewerIsCustomer = order.customer_id === account.userId
  const hasConfirmedConsultationBooking = Boolean(
    consultationBooking?.status === 'CONFIRMED' && consultationBooking.scheduled_start_at
  )
  const consultationPaymentRequired =
    !!consultationMeta?.feeAmount &&
    consultationMeta.status !== 'REQUESTED' &&
    consultationMeta.status !== 'DECLINED' &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS'
  const consultationPaymentPaid = consultationPaymentRequired && !!consultationMeta?.paidAt
  const consultationPaymentBlocked = consultationPaymentRequired && !consultationPaymentPaid
  const consultationRescheduleRequired = false
  const canRequestConsultation =
    isCustomOrder && viewerIsCustomer && order.stage === 'PENDING_QUOTE' && !hasConfirmedConsultationBooking
  const canScheduleOrderCall = ORDER_CALL_STAGES.has(order.stage ?? '')
  const consultationLifecycle = getCallLifecycleState(consultationMeta?.scheduledStartAt)
  const orderCallLifecycle = getCallLifecycleState(orderCallMeta?.scheduledStartAt)
  const canShowCallButtons =
    canStartOrderCall(order) &&
    (consultationLifecycle.status === 'active' || orderCallLifecycle.status === 'active')
  const consultationLabel = consultationLifecycle.status === 'expired' ? null : formatDateTime(
    consultationMeta?.scheduledStartAt ?? consultationMeta?.proposedStartAt,
    consultationMeta?.timezone
  )
  const readyMadeCallLabel = orderCallLifecycle.status === 'expired' ? null : formatDateTime(
    orderCallMeta?.scheduledStartAt,
    orderCallMeta?.timezone
  )

  const callLifecycleEvent: WebCallLifecycleEvent | null =
    (order.stage === 'CONSULTATION' || hasConfirmedConsultationBooking) &&
    !consultationRescheduleRequired &&
    consultationMeta?.status === 'SCHEDULED' &&
    consultationMeta.scheduledStartAt &&
    getCallLifecycleState(consultationMeta.scheduledStartAt).status !== 'expired'
      ? {
          kind: 'consultation',
          scheduledStartAt: consultationMeta.scheduledStartAt,
          timezone: consultationMeta.timezone,
          status: consultationMeta.status,
          paymentRequired: consultationPaymentRequired,
          paymentPaid: consultationPaymentPaid,
          actionLoading: !!callBusy,
          callType: consultationMeta.callType === 'AUDIO' ? 'audio' : 'video',
          joinHref: accountRoute(
            `/account/call-join?orderId=${encodeURIComponent(order.id)}&callKind=consultation&callType=${consultationMeta.callType === 'AUDIO' ? 'audio' : 'video'}`
          ),
          onJoinVideo: () => {
            void startCall(consultationMeta.callType === 'AUDIO' ? 'audio' : 'video')
          },
          rescheduleHref: accountRoute(`/account/messages?orderId=${encodeURIComponent(order.id)}`),
          rescheduleLabel: viewerIsCustomer ? 'Message tailor' : 'Message customer',
          paymentHref: viewerIsCustomer
            ? accountRoute(`/account/checkout/${order.id}`)
            : accountRoute(`/account/orders/${order.id}`),
          paymentActionLabel: viewerIsCustomer ? 'Pay now' : 'View order',
        }
      : isReadyMade && orderCallMeta?.status === 'SCHEDULED' && orderCallMeta.scheduledStartAt && orderCallLifecycle.status !== 'expired'
        ? {
            kind: 'ready-made',
            scheduledStartAt: orderCallMeta.scheduledStartAt,
            timezone: orderCallMeta.timezone,
            status: orderCallMeta.status,
            reason: orderCallMeta.reason,
            actionLoading: !!callBusy,
            onJoinVideo: () => {
              void startCall('video')
            },
            onReschedule: () => {
              setError('Choose a new time below and tap Schedule.')
              readyMadeCallTimeInputRef.current?.focus()
              const picker = readyMadeCallTimeInputRef.current as
                | (HTMLInputElement & { showPicker?: () => void })
                | null
              picker?.showPicker?.()
            },
            rescheduleLabel: 'Reschedule',
          }
        : null

  async function sendMessage() {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    broadcastTyping(false)
    const trimmed = body.trim()
    setError(null)
    setSuccess(null)
    setUploadStatus(null)

    // Edit mode: update existing message body
    if (editingMessage) {
      if (!trimmed) {
        setError('Message cannot be empty.')
        return
      }
      const leak = assertNoContactLeak(trimmed)
      if (leak) {
        setError(leak)
        return
      }
      setBusy(true)
      try {
        await invokeAccountFunction('message-action', {
          action: 'edit',
          messageId: editingMessage.id,
          body: trimmed,
        })
        setBody('')
        onClearEdit?.()
        onRefresh()
      } catch (editError) {
        setError(friendlyActionError(editError, 'Could not edit this message. Please try again.'))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!trimmed && !photoFile) {
      setError('Write a message or attach media before sending.')
      return
    }
    if (trimmed) {
      const leak = assertNoContactLeak(trimmed)
      if (leak) {
        setError(leak)
        return
      }
    }
    setBusy(true)
    try {
      if (photoFile) {
        setUploadStatus('Preparing media...')
        const preparedPhoto = await prepareMessageMediaFile(photoFile)
        setUploadStatus('Uploading...')
        const storagePath = await uploadPrivateFile(
          'message-media',
          `messages/${order.id}`,
          preparedPhoto
        )
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'PHOTO',
          photoUrl: storagePath,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
      }
      if (trimmed) {
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'TEXT',
          body: trimmed,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
      }
      setBody('')
      setPhotoFile(null)
      setPhotoPreviewOpen(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
      onClearReply?.()
      setSuccess(
        photoFile && trimmed
          ? 'Media and message sent inside the protected order thread.'
          : photoFile
            ? 'Media sent inside the protected order thread.'
            : 'Message sent inside the protected order thread.'
      )
      onRefresh()
    } catch (messageError) {
      setError(
        friendlyActionError(
          messageError,
          'Message could not send. Please try again with smaller media or text only.'
        )
      )
    } finally {
      setBusy(false)
      setUploadStatus(null)
    }
  }

  async function scheduleReadyMadeCall() {
    const scheduledStartAt = datetimeLocalToIso(callTime)
    setError(null)
    setSuccess(null)
    if (!canScheduleOrderCall) {
      setError(
        order.stage === 'PENDING_QUOTE'
          ? 'Keep using Messages while the tailor reviews the brief. Scheduled calls unlock after the quote is sent.'
          : 'Scheduled calls are unavailable for this order right now.'
      )
      return
    }
    if (!scheduledStartAt) {
      setError('Choose a valid call time.')
      return
    }
    if (!isCallSchedulingStartValid(scheduledStartAt)) {
      const suggestion = recommendedSchedulingStartDate()
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setScheduleSuggestion({ kind: 'call', value: dateToDatetimeLocal(suggestion), label })
      setError(`That call time is too soon. The nearest valid option is ${label}.`)
      return
    }
    setScheduleSuggestion(null)
    setCallBusy('schedule')
    try {
      await invokeAccountFunction('order-call-action', {
        action: isReadyMade ? 'schedule-ready-made-call' : 'schedule-order-call',
        orderId: order.id,
        scheduledStartAt,
        callType: consultationCallType,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reason: callReason,
      })
      setSuccess(
        'Order call scheduled. Both people were notified, and the call will open near the selected time.'
      )
      onRefresh()
    } catch (callError) {
      setError(friendlyActionError(callError, 'Call could not be scheduled. Please try again.'))
    } finally {
      setCallBusy(null)
    }
  }

  async function requestConsultation() {
    const scheduledStartAt = datetimeLocalToIso(consultationTime)
    const note = consultationNote.trim()
    const leak = assertNoContactLeak(note, "Consultation notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!scheduledStartAt) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setScheduleSuggestion({
        kind: 'consultation',
        value: dateToDatetimeLocal(suggestion),
        label,
      })
      setError('Choose a valid consultation time, or use the nearest available option below.')
      return
    }
    if (new Date(scheduledStartAt).getTime() < Date.now() + 120 * 60_000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setScheduleSuggestion({ kind: 'consultation', value: dateToDatetimeLocal(suggestion), label })
      setError(`That consultation time is too soon. The nearest valid option is ${label}.`)
      return
    }
    setScheduleSuggestion(null)
    if (leak) {
      setError(leak)
      return
    }
    setCallBusy('consultation')
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'request-consultation',
        orderId: order.id,
        scheduledStartAt,
        callType: consultationCallType,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        note: note || undefined,
      })
      setConsultationTime('')
      setConsultationNote('')
      setSuccess(
        'Consultation request sent. The tailor can approve, reschedule, price, or decline it from their order view.'
      )
      onRefresh()
    } catch (consultationError) {
      setError(
        friendlyActionError(
          consultationError,
          'Consultation could not be requested. Choose another time and try again.'
        )
      )
    } finally {
      setCallBusy(null)
    }
  }

  async function startCall(callType: 'audio' | 'video') {
    setError(null)
    setSuccess(null)
    if (!canStartOrderCall(order)) {
      setError(
        order.stage === 'PENDING_QUOTE'
          ? 'Request a consultation before starting a call on this custom order.'
          : 'Calls open after payment is confirmed while the order is active.'
      )
      return
    }
    if (isReadyMade && orderCallMeta?.status !== 'SCHEDULED') {
      setError('Schedule this ready-made call first so both sides know when to join.')
      return
    }
    if (consultationPaymentBlocked) {
      setError('Consultation fee required before the room can open')
      return
    }
    setCallBusy(callType)
    try {
      const functionName =
        order.stage === 'CONSULTATION' ? 'create-consultation-room' : 'create-order-call-room'
      const enforcedCallType =
        order.stage === 'CONSULTATION'
          ? consultationMeta?.callType === 'AUDIO'
            ? 'audio'
            : 'video'
          : callType
      const result = await invokeAccountFunction<{
        url?: string | null
        fallback?: string
        message?: string
      }>(functionName, {
        orderId: order.id,
        callType: enforcedCallType,
      })
      onRefresh()
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer')
        setSuccess(
          order.stage === 'CONSULTATION'
            ? `Consultation ${enforcedCallType} opened in a new tab.`
            : `Drapeon ${enforcedCallType} call opened in a new tab.`
        )
        return
      }
      setError(
        result.message ??
          'Calling is unavailable right now. Continue in Messages so the order record stays protected.'
      )
    } catch (callError) {
      setError(
        friendlyActionError(
          callError,
          'Call could not start right now. Keep the conversation in Messages.'
        )
      )
    } finally {
      setCallBusy(null)
    }
  }

  function stopWebRecordingTimer() {
    if (webRecordTimerRef.current) {
      clearInterval(webRecordTimerRef.current)
      webRecordTimerRef.current = null
    }
  }

  function cancelWebRecording() {
    webRecordingCancelledRef.current = true
    stopWebRecordingTimer()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive' && !webRecordingStoppingRef.current) {
      webRecordingStoppingRef.current = true
      recorder.stop()
      return
    }

    audioChunksRef.current = []
    webStreamRef.current?.getTracks().forEach((track) => track.stop())
    webStreamRef.current = null
    mediaRecorderRef.current = null
    webRecordingStoppingRef.current = false
    webRecordingCancelledRef.current = false
    webRecordingSecondsRef.current = 0
    setWebRecording(false)
    setWebRecordingSeconds(0)
  }

  async function startWebRecording() {
    if (
      busy ||
      webRecordingStartingRef.current ||
      webRecordingStoppingRef.current ||
      webRecordingFinalizingRef.current ||
      mediaRecorderRef.current
    )
      return

    setError(null)
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError('Voice recording requires a secure browser connection with microphone support.')
      return
    }

    webRecordingStartingRef.current = true
    webRecordingCancelledRef.current = false
    webRecordingSecondsRef.current = 0
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      webStreamRef.current = stream
      audioChunksRef.current = []
      const mimeType =
        ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find((candidate) =>
          MediaRecorder.isTypeSupported(candidate)
        ) ?? null
      if (!mimeType) throw new Error('CROSS_PLATFORM_VOICE_UNSUPPORTED')

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onerror = () => {
        webRecordingCancelledRef.current = true
        setError('Voice recording stopped unexpectedly. Please try again.')
      }
      recorder.onstop = () => {
        const wasCancelled = webRecordingCancelledRef.current
        const durationSeconds = webRecordingSecondsRef.current
        stopWebRecordingTimer()
        webStreamRef.current?.getTracks().forEach((track) => track.stop())
        webStreamRef.current = null
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null
        setWebRecording(false)
        setWebRecordingSeconds(0)

        if (wasCancelled) {
          audioChunksRef.current = []
          webRecordingStoppingRef.current = false
          webRecordingCancelledRef.current = false
          webRecordingSecondsRef.current = 0
          return
        }

        void finaliseWebRecording(recorder.mimeType, durationSeconds)
      }
      recorder.start()
      setWebRecording(true)
      setWebRecordingSeconds(0)
      webRecordTimerRef.current = setInterval(() => {
        webRecordingSecondsRef.current += 1
        setWebRecordingSeconds(webRecordingSecondsRef.current)
        if (webRecordingSecondsRef.current >= 60) {
          stopWebRecording()
        }
      }, 1000)
    } catch (recordingError) {
      stopWebRecordingTimer()
      stream?.getTracks().forEach((track) => track.stop())
      webStreamRef.current = null
      mediaRecorderRef.current = null
      audioChunksRef.current = []
      setWebRecording(false)
      setWebRecordingSeconds(0)

      setError(voiceRecordingErrorMessage(recordingError))
    } finally {
      webRecordingStartingRef.current = false
    }
  }

  async function finaliseWebRecording(mimeType: string, recordedSeconds: number) {
    if (webRecordingFinalizingRef.current) return
    webRecordingFinalizingRef.current = true
    try {
      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      if (chunks.length === 0) return

      const storageContentType = voicePlaybackMimeType(null, mimeType)
      const blob = new Blob(chunks, { type: storageContentType })
      if (blob.size > MEDIA_LIMITS_BYTES.voiceNote) {
        setError('Voice note too large. Keep recordings under 25 MB.')
        return
      }

      const ext = storageContentType === 'audio/mp4' ? 'm4a' : 'aac'
      const filename = `messages/${order.id}/${Date.now()}.${ext}`
      const durationSeconds = await recordedAudioDurationSeconds(blob, recordedSeconds)
      setBusy(true)
      setUploadStatus('Uploading voice note...')
      try {
        const supabase = createClient()
        const { error: uploadError } = await supabase.storage
          .from('message-media')
          .upload(filename, blob, { contentType: storageContentType, upsert: false })
        if (uploadError) throw uploadError
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'VOICE',
          voiceUrl: filename,
          voiceDuration: durationSeconds,
        })
        setSuccess('Voice note sent inside the protected order thread.')
        onRefresh()
      } catch (voiceError) {
        setError(friendlyActionError(voiceError, 'Voice note could not send. Please try again.'))
      } finally {
        setBusy(false)
        setUploadStatus(null)
      }
    } finally {
      webRecordingFinalizingRef.current = false
      webRecordingStoppingRef.current = false
      webRecordingCancelledRef.current = false
      webRecordingSecondsRef.current = 0
    }
  }

  function stopWebRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive' || webRecordingStoppingRef.current) return
    webRecordingStoppingRef.current = true
    try {
      recorder.stop()
    } catch {
      webRecordingStoppingRef.current = false
      setError('Voice recording could not stop cleanly. Please try again.')
    }
  }

  function formatWebDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (!canMessage) {
    return (
      <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is closed, so the web thread is read-only.
      </p>
    )
  }

  return (
    <div className="grid min-w-0 gap-0 overflow-hidden">
      <ActionNotice error={error} success={success} />
      {callLifecycleEvent ? <CallLifecycleEventCard event={callLifecycleEvent} compact /> : null}

      {/* Toolbar — always visible */}
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 pb-2">
        {/* Hidden file input */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="hidden"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null
            setError(null)
            setPhotoFile(nextFile)
            if (!nextFile) setPhotoPreviewOpen(false)
          }}
          disabled={busy}
        />
        <IconButton
          title="Attach media"
          label="Attach media"
          onClick={() => photoInputRef.current?.click()}
          disabled={busy || webRecording}
          variant={photoFile ? 'secondary' : 'ghost'}
          size="icon-sm"
        >
          <Paperclip className="size-4.5" />
        </IconButton>
        {/* Voice note */}
        {webRecording ? (
          <>
            <span className="ml-1 min-w-[2.5rem] text-xs font-semibold tabular-nums text-needle">
              {formatWebDuration(webRecordingSeconds)}
            </span>
            <IconButton
              title="Send voice note"
              label="Send voice note"
              onClick={() => {
                void stopWebRecording()
              }}
              variant="secondary"
              size="icon-sm"
            >
              <Square className="size-4 fill-current" />
            </IconButton>
            <IconButton
              title="Cancel recording"
              label="Cancel recording"
              onClick={cancelWebRecording}
              variant="destructive"
              size="icon-sm"
            >
              <X className="size-4" />
            </IconButton>
          </>
        ) : (
          <IconButton
            title="Record voice note"
            label="Record voice note"
            onClick={() => {
              void startWebRecording()
            }}
            disabled={busy}
            variant="ghost"
            size="icon-sm"
          >
            <Mic className="size-4.5" />
          </IconButton>
        )}
        {canShowCallButtons && order.stage !== 'CONSULTATION' ? (
          <>
            <IconButton
              title="Audio call"
              label="Start audio call"
              onClick={() => {
                void startCall('audio')
              }}
              disabled={!!callBusy || consultationPaymentBlocked}
              variant="ghost"
              size="icon-sm"
            >
              {callBusy === 'audio' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Phone className="size-4.5" />
              )}
            </IconButton>
            <IconButton
              title="Video call"
              label="Start video call"
              onClick={() => {
                void startCall('video')
              }}
              disabled={!!callBusy || consultationPaymentBlocked}
              variant="ghost"
              size="icon-sm"
            >
              {callBusy === 'video' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Video className="size-4.5" />
              )}
            </IconButton>
          </>
        ) : null}
        {uploadStatus ? (
          <span className="ml-1 text-xs font-semibold text-needle">{uploadStatus}</span>
        ) : null}
        {consultationLabel && !callLifecycleEvent ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">
            Consultation: {consultationLabel}
          </span>
        ) : readyMadeCallLabel ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">
            Call: {readyMadeCallLabel}
          </span>
        ) : null}
      </div>

      {consultationPaymentBlocked && !callLifecycleEvent ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-rust/16 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
          <span className="font-semibold">Consultation fee required before the room can open</span>
          <Link
            href={
              viewerIsCustomer
                ? accountRoute(`/account/checkout/${order.id}`)
                : accountRoute(`/account/orders/${order.id}`)
            }
            className="font-semibold text-needle"
          >
            {viewerIsCustomer ? 'Pay now' : 'View order'}
          </Link>
        </div>
      ) : null}

      {/* Media preview */}
      {photoFile ? (
        <div className="mb-2 flex min-w-0 items-center gap-3 rounded-lg border border-needle/15 bg-needle/6 p-2 text-xs text-needle">
          <button
            type="button"
            onClick={() => setPhotoPreviewOpen(true)}
            className="relative block h-20 w-24 shrink-0 overflow-hidden rounded-[8px] bg-ink/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
            aria-label={`Expand ${photoFile.name}`}
          >
            {photoPreviewUrl ? (
              isVideoContentType(
                extensionBackedMediaContentType(photoFile, MESSAGE_MEDIA_CONTENT_TYPES)
              ) ? (
                <video
                  src={photoPreviewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={photoPreviewUrl}
                  alt="Selected message attachment"
                  className="h-full w-full object-cover"
                />
              )
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{photoFile.name}</p>
            <button
              type="button"
              onClick={() => setPhotoPreviewOpen(true)}
              className="mt-1 font-semibold text-needle underline decoration-needle/30 underline-offset-2"
            >
              Preview
            </button>
          </div>
          <Button
            type="button"
            onClick={() => {
              setPhotoFile(null)
              setPhotoPreviewOpen(false)
              if (photoInputRef.current) photoInputRef.current.value = ''
            }}
            variant="ghost"
            size="sm"
            className="shrink-0 text-rust hover:text-rust"
          >
            Remove
          </Button>
        </div>
      ) : null}
      {photoFile && photoPreviewUrl && photoPreviewOpen ? (
        <MediaViewerOverlay
          src={photoPreviewUrl}
          label={photoFile.name}
          video={isVideoContentType(
            extensionBackedMediaContentType(photoFile, MESSAGE_MEDIA_CONTENT_TYPES)
          )}
          onClose={() => setPhotoPreviewOpen(false)}
        />
      ) : null}

      {/* Textarea + send */}
      <div className="flex items-end gap-2 rounded-lg border border-ui-border bg-white p-2 shadow-sm focus-within:border-needle/45 focus-within:ring-2 focus-within:ring-needle/10">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Reply</span>
          <Textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              broadcastTyping(true)
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
              typingTimerRef.current = setTimeout(() => broadcastTyping(false), 2000)
            }}
            rows={2}
            maxLength={2000}
            className="max-h-36 min-h-11 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
            placeholder="Message..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />
        </label>
        <Button
          type="button"
          onClick={() => {
            void sendMessage()
          }}
          disabled={busy || webRecording}
          size="icon"
          className="mb-0.5 shrink-0 rounded-lg"
          aria-label={busy ? 'Sending message' : 'Send message'}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4.5" />}
        </Button>
      </div>

      {canRequestConsultation ? (
        <DisclosurePanel
          title="Request consultation"
          summary={
            consultationTime ? 'Consultation time set' : 'Ask the tailor to meet before quoting.'
          }
        >
          <div className="grid gap-3">
            {publishedConsultationCallType === 'AUDIO_OR_VIDEO' ? (
              <fieldset className="grid gap-2">
                <legend className="text-xs font-semibold text-ink">Call type</legend>
                <div className="flex gap-2">
                  {(['AUDIO', 'VIDEO'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={consultationCallType === value}
                      onClick={() => setConsultationCallType(value)}
                      className={`rounded-[8px] border px-4 py-2 text-sm font-semibold ${consultationCallType === value ? 'border-needle bg-needle/8 text-needle' : 'border-ink/10 bg-white text-ink'}`}
                    >
                      {value === 'AUDIO' ? 'Audio' : 'Video'}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="text-sm font-semibold text-ink">
                {consultationCallType === 'AUDIO' ? 'Audio consultation' : 'Video consultation'}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Preferred date &amp; time</span>
                <input
                  type="datetime-local"
                  value={consultationTime}
                  min={dateToDatetimeLocal(
                    recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
                  )}
                  onChange={(event) => {
                    setConsultationTime(event.target.value)
                    setScheduleSuggestion(null)
                  }}
                  className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  void requestConsultation()
                }}
                disabled={!!callBusy}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {callBusy === 'consultation' ? 'Sending...' : 'Request'}
              </button>
            </div>
            {scheduleSuggestion?.kind === 'consultation' ? (
              <button
                type="button"
                onClick={() => {
                  setConsultationTime(scheduleSuggestion.value)
                  setScheduleSuggestion(null)
                  setError(null)
                }}
                className="w-fit rounded-[8px] border border-needle/20 bg-needle/8 px-3 py-2 text-sm font-semibold text-needle"
              >
                Use {scheduleSuggestion.label}
              </button>
            ) : null}
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Optional note about fit, fabric, event timing, or questions."
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
            />
            <p className="text-xs leading-5 text-ink/48">
              The tailor has 48 hours to approve, reschedule, or decline. Any fee is shown before
              payment.
            </p>
          </div>
        </DisclosurePanel>
      ) : consultationMeta && !callLifecycleEvent && consultationLifecycle.status !== 'expired' ? (
        <div className="mt-3 rounded-[8px] border border-needle/12 bg-needle/6 px-3 py-2 text-xs leading-5 text-needle">
          {consultationMeta.status === 'REQUESTED'
            ? `Consultation requested${consultationLabel ? ` for ${consultationLabel}` : ''}.${consultationMeta.requestExpiresAt ? ` Respond by ${formatDateTime(consultationMeta.requestExpiresAt, consultationMeta.timezone)}.` : ' The tailor has 48 hours to respond.'}`
            : consultationMeta.status === 'SCHEDULED'
              ? `Consultation scheduled${consultationLabel ? ` for ${consultationLabel}` : ''}. Use the call buttons near the scheduled time.`
              : `Consultation ${cleanLabel(consultationMeta.status, 'requested').toLowerCase()}${consultationLabel ? ` for ${consultationLabel}` : ''}.`}
        </div>
      ) : null}

      {/* Ready-made call schedule */}
      {canScheduleOrderCall ? (
        <DisclosurePanel
          title="Schedule call"
          summary={
            readyMadeCallLabel
              ? `Scheduled ${readyMadeCallLabel}`
              : callTime
                ? 'Call time set'
                : 'Use a call for active-order pickup, delivery, sizing, or item-condition clarity.'
          }
        >
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_auto] md:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Date &amp; time</span>
              <input
                ref={readyMadeCallTimeInputRef}
                type="datetime-local"
                value={callTime}
                min={dateToDatetimeLocal(recommendedSchedulingStartDate())}
                onChange={(event) => {
                  setCallTime(event.target.value)
                  setScheduleSuggestion(null)
                }}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Reason</span>
              <select
                value={callReason}
                onChange={(event) => setCallReason(event.target.value)}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {CALL_SCHEDULING_POLICY.reasons.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void scheduleReadyMadeCall()
              }}
              disabled={!!callBusy}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20 md:col-auto"
            >
              {callBusy === 'schedule' ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
          {scheduleSuggestion?.kind === 'call' ? (
            <button
              type="button"
              onClick={() => {
                setCallTime(scheduleSuggestion.value)
                setScheduleSuggestion(null)
                setError(null)
              }}
              className="mt-3 w-fit rounded-[8px] border border-needle/20 bg-needle/8 px-3 py-2 text-sm font-semibold text-needle"
            >
              Use {scheduleSuggestion.label}
            </button>
          ) : null}
        </DisclosurePanel>
      ) : isReadyMade ? (
        <p className="mt-3 rounded-[8px] border border-ink/8 bg-bone/55 px-3 py-2 text-xs leading-5 text-ink/54">
          Use Messages for item questions before checkout. Ready-made calls open after checkout when
          the order is active.
        </p>
      ) : null}
    </div>
  )
}

type MessageThreadFilter = 'active' | 'completed' | 'archived'

export function currentNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function readArchivedMessageOrderIds(storageKey: string | null) {
  if (!storageKey || typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    )
  } catch {
    return new Set<string>()
  }
}

export function OrderConversationEventCard({ event }: { event: AccountOrderEvent }) {
  const presentation = deriveConversationEventPresentation({
    eventType: event.event_type,
    title: event.title,
    summary: event.summary,
    quoteVersion: event.quote_version,
    metadata: event.metadata,
  })
  const EventIcon = {
    quote: ClipboardList,
    payment: Banknote,
    scope: Pencil,
    fabric: SlidersHorizontal,
    measurement: Ruler,
    fulfillment: ShoppingBag,
    remedy: CircleHelp,
  }[presentation.icon]
  return (
    <article className="mx-auto my-3 grid w-[min(88%,34rem)] gap-3 rounded-[10px] border border-needle/18 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
          <EventIcon className="size-4.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-needle">
              {presentation.eyebrow}
            </p>
            <time className="text-xs text-ink/44">{formatMessageRelative(event.created_at)}</time>
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-ink">{presentation.title}</h3>
        </div>
      </div>
      {event.summary ? (
        <p className="rounded-[8px] bg-ui-muted px-3 py-2 text-sm leading-5 text-ink/68">
          {safeUserText(event.summary, '')}
        </p>
      ) : null}
      {presentation.facts.length > 0 ? (
        <dl className="divide-y divide-ink/8 border-y border-ink/8">
          {presentation.facts.map((item) => (
            <div
              key={`${item.label}:${item.value}`}
              className="grid grid-cols-[minmax(5rem,0.7fr)_minmax(0,1.3fr)] gap-4 py-2"
            >
              <dt className="text-xs font-semibold text-ink/46">{item.label}</dt>
              <dd className="text-right text-sm font-semibold leading-5 text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChip status={event.event_type} fallback={ORDER_EVENT_LABELS[event.event_type]} />
        <p className="text-xs text-ink/44">
          {formatDatabaseEnumLabel(event.actor_role, 'Drapeon')}
        </p>
      </div>
    </article>
  )
}

export function RenderMessages({ data, onRefresh }: { data: MessagesRenderData; onRefresh: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedOrderId = searchParams.get('orderId')
  const requestedEventId = searchParams.get('eventId')
  const [realtimeMessages, setRealtimeMessages] = useState<AccountMessage[]>([])
  const [reactionPatchState, setReactionPatchState] = useState<{
    upserts: AccountMessageReaction[]
    deletedIds: Set<string>
  }>({ upserts: [], deletedIds: new Set() })
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'offline'>(
    'connecting'
  )
  const [filter, setFilter] = useState<MessageThreadFilter>('active')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(() => requestedOrderId)
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<AccountMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<AccountMessage | null>(null)
  const [archiveRevision, setArchiveRevision] = useState(0)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => currentNotificationPermission())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set())
  const [counterpartyIsTyping, setCounterpartyIsTyping] = useState(false)
  const [counterpartyPresence, setCounterpartyPresence] = useState<{
    online: boolean
    lastSeen: Date | null
  }>({ online: false, lastSeen: null })
  const [conversationActionBusy, setConversationActionBusy] = useState(false)
  const [conversationActionError, setConversationActionError] = useState<string | null>(null)
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false)
  const [revisionReasons, setRevisionReasons] = useState<string[]>(['PRICE'])
  const [revisionNote, setRevisionNote] = useState('')
  const [revisionTargetAmount, setRevisionTargetAmount] = useState('')
  const [editingRevision, setEditingRevision] = useState(false)
  const [translationPreference, setTranslationPreference] =
    useState<ConversationTranslationPreference>(() => ({
      autoTranslate: false,
      targetLanguage:
        typeof navigator === 'undefined' ? 'en' : translationTargetFromLocale(navigator.language),
      sourceLanguage: null,
    }))
  const [translationLanguages, setTranslationLanguages] = useState<TranslationLanguage[]>(
    FALLBACK_TRANSLATION_LANGUAGES
  )
  const [messageTranslations, setMessageTranslations] = useState<
    Record<string, MessageTranslation>
  >({})
  const [translationLoadingIds, setTranslationLoadingIds] = useState<Set<string>>(new Set())
  const [translationFailedIds, setTranslationFailedIds] = useState<Set<string>>(new Set())
  const [showOriginalTranslationIds, setShowOriginalTranslationIds] = useState<Set<string>>(
    new Set()
  )
  const [translationSettingsBusy, setTranslationSettingsBusy] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [translationAvailable, setTranslationAvailable] = useState(false)
  const notificationPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const markedReadRef = useRef<Set<string>>(new Set())
  const orderChannelRef = useRef<RealtimeChannel | null>(null)
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const orderIds = useMemo(() => data.orders.map((order) => order.id), [data.orders])
  const ordersById = useMemo(
    () => new Map(data.orders.map((order) => [order.id, order])),
    [data.orders]
  )
  const archiveStorageKey = data.userId
    ? `drapeon:web:archived-message-orders:${data.userId}`
    : null
  const archivedOrderIds = useMemo(() => {
    void archiveRevision
    return readArchivedMessageOrderIds(archiveStorageKey)
  }, [archiveRevision, archiveStorageKey])
  const liveMessages = useMemo(() => {
    const seen = new Set<string>()
    return [...realtimeMessages, ...data.messages].filter((message) => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [data.messages, realtimeMessages])
  const liveReactionMessageIds = useMemo(
    () => new Set(liveMessages.map((message) => message.id)),
    [liveMessages]
  )
  const liveReactions = useMemo(() => {
    const reactions = new Map<string, AccountMessageReaction>()
    for (const reaction of data.reactions) {
      if (
        !liveReactionMessageIds.has(reaction.message_id) ||
        reactionPatchState.deletedIds.has(reaction.id)
      )
        continue
      reactions.set(reaction.id, reaction)
    }
    for (const reaction of reactionPatchState.upserts) {
      if (
        !liveReactionMessageIds.has(reaction.message_id) ||
        reactionPatchState.deletedIds.has(reaction.id)
      )
        continue
      reactions.set(reaction.id, reaction)
    }
    return [...reactions.values()]
  }, [data.reactions, liveReactionMessageIds, reactionPatchState])
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, AccountMessageReaction[]>()
    for (const reaction of liveReactions) {
      const current = map.get(reaction.message_id) ?? []
      current.push(reaction)
      map.set(reaction.message_id, current)
    }
    return map
  }, [liveReactions])

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission
  }, [notificationPermission])

  useEffect(() => {
    if (orderIds.length === 0) {
      return
    }
    const supabase = createClient()
    const orderIdSet = new Set(orderIds)
    const channel = supabase
      .channel(`account-messages:${data.userId ?? 'anonymous'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const next = payload.new as AccountMessage
          if (!orderIdSet.has(next.order_id)) return
          setRealtimeMessages((current) =>
            current.some((message) => message.id === next.id) ? current : [next, ...current]
          )
          const threadOrder = ordersById.get(next.order_id)
          if (
            typeof window !== 'undefined' &&
            notificationPermissionRef.current === 'granted' &&
            next.sender_id !== data.userId &&
            document.visibilityState !== 'visible'
          ) {
            const notice = new Notification(
              `New message: ${threadOrder ? orderTitle(threadOrder) : 'Order thread'}`,
              {
                body: safeUserText(
                  next.body,
                  next.photo_url || next.voice_url ? 'New media message' : 'New order message'
                ),
                icon: '/icon-192.png',
              }
            )
            notice.onclick = () => {
              window.focus()
              setSelectedOrderId(next.order_id)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const next = payload.new as AccountMessageReaction
          if (!orderIdSet.has(next.order_id)) return
          setReactionPatchState((current) => {
            const deletedIds = new Set(current.deletedIds)
            deletedIds.delete(next.id)
            return {
              deletedIds,
              upserts: [...current.upserts.filter((reaction) => reaction.id !== next.id), next],
            }
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const old = payload.old as Partial<AccountMessageReaction>
          if (!old.id) return
          setReactionPatchState((current) => {
            const deletedIds = new Set(current.deletedIds)
            deletedIds.add(old.id!)
            return {
              deletedIds,
              upserts: current.upserts.filter((reaction) => reaction.id !== old.id),
            }
          })
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(
          status === 'SUBSCRIBED'
            ? 'live'
            : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'
              ? 'offline'
              : 'connecting'
        )
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [data.userId, orderIds, ordersById])

  // Per-order channel for presence + typing (torn down when thread changes)
  useEffect(() => {
    if (!selectedOrderId || !data.userId) {
      const resetTimer = window.setTimeout(() => {
        setCounterpartyIsTyping(false)
        setCounterpartyPresence({ online: false, lastSeen: null })
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const supabaseClient = createClient()
    const ch = supabaseClient
      .channel(`messages:${selectedOrderId}`)
      .on(
        'broadcast',
        { event: 'typing' },
        ({ payload }: { payload: { userId: string; isTyping: boolean } }) => {
          if (payload.userId === data.userId) return
          setCounterpartyIsTyping(!!payload.isTyping)
          if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current)
          if (payload.isTyping) {
            typingClearTimerRef.current = setTimeout(() => setCounterpartyIsTyping(false), 4000)
          }
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ userId: string }>()
        const others = Object.values(state)
          .flat()
          .filter((p) => p.userId !== data.userId)
        const isOnline = others.length > 0
        setCounterpartyPresence((prev) => ({
          online: isOnline,
          lastSeen: isOnline ? null : prev.online ? new Date() : prev.lastSeen,
        }))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ userId: data.userId })
        }
      })

    orderChannelRef.current = ch

    function handleVisibility() {
      if (document.hidden) {
        void ch.untrack()
      } else {
        void ch.track({ userId: data.userId! })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current)
      void supabaseClient.removeChannel(ch)
      orderChannelRef.current = null
      setCounterpartyIsTyping(false)
      setCounterpartyPresence({ online: false, lastSeen: null })
    }
  }, [selectedOrderId, data.userId])

  function persistArchived(next: Set<string>) {
    if (archiveStorageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(archiveStorageKey, JSON.stringify([...next]))
    }
  }

  function setThreadArchived(orderId: string, archived: boolean) {
    const order = ordersById.get(orderId)
    if (archived && order && isActiveConversationOrder(order, data.userId)) {
      setConversationActionError('Ongoing order conversations cannot be archived.')
      return
    }
    const next = new Set(archivedOrderIds)
    if (archived) next.add(orderId)
    else next.delete(orderId)
    persistArchived(next)
    setArchiveRevision((current) => current + 1)
    setSelectedOrderId(null)
    setFilter(
      archived
        ? 'archived'
        : order && isActiveConversationOrder(order, data.userId)
          ? 'active'
          : 'completed'
    )
  }

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const threads = useMemo(() => {
    return data.orders
      .map((order) => {
        const messages = liveMessages
          .filter((message) => message.order_id === order.id)
          .sort((a, b) => timestampMs(b.created_at) - timestampMs(a.created_at))
        const latest = messages[0] ?? null
        const unread = messages.filter(
          (message) =>
            message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id)
        ).length
        const archived = archivedOrderIds.has(order.id)
        const completed = !isActiveConversationOrder(order, data.userId)
        return {
          order,
          messages,
          latest,
          unread,
          archived,
          completed,
          searchable: [
            orderTitle(order),
            partyName(order, data.userId),
            cleanLabel(order.stage, 'Order'),
            safeUserText(latest?.body, ''),
          ]
            .join(' ')
            .toLowerCase(),
        }
      })
      .sort((a, b) => {
        if (a.unread > 0 && b.unread === 0) return -1
        if (b.unread > 0 && a.unread === 0) return 1
        const aTime = timestampMs(a.latest?.created_at ?? a.order.updated_at ?? a.order.created_at)
        const bTime = timestampMs(b.latest?.created_at ?? b.order.updated_at ?? b.order.created_at)
        return bTime - aTime
      })
  }, [archivedOrderIds, data.orders, data.userId, liveMessages, localReadIds])
  const normalizedSearch = search.trim().toLowerCase()
  const activeThreads = threads.filter((thread) => !thread.archived && !thread.completed)
  const completedThreads = threads.filter((thread) => !thread.archived && thread.completed)
  const archivedThreads = threads.filter((thread) => thread.archived)
  const baseThreads =
    filter === 'active'
      ? activeThreads
      : filter === 'completed'
        ? completedThreads
        : archivedThreads
  const filteredThreads = baseThreads.filter(
    (thread) => !normalizedSearch || thread.searchable.includes(normalizedSearch)
  )

  const groups = (() => {
    const map = new Map<
      string,
      { key: string; name: string; avatarSrc: string | null; threads: typeof filteredThreads }
    >()
    for (const thread of filteredThreads) {
      const key = partyKey(thread.order, data.userId)
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: partyName(thread.order, data.userId),
          avatarSrc: partyAvatar(thread.order, data.userId),
          threads: [],
        })
      }
      map.get(key)!.threads.push(thread)
    }
    return [...map.values()]
      .map((group) => {
        const unread = group.threads.reduce((sum, t) => sum + t.unread, 0)
        const latestTime = Math.max(
          ...group.threads.map((t) =>
            timestampMs(t.latest?.created_at ?? t.order.updated_at ?? t.order.created_at)
          )
        )
        const latestPreview = group.threads.reduce<(typeof threads)[0]['latest']>((best, t) => {
          if (!best) return t.latest
          if (!t.latest) return best
          return timestampMs(t.latest.created_at) > timestampMs(best.created_at) ? t.latest : best
        }, null)
        return { ...group, unread, latestTime, latestPreview }
      })
      .sort((a, b) => {
        if (a.unread > 0 && b.unread === 0) return -1
        if (b.unread > 0 && a.unread === 0) return 1
        return b.latestTime - a.latestTime
      })
  })()

  const selectedThread = threads.find((thread) => thread.order.id === selectedOrderId) ?? null
  const selectedActiveQuote = selectedThread
    ? activeQuoteForOrder(data.quotes, selectedThread.order.id)
    : null
  const selectedOpenRevision = selectedThread
    ? (data.quoteRevisions.find(
        (revision) => revision.order_id === selectedThread.order.id && revision.status === 'OPEN'
      ) ?? null)
    : null
  const selectedNegotiationRoundsUsed = selectedThread
    ? Math.max(
        0,
        ...data.quoteRevisions
          .filter((revision) => revision.order_id === selectedThread.order.id)
          .map((revision) => revision.round_number)
      )
    : 0
  const selectedConversationActions = useMemo(() => {
    if (
      !QUOTE_NEGOTIATION_UI_ENABLED ||
      !selectedThread ||
      selectedThread.order.order_kind !== 'CUSTOM'
    ) {
      return null
    }
    const role = selectedThread.order.customer_id === data.userId ? 'CUSTOMER' : 'TAILOR'
    return deriveOrderConversationActions({
      role,
      orderKind: 'CUSTOM',
      stage: (selectedThread.order.stage ?? 'PENDING_QUOTE') as OrderStage,
      activeQuote: selectedActiveQuote
        ? {
            id: selectedActiveQuote.id,
            version: selectedActiveQuote.version,
            status: selectedActiveQuote.status,
          }
        : null,
      openRevision: selectedOpenRevision
        ? {
            id: selectedOpenRevision.id,
            status: selectedOpenRevision.status,
            roundNumber: selectedOpenRevision.round_number,
          }
        : null,
      negotiationRoundsUsed: selectedNegotiationRoundsUsed,
      negotiationRoundLimit: 3,
      paymentStarted: ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(
        selectedThread.order.stage ?? ''
      ),
    })
  }, [
    data.userId,
    selectedActiveQuote,
    selectedNegotiationRoundsUsed,
    selectedOpenRevision,
    selectedThread,
  ])
  const selectedMessages = useMemo(
    () =>
      selectedThread
        ? [...selectedThread.messages].sort(
            (a, b) => timestampMs(a.created_at) - timestampMs(b.created_at)
          )
        : [],
    [selectedThread]
  )
  const selectedConsultationBooking = selectedThread
    ? (data.consultationBookings ?? []).find(
        (booking) => booking.order_id === selectedThread.order.id
      ) ?? null
    : null
  const selectedCallMeta = selectedThread
    ? supportMetaWithConsultationBooking(
        selectedThread.order.special_note,
        selectedConsultationBooking
      )
    : null
  const selectedScheduledCall =
    selectedCallMeta?.consultation?.scheduledStartAt &&
    selectedCallMeta.consultation.status === 'SCHEDULED'
      ? selectedCallMeta.consultation
      : selectedCallMeta?.orderCall?.scheduledStartAt &&
          selectedCallMeta.orderCall.status === 'SCHEDULED'
        ? selectedCallMeta.orderCall
        : null
  const selectedCallLifecycle = (() => {
    if (!selectedThread) return null
    return selectedScheduledCall?.scheduledStartAt
      ? getCallLifecycleState(selectedScheduledCall.scheduledStartAt)
      : null
  })()
  const selectedCallType =
    selectedCallMeta?.consultation?.callType === 'AUDIO' ? 'audio' : 'video'
  const selectedCallKind =
    selectedCallMeta?.consultation?.scheduledStartAt &&
    selectedCallMeta.consultation.status === 'SCHEDULED'
      ? 'consultation'
      : 'ready-made'
  const selectedCallPaymentBlocked = Boolean(
    selectedCallMeta?.consultation?.feeAmount && !selectedCallMeta.consultation.paidAt
  )
  const selectedCanJoinCall = Boolean(
    selectedThread &&
      selectedScheduledCall &&
      isActiveConversationOrder(selectedThread.order, data.userId) &&
      selectedCallLifecycle?.status === 'active' &&
      !selectedCallPaymentBlocked
  )
  const selectedCallHref = selectedThread
    ? accountRoute(
        `/account/call-join?orderId=${encodeURIComponent(selectedThread.order.id)}&callKind=${selectedCallKind}&callType=${selectedCallType}`
      )
    : null

  useEffect(() => {
    setMessageTranslations({})
    setShowOriginalTranslationIds(new Set())
    setTranslationFailedIds(new Set())
  }, [translationPreference.sourceLanguage, translationPreference.targetLanguage])

  useEffect(() => {
    if (!selectedOrderId) {
      setTranslationAvailable(false)
      return
    }
    let active = true
    setTranslationAvailable(false)
    setTranslationError(null)
    void Promise.all([
      invokeAccountFunction<{ preference?: ConversationTranslationPreference }>(
        'message-translation',
        {
          action: 'settings',
          orderId: selectedOrderId,
        }
      ),
      invokeAccountFunction<{ languages?: TranslationLanguage[] }>('message-translation', {
        action: 'languages',
        orderId: selectedOrderId,
      }),
    ])
      .then(([settings, languageResult]) => {
        if (!active) return
        setTranslationAvailable(true)
        if (settings.preference) setTranslationPreference(settings.preference)
        if (languageResult.languages?.length) setTranslationLanguages(languageResult.languages)
      })
      .catch((error) => {
        if (!active) return
        setTranslationAvailable(false)
        setTranslationError(
          friendlyActionError(
            error,
            'Message translation is unavailable right now. Your original messages are unchanged.'
          )
        )
      })
    return () => {
      active = false
    }
  }, [selectedOrderId])

  const saveTranslationPreference = useCallback(
    async (next: ConversationTranslationPreference) => {
      if (!selectedOrderId) return
      const previous = translationPreference
      setTranslationPreference(next)
      setTranslationSettingsBusy(true)
      setTranslationError(null)
      try {
        const result = await invokeAccountFunction<{
          preference?: ConversationTranslationPreference
        }>('message-translation', {
          action: 'update-settings',
          orderId: selectedOrderId,
          ...next,
        })
        if (result.preference) setTranslationPreference(result.preference)
      } catch (error) {
        setTranslationPreference(previous)
        setTranslationError(friendlyActionError(error, 'Could not save translation settings.'))
      } finally {
        setTranslationSettingsBusy(false)
      }
    },
    [selectedOrderId, translationPreference]
  )

  const translateAccountMessage = useCallback(
    async (message: AccountMessage, announceError: boolean) => {
      if (
        !selectedOrderId ||
        message.type !== 'TEXT' ||
        message.is_deleted ||
        !message.body ||
        parseScheduledOrderCallMessage(message.body)
      )
        return
      if (messageTranslations[message.id] || translationLoadingIds.has(message.id)) return
      if (announceError) {
        setTranslationFailedIds((current) => {
          const next = new Set(current)
          next.delete(message.id)
          return next
        })
      } else if (translationFailedIds.has(message.id)) {
        return
      }
      setTranslationLoadingIds((current) => new Set(current).add(message.id))
      try {
        const result = await Promise.race([
          invokeAccountFunction<{ translation?: MessageTranslation }>('message-translation', {
            action: 'translate',
            orderId: selectedOrderId,
            messageId: message.id,
            targetLanguage: translationPreference.targetLanguage,
            sourceLanguage: translationPreference.sourceLanguage,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Translation took too long. Please try again.')),
              20_000
            )
          }),
        ])
        if (!result.translation) throw new Error('This message could not be translated right now.')
        setMessageTranslations((current) => ({ ...current, [message.id]: result.translation! }))
        setShowOriginalTranslationIds((current) => {
          const next = new Set(current)
          next.delete(message.id)
          return next
        })
      } catch (error) {
        setTranslationFailedIds((current) => new Set(current).add(message.id))
        if (announceError)
          setTranslationError(
            friendlyActionError(error, 'This message could not be translated right now.')
          )
      } finally {
        setTranslationLoadingIds((current) => {
          const next = new Set(current)
          next.delete(message.id)
          return next
        })
      }
    },
    [
      messageTranslations,
      selectedOrderId,
      translationFailedIds,
      translationLoadingIds,
      translationPreference.sourceLanguage,
      translationPreference.targetLanguage,
    ]
  )

  useEffect(() => {
    if (!translationAvailable || !translationPreference.autoTranslate) return
    selectedMessages
      .filter(
        (message) =>
          message.sender_id !== data.userId &&
          message.type === 'TEXT' &&
          !message.is_deleted &&
          !!message.body &&
          !parseScheduledOrderCallMessage(message.body) &&
          !messageTranslations[message.id] &&
          !translationFailedIds.has(message.id) &&
          !translationLoadingIds.has(message.id)
      )
      .slice(-30)
      .forEach((message) => {
        void translateAccountMessage(message, false)
      })
  }, [
    data.userId,
    messageTranslations,
    selectedMessages,
    translateAccountMessage,
    translationAvailable,
    translationFailedIds,
    translationLoadingIds,
    translationPreference.autoTranslate,
  ])
  const selectedMessageGroups = useMemo(
    () =>
      groupMessageMediaClusters(
        selectedMessages.map((message) => ({
          ...message,
          sender_id: message.sender_id ?? '',
        }))
      ),
    [selectedMessages]
  )
  const selectedConversationPositions = useMemo(() => {
    const clusterable = selectedMessages.map((message) => ({
      ...message,
      sender_id: message.sender_id ?? '',
    }))
    return new Map(
      selectedMessages.map((message, index) => [
        message.id,
        conversationClusterPositionForMessage(clusterable, index),
      ])
    )
  }, [selectedMessages])
  const selectedOrderEvents = useMemo(
    () =>
      selectedThread
        ? data.orderEvents.filter((event) => event.order_id === selectedThread.order.id)
        : [],
    [data.orderEvents, selectedThread]
  )
  const conversationItems = useMemo(() => {
    const messageItems = selectedMessageGroups.map((group) => ({
      kind: 'messages' as const,
      key: group.map((message) => message.id).join(':'),
      createdAt: group.at(-1)?.created_at ?? null,
      group,
    }))
    const eventItems = selectedOrderEvents.map((event) => ({
      kind: 'event' as const,
      key: `event:${event.id}`,
      createdAt: event.created_at,
      event,
    }))
    return [...messageItems, ...eventItems].sort(
      (left, right) => timestampMs(left.createdAt) - timestampMs(right.createdAt)
    )
  }, [selectedMessageGroups, selectedOrderEvents])
  const messageVirtualizer = useVirtualizer({
    count: conversationItems.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: (index) => {
      const item = conversationItems[index]
      if (!item) return 86
      if (item.kind === 'event') return 122
      const group = item.group
      const message = group.at(-1)
      if (group.length > 1) return 390
      if (message?.voice_url) return 112
      if (message?.photo_url) return 300
      return 86
    },
    getItemKey: (index) => conversationItems[index]?.key ?? index,
    overscan: 8,
  })

  useEffect(() => {
    if (!selectedOrderId || conversationItems.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      const requestedIndex = requestedEventId
        ? conversationItems.findIndex(
            (item) => item.kind === 'event' && item.event.id === requestedEventId
          )
        : -1
      messageVirtualizer.scrollToIndex(
        requestedIndex >= 0 ? requestedIndex : conversationItems.length - 1,
        { align: requestedIndex >= 0 ? 'center' : 'end' }
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [conversationItems, messageVirtualizer, requestedEventId, selectedOrderId])
  const selectedUnreadIds = selectedMessages
    .filter(
      (message) =>
        data.userId &&
        message.sender_id !== data.userId &&
        !message.read_at &&
        !localReadIds.has(message.id)
    )
    .map((message) => message.id)
  const selectedUnreadKey = selectedUnreadIds.join('|')
  const unreadMessageIds = useMemo(() => {
    if (!data.userId) return []
    return liveMessages
      .filter(
        (message) =>
          message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id)
      )
      .map((message) => message.id)
  }, [data.userId, liveMessages, localReadIds])
  const totalUnread = unreadMessageIds.length

  useEffect(() => {
    if (!data.userId || !selectedUnreadKey) return
    const ids = selectedUnreadKey.split('|').filter((id) => id && !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    const supabase = createClient()
    void supabase
      .from('messages')
      .update({ read_at: now })
      .in('id', ids)
      .then(({ error }) => {
        if (error) {
          ids.forEach((id) => markedReadRef.current.delete(id))
          setLocalReadIds((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
          })
          return
        }
        onRefresh()
      })
  }, [data.userId, onRefresh, selectedUnreadKey])

  async function markAllRead() {
    if (!data.userId || unreadMessageIds.length === 0 || markingAllRead) return
    const ids = unreadMessageIds.filter((id) => !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    setMarkingAllRead(true)
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    try {
      const supabase = createClient()
      const { error } = await supabase.from('messages').update({ read_at: now }).in('id', ids)
      if (error) throw error
      onRefresh()
    } catch (readError) {
      console.warn('[messages] Mark all read failed.', readError)
      ids.forEach((id) => markedReadRef.current.delete(id))
      setLocalReadIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } finally {
      setMarkingAllRead(false)
    }
  }

  function openQuoteRevisionDialog(editing: boolean) {
    setConversationActionError(null)
    setEditingRevision(editing)
    setRevisionReasons(
      editing && selectedOpenRevision?.reason_codes.length
        ? selectedOpenRevision.reason_codes
        : ['PRICE']
    )
    setRevisionNote(editing ? (selectedOpenRevision?.note ?? '') : '')
    setRevisionTargetAmount(
      editing && selectedOpenRevision?.target_amount
        ? String(selectedOpenRevision.target_amount / 100)
        : ''
    )
    setRevisionDialogOpen(true)
  }

  async function submitQuoteRevision() {
    if (!selectedThread || !selectedActiveQuote) return
    if (revisionNote.trim().length < 10) {
      setConversationActionError('Add at least 10 characters explaining what should change.')
      return
    }
    const targetAmount = revisionTargetAmount.trim() ? parseMinorUnits(revisionTargetAmount) : null
    if (revisionTargetAmount.trim() && targetAmount === null) {
      setConversationActionError('Enter a valid target amount or leave it blank.')
      return
    }

    setConversationActionBusy(true)
    setConversationActionError(null)
    try {
      await invokeAccountFunction('customer-order-action', {
        action: editingRevision ? 'edit-quote-revision' : 'request-quote-revision',
        orderId: selectedThread.order.id,
        quoteId: selectedActiveQuote.id,
        expectedQuoteVersion: selectedActiveQuote.version,
        ...(editingRevision && selectedOpenRevision
          ? { revisionRequestId: selectedOpenRevision.id }
          : {}),
        quoteRevisionReasons: revisionReasons,
        quoteRevisionNote: revisionNote.trim(),
        quoteTargetAmount: targetAmount,
      })
      setRevisionDialogOpen(false)
      onRefresh()
    } catch (actionError) {
      setConversationActionError(
        friendlyActionError(
          actionError,
          'The quote change request could not be saved. Refresh the conversation and try again.'
        )
      )
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function handleConversationAction(action: OrderConversationAction) {
    if (!selectedThread) return
    setConversationActionError(null)

    if (action.kind === 'REQUEST_QUOTE_CHANGES') {
      openQuoteRevisionDialog(false)
      return
    }
    if (action.kind === 'EDIT_QUOTE_CHANGE_REQUEST') {
      openQuoteRevisionDialog(true)
      return
    }
    if (action.kind === 'ACCEPT_AND_PAY') {
      router.push(accountRoute(`/account/checkout?orderId=${selectedThread.order.id}`))
      return
    }
    if (action.kind === 'VIEW_QUOTE') {
      router.push(accountRoute(`/account/orders/${selectedThread.order.id}`))
      return
    }

    if (action.kind === 'WITHDRAW_QUOTE_CHANGE_REQUEST' || action.kind === 'KEEP_CURRENT_QUOTE') {
      if (!selectedActiveQuote || !selectedOpenRevision) {
        setConversationActionError(
          'The quote changed. Refresh this conversation before taking that action.'
        )
        return
      }
      setConversationActionBusy(true)
      try {
        await invokeAccountFunction(
          action.kind === 'WITHDRAW_QUOTE_CHANGE_REQUEST'
            ? 'customer-order-action'
            : 'tailor-order-action',
          {
            action:
              action.kind === 'WITHDRAW_QUOTE_CHANGE_REQUEST'
                ? 'withdraw-quote-revision'
                : 'keep-current-quote',
            orderId: selectedThread.order.id,
            quoteId: selectedActiveQuote.id,
            expectedQuoteVersion: selectedActiveQuote.version,
            revisionRequestId: selectedOpenRevision.id,
          }
        )
        onRefresh()
      } catch (actionError) {
        setConversationActionError(
          friendlyActionError(
            actionError,
            'The order action could not be completed. Refresh the conversation and try again.'
          )
        )
      } finally {
        setConversationActionBusy(false)
      }
      return
    }

    router.push(accountRoute(`/account/orders/${selectedThread.order.id}`))
  }

  async function toggleMessageReaction(message: AccountMessage, emoji: string) {
    if (!data.userId) return
    const existing = liveReactions.find(
      (reaction) =>
        reaction.message_id === message.id &&
        reaction.user_id === data.userId &&
        reaction.emoji === emoji
    )
    const supabase = createClient()

    if (existing) {
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(existing.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== existing.id),
        }
      })
      const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
      if (error) {
        console.warn('[messages] Reaction delete failed.', error.message)
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.delete(existing.id)
          return {
            deletedIds,
            upserts: [
              ...current.upserts.filter((reaction) => reaction.id !== existing.id),
              existing,
            ],
          }
        })
      }
      return
    }

    const tempReaction: AccountMessageReaction = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `local-${Date.now()}`,
      message_id: message.id,
      order_id: message.order_id,
      user_id: data.userId,
      emoji,
      created_at: new Date().toISOString(),
    }
    setReactionPatchState((current) => ({
      deletedIds: new Set([...current.deletedIds].filter((id) => id !== tempReaction.id)),
      upserts: [...current.upserts, tempReaction],
    }))
    const { data: inserted, error } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        order_id: message.order_id,
        user_id: data.userId,
        emoji,
      })
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .single()

    if (error) {
      console.warn('[messages] Reaction insert failed.', error.message)
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(tempReaction.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== tempReaction.id),
        }
      })
      return
    }
    setReactionPatchState((current) => {
      const insertedReaction = inserted as AccountMessageReaction
      const deletedIds = new Set(current.deletedIds)
      deletedIds.add(tempReaction.id)
      deletedIds.delete(insertedReaction.id)
      return {
        deletedIds,
        upserts: [
          ...current.upserts.filter(
            (reaction) => reaction.id !== tempReaction.id && reaction.id !== insertedReaction.id
          ),
          insertedReaction,
        ],
      }
    })
  }

  async function handleUnsend(message: AccountMessage) {
    try {
      await invokeAccountFunction('message-action', { action: 'unsend', messageId: message.id })
    } catch (err) {
      const msg = friendlyActionError(err, 'Could not unsend this message. Please try again.')
      if (/15 minutes/i.test(msg)) {
        alert('Messages can only be unsent within 15 minutes of sending.')
      } else {
        alert(msg)
      }
    }
  }

  function renderMessageBubble(
    message: AccountMessage,
    mediaCluster: AccountMessage[] = [message]
  ) {
    const mine = message.sender_id === data.userId
    const isDeleted = Boolean(message.is_deleted)
    const replyTarget = message.reply_to_id
      ? (selectedMessages.find((candidate) => candidate.id === message.reply_to_id) ?? null)
      : null
    const isHovered = hoveredMessageId === message.id
    const canUnsend =
      mine &&
      !isDeleted &&
      (() => {
        const sentAt = parseDateValue(message.created_at)
        return sentAt ? Date.now() - sentAt.getTime() < 15 * 60 * 1000 : false
      })()
    const canEdit = mine && !isDeleted && message.type === 'TEXT'
    const isVoiceMessage = !isDeleted && (message.type === 'VOICE' || Boolean(message.voice_url))
    const hasMedia = Boolean(message.photo_url)
    const scheduledCallMessage =
      message.type === 'TEXT' && !isDeleted ? parseScheduledOrderCallMessage(message.body) : null
    const translation = messageTranslations[message.id] ?? null
    const showingOriginal = showOriginalTranslationIds.has(message.id)
    const canTranslate =
      !mine &&
      !isDeleted &&
      message.type === 'TEXT' &&
      !!message.body &&
      !scheduledCallMessage
    const clusterPosition = selectedConversationPositions.get(message.id) ?? 'isolated'
    const showsTail = clusterPosition === 'isolated' || clusterPosition === 'end'
    const clusterShape = mine
      ? clusterPosition === 'start'
        ? 'rounded-br-[8px]'
        : clusterPosition === 'middle'
          ? 'rounded-r-[8px]'
          : clusterPosition === 'end'
            ? 'rounded-tr-[8px] rounded-br-[5px]'
            : 'rounded-br-[5px]'
      : clusterPosition === 'start'
        ? 'rounded-bl-[8px]'
        : clusterPosition === 'middle'
          ? 'rounded-l-[8px]'
          : clusterPosition === 'end'
            ? 'rounded-tl-[8px] rounded-bl-[5px]'
            : 'rounded-bl-[5px]'

    return (
      <div
        className={`group relative flex w-full px-3 ${clusterPosition === 'isolated' || clusterPosition === 'start' ? 'pt-2' : 'pt-0.5'} pb-0.5 sm:px-5 ${mine ? 'justify-end' : 'justify-start'}`}
        onMouseEnter={() => setHoveredMessageId(message.id)}
        onMouseLeave={() => setHoveredMessageId(null)}
      >
        {isHovered && !isDeleted ? (
          <div
            className={`absolute top-2 z-10 flex items-center gap-1 rounded-[8px] border border-ui-border bg-white p-1 shadow-md ${mine ? 'right-[calc(min(76%,42rem)+1.75rem)]' : 'left-[calc(min(76%,42rem)+1.75rem)]'}`}
          >
            <IconButton
              size="icon-sm"
              variant="ghost"
              label="Reply"
              onClick={() => setReplyingTo(message)}
            >
              <Reply />
            </IconButton>
            {canTranslate ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label="Translate message"
                disabled={translationLoadingIds.has(message.id)}
                onClick={() => {
                  void translateAccountMessage(message, true)
                }}
              >
                {translationLoadingIds.has(message.id) ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Languages />
                )}
              </IconButton>
            ) : null}
            {canEdit ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label="Edit message"
                onClick={() => setEditingMessage(message)}
              >
                <Pencil />
              </IconButton>
            ) : null}
            {canUnsend ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label="Unsend message"
                className="text-rust hover:text-rust"
                onClick={() => {
                  void handleUnsend(message)
                }}
              >
                <Trash2 />
              </IconButton>
            ) : null}
          </div>
        ) : null}

        <div
          className={`relative text-xs leading-4 ${isVoiceMessage || scheduledCallMessage ? 'w-[18rem] max-w-[72%]' : hasMedia ? 'w-[20rem] max-w-[72%]' : 'w-fit max-w-[62%]'} min-w-0 rounded-[14px] px-2.5 py-1.5 ${clusterShape} ${mine ? 'bg-gradient-to-b from-needle to-[#12694d]' : 'bg-[#eef0ed]'} ${isDeleted ? 'opacity-60' : ''}`}
        >
          {showsTail ? (
            <span
              aria-hidden="true"
              className={`absolute bottom-1 h-3 w-3 rotate-45 ${mine ? '-right-1 bg-[#12694d]' : '-left-1 bg-[#eef0ed]'}`}
            />
          ) : null}
          {replyTarget ? (
            <div
              className={`mb-2 rounded-[6px] border-l-2 px-2 py-1.5 ${mine ? 'border-white/35 bg-white/10' : 'border-needle/45 bg-ui-muted'}`}
            >
              <p
                className={`text-[0.68rem] font-semibold ${mine ? 'text-white/78' : 'text-ink/62'}`}
              >
                {replyTarget.sender_name ?? 'Unknown'}
              </p>
              <p
                className={`line-clamp-2 text-xs leading-4 ${mine ? 'text-white/62' : 'text-ui-subtle'}`}
              >
                {replyTarget.is_deleted
                  ? 'This message was unsent.'
                  : replyTarget.type === 'PHOTO'
                    ? 'Photo attachment'
                    : replyTarget.type === 'VOICE'
                      ? 'Voice note'
                      : safeUserText(replyTarget.body, '')}
              </p>
            </div>
          ) : null}

          {isDeleted ? (
            <p className={`text-sm italic leading-6 ${mine ? 'text-white/64' : 'text-ui-subtle'}`}>
              This message was unsent.
            </p>
          ) : (
            <div
              className={mine ? '[&_p]:text-white/92 [&_a]:text-white [&_audio]:opacity-90' : ''}
            >
              {scheduledCallMessage ? (
                <div
                  className="grid gap-2"
                  aria-label={`Order call scheduled for ${scheduledCallMessage.scheduledFor}`}
                >
                  <div
                    className={`flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] ${mine ? 'text-white/82' : 'text-needle'}`}
                  >
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Order call scheduled
                  </div>
                  <p
                    className={`text-sm font-semibold leading-5 ${mine ? 'text-white' : 'text-ink'}`}
                  >
                    {safeUserText(scheduledCallMessage.scheduledFor, '')}
                  </p>
                  <dl
                    className={`divide-y ${mine ? 'divide-white/18 border-white/20' : 'divide-ink/8 border-ink/10'} border-y`}
                  >
                    <div className="grid grid-cols-[auto_1fr] gap-4 py-2">
                      <dt
                        className={`text-xs font-semibold ${mine ? 'text-white/68' : 'text-ink/48'}`}
                      >
                        Reason
                      </dt>
                      <dd
                        className={`text-right text-sm font-semibold ${mine ? 'text-white' : 'text-ink'}`}
                      >
                        {safeUserText(scheduledCallMessage.reason, '')}
                      </dd>
                    </div>
                  </dl>
                  {scheduledCallMessage.note ? (
                    <div
                      className={`rounded-[8px] px-3 py-2 ${mine ? 'bg-white/12' : 'bg-white/80'}`}
                    >
                      <p
                        className={`text-xs font-semibold ${mine ? 'text-white/68' : 'text-ink/48'}`}
                      >
                        Note
                      </p>
                      <p className={`mt-0.5 text-sm leading-5 ${mine ? 'text-white' : 'text-ink'}`}>
                        {safeUserText(scheduledCallMessage.note, '')}
                      </p>
                    </div>
                  ) : null}
                  <p
                    className={`text-[0.68rem] leading-4 ${mine ? 'text-white/68' : 'text-ink/46'}`}
                  >
                    Free in Drapeon · Keep decisions in chat
                  </p>
                </div>
              ) : mediaCluster.length > 1 ? (
                <MessageMediaMosaic messages={mediaCluster} onReply={setReplyingTo} />
              ) : translation && message.type === 'TEXT' ? (
                <div className="grid gap-1.5">
                  <p className="whitespace-pre-wrap break-words text-xs leading-4 text-ink/72">
                    {showingOriginal ? safeUserText(message.body, '') : translation.translatedText}
                  </p>
                  <button
                    type="button"
                    className={`inline-flex w-fit cursor-pointer items-center gap-1 text-[0.68rem] font-semibold transition-colors ${mine ? 'text-white/72 hover:text-white' : 'text-needle/75 hover:text-needle'}`}
                    onClick={() =>
                      setShowOriginalTranslationIds((current) => {
                        const next = new Set(current)
                        if (next.has(message.id)) next.delete(message.id)
                        else next.add(message.id)
                        return next
                      })
                    }
                  >
                    <Languages className="size-3" aria-hidden="true" />
                    {showingOriginal
                      ? `View ${languageName(translation.targetLanguage)} translation`
                      : `Translated from ${languageName(translation.sourceLanguage)} · View original`}
                  </button>
                </div>
              ) : (
                <MessageContent message={message} />
              )}
            </div>
          )}

          {canTranslate && !translation ? (
            <button type="button" disabled={translationLoadingIds.has(message.id)} onClick={() => { void translateAccountMessage(message, true) }} className={`mt-1 inline-flex items-center gap-1 text-[0.68rem] font-semibold ${mine ? 'text-white/72' : 'text-needle'}`}>
              {translationLoadingIds.has(message.id) ? <LoaderCircle className="size-3 animate-spin" /> : <Languages className="size-3" />}
              {translationLoadingIds.has(message.id) ? 'Translating…' : 'Translate'}
            </button>
          ) : null}
          <div
            className={`mt-1 flex items-center justify-end gap-1 text-[0.62rem] ${mine ? 'text-white/58' : 'text-ink/38'}`}
            title={parseDateValue(message.created_at)?.toISOString()}
          >
            {!isDeleted ? <MessageReactionBar reactions={reactionsByMessageId.get(message.id) ?? []} userId={data.userId} mine={mine} open={openReactionMessageId === message.id} onOpenChange={(open) => setOpenReactionMessageId(open ? message.id : null)} onToggle={(emoji) => { void toggleMessageReaction(message, emoji) }} /> : null}
            {message.edited_at && !isDeleted ? <span className="italic">edited</span> : null}
            <span>{formatMessageRelative(message.created_at)}</span>
            {mine ? (
              <CheckCheck
                className={`size-3.5 ${message.read_at ? 'opacity-100' : 'opacity-55'}`}
                aria-label={message.read_at ? 'Read' : 'Sent'}
              />
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="grid gap-4 py-3 lg:pt-0">
        <section className="app-surface p-4">
          <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Messages</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-3xl">
            Order conversations stay protected.
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/64">
            Calls, photos, decisions, and notes appear here only after an order conversation exists.
          </p>
        </section>
        <EmptyState
          title="No conversations yet."
          body="Start with Explore or review an existing order. A conversation opens when there is real work to discuss."
          action={
            <div className="flex flex-wrap gap-3">
              <Button asChild size="sm">
                <Link href="/account/explore">Explore tailors</Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href="/account/orders">View orders</Link>
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm lg:flex lg:h-[calc(100vh-2rem)]">
      <h1 className="sr-only">Order conversations</h1>

      {/* ── Sidebar ── */}
      {!sidebarCollapsed ? (
        <aside className="flex w-full shrink-0 flex-col border-b border-ink/8 lg:w-72 lg:border-b-0 lg:border-r">
          {/* Search + filters */}
          <div className="border-b border-ink/8 p-3">
            <label className="sr-only" htmlFor="message-search">
              Search conversations
            </label>
            <Input
              id="message-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-ui-canvas"
              placeholder="Search conversations"
            />
            <div className="mt-2 flex gap-1">
              {(['active', 'completed', 'archived'] as const).map((key) => {
                const unreadCounts = {
                  active: activeThreads.reduce((sum, t) => sum + t.unread, 0),
                  completed: completedThreads.reduce((sum, t) => sum + t.unread, 0),
                  archived: archivedThreads.reduce((sum, t) => sum + t.unread, 0),
                }
                const labels = { active: 'Active', completed: 'Done', archived: 'Archived' }
                return (
                  <Button
                    key={key}
                    onClick={() => {
                      setFilter(key)
                      setSelectedOrderId(null)
                    }}
                    variant={filter === key ? 'primary' : 'ghost'}
                    size="sm"
                    className="relative flex-1 text-xs"
                  >
                    {labels[key]}
                    {unreadCounts[key] > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rust text-[0.6rem] font-bold text-white">
                        {unreadCounts[key] > 9 ? '9+' : unreadCounts[key]}
                      </span>
                    ) : null}
                  </Button>
                )
              })}
            </div>
            {notificationPermission === 'default' ? (
              <div className="mt-2">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    void requestNotifications()
                  }}
                >
                  <BellRing /> Enable alerts
                </Button>
              </div>
            ) : null}
          </div>

          {/* Grouped conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="p-4 text-sm text-ink/48">
                {search ? 'No conversations match.' : 'Nothing here.'}
              </p>
            ) : (
              groups.map((group) => {
                const isExpanded = expandedGroupKeys.has(group.key) || group.threads.length === 1
                const groupActive = group.threads.some(
                  (t) => t.order.id === selectedThread?.order.id
                )
                return (
                  <div key={group.key}>
                    {/* Group header row */}
                    <button
                      type="button"
                      onClick={() => {
                        if (group.threads.length === 1) {
                          setSelectedOrderId(group.threads[0]!.order.id)
                        } else {
                          setExpandedGroupKeys((prev) => {
                            const next = new Set(prev)
                            if (next.has(group.key)) next.delete(group.key)
                            else next.add(group.key)
                            return next
                          })
                          if (!isExpanded) setSelectedOrderId(group.threads[0]!.order.id)
                        }
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${groupActive && group.threads.length === 1 ? 'bg-needle/8' : 'hover:bg-ink/4'}`}
                    >
                      <div className="relative shrink-0">
                        <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-needle/14 text-sm font-semibold text-needle">
                          {group.avatarSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={group.avatarSrc}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            initialsForName(group.name)
                          )}
                        </div>
                        {group.unread > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-0.5 text-[0.6rem] font-bold text-white">
                            {group.unread > 9 ? '9+' : group.unread}
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={`truncate text-sm ${group.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink'}`}
                          >
                            {group.name}
                          </p>
                          <p className="shrink-0 text-[0.65rem] text-ink/38">
                            {formatMessageRelative(group.latestPreview?.created_at ?? null)}
                          </p>
                        </div>
                        <p
                          className={`mt-0.5 truncate text-xs ${group.unread > 0 ? 'font-semibold text-ink/80' : 'text-ink/44'}`}
                        >
                          {group.threads.length > 1
                            ? `${group.threads.length} orders`
                            : group.latestPreview
                              ? safeUserText(
                                  group.latestPreview.body,
                                  group.latestPreview.photo_url || group.latestPreview.voice_url
                                    ? 'Sent media'
                                    : 'No messages yet'
                                )
                              : 'No messages yet'}
                        </p>
                      </div>
                      {group.threads.length > 1 ? (
                        isExpanded ? (
                          <ChevronUp className="size-4 shrink-0 text-ui-subtle" />
                        ) : (
                          <ChevronDown className="size-4 shrink-0 text-ui-subtle" />
                        )
                      ) : null}
                    </button>

                    {/* Sub-threads (shown when group expanded and has >1 order) */}
                    {isExpanded && group.threads.length > 1
                      ? group.threads.map((thread) => {
                          const subActive = thread.order.id === selectedThread?.order.id
                          return (
                            <button
                              key={thread.order.id}
                              type="button"
                              onClick={() => setSelectedOrderId(thread.order.id)}
                              className={`flex w-full items-center gap-2 border-l-2 py-2 pl-16 pr-3 text-left transition ${subActive ? 'border-needle bg-needle/6' : 'border-ink/8 hover:bg-ink/4'}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`truncate text-xs font-semibold ${subActive ? 'text-needle' : 'text-ink/70'}`}
                                >
                                  {orderTitle(thread.order)}
                                </p>
                                <StatusChip
                                  status={thread.order.stage}
                                  fallback="Order"
                                  className="mt-1 py-0 text-[0.6rem]"
                                />
                              </div>
                              {thread.unread > 0 ? (
                                <span className="shrink-0 rounded-full bg-rust px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
                                  {thread.unread}
                                </span>
                              ) : null}
                            </button>
                          )
                        })
                      : null}
                  </div>
                )
              })
            )}
            {totalUnread > 0 ? (
              <div className="border-t border-ink/6 p-3">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    void markAllRead()
                  }}
                  disabled={markingAllRead}
                >
                  <CheckCheck />
                  {markingAllRead ? 'Marking...' : 'Mark all read'}
                </Button>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* ── Chat pane ── */}
      {!selectedThread ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-needle/10 text-needle">
              <MessageSquareText className="size-6" />
            </div>
            <p className="text-sm font-semibold text-ink">Pick a conversation</p>
            <p className="mt-1 text-xs text-ink/44">Select a thread from the list to open it.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-needle/10 bg-needle/6 px-3 py-2.5">
            {/* Collapse toggle */}
            <IconButton
              label={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
              onClick={() => setSidebarCollapsed((v) => !v)}
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 lg:inline-flex"
            >
              {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
            {/* Avatar + name */}
            {(() => {
              const name = partyName(selectedThread.order, data.userId)
              const avatarSrc = partyAvatar(selectedThread.order, data.userId)
              return (
                <>
                  <div
                    className="relative h-8 w-8 shrink-0"
                    aria-label={counterpartyPresence.online ? `${name} is online` : undefined}
                  >
                    <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-needle/14 text-xs font-semibold text-needle">
                      {avatarSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsForName(name)
                      )}
                    </div>
                    {counterpartyPresence.online ? (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#eef7f1] bg-needle"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    <p className="truncate text-xs text-ink/44">
                      {orderTitle(selectedThread.order)}
                    </p>
                  </div>
                </>
              )
            })()}
            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              {translationAvailable ? (
                <details className="relative">
                  <summary
                    className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-needle/12 bg-white/75 px-3 text-xs font-semibold text-needle transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
                    aria-label={`Translation settings. Current language: ${languageName(translationPreference.targetLanguage, translationLanguages)}`}
                  >
                    <Languages className="size-4" aria-hidden="true" />
                    <span className="hidden xl:inline">
                      Translate · {languageName(translationPreference.targetLanguage, translationLanguages)}
                    </span>
                  </summary>
                  <div className="absolute right-0 top-11 z-40 grid w-72 gap-3 rounded-[8px] border border-ui-border bg-white p-4 shadow-xl">
                    <div>
                      <p className="text-sm font-semibold text-ink">Message translation</p>
                      <p className="mt-1 text-xs leading-5 text-ink/52">
                        Original messages stay available for order and safety records.
                      </p>
                    </div>
                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-[8px] bg-needle/5 p-3">
                      <span>
                        <span className="block text-sm font-semibold text-ink">
                          Always translate this conversation
                        </span>
                        <span className="mt-0.5 block text-xs leading-4 text-ink/52">
                          Translate incoming text automatically.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={translationPreference.autoTranslate}
                        disabled={translationSettingsBusy}
                        onChange={(event) => {
                          void saveTranslationPreference({
                            ...translationPreference,
                            autoTranslate: event.target.checked,
                          })
                        }}
                        className="mt-1 size-4 accent-needle"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold text-ink/62">
                      Translate messages to
                      <select
                        value={translationPreference.targetLanguage}
                        disabled={translationSettingsBusy}
                        onChange={(event) => {
                          void saveTranslationPreference({
                            ...translationPreference,
                            targetLanguage: event.target.value,
                          })
                        }}
                        className="min-h-10 cursor-pointer rounded-[8px] border border-ui-border bg-white px-3 text-sm font-medium text-ink outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
                      >
                        {translationLanguages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold text-ink/62">
                      Message language
                      <select
                        value={translationPreference.sourceLanguage ?? ''}
                        disabled={translationSettingsBusy}
                        onChange={(event) => {
                          void saveTranslationPreference({
                            ...translationPreference,
                            sourceLanguage: event.target.value || null,
                          })
                        }}
                        className="min-h-10 cursor-pointer rounded-[8px] border border-ui-border bg-white px-3 text-sm font-medium text-ink outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
                      >
                        <option value="">Detect automatically</option>
                        {translationLanguages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="rounded-[8px] bg-ui-muted px-3 py-2 text-[0.68rem] leading-4 text-ink/52">
                      Choose the language you want to read. Detection is automatic; dialects such
                      as Nigerian Pidgin may be less exact.
                    </p>
                  </div>
                </details>
              ) : null}
              {selectedCanJoinCall && selectedCallHref ? (
                <Button asChild size="sm">
                  <Link href={selectedCallHref}>
                    <Video /> Join {selectedCallType} call
                  </Link>
                </Button>
              ) : null}
              {selectedThread.completed || selectedThread.archived ? <Button
                variant="ghost"
                size="sm"
                onClick={() => setThreadArchived(selectedThread.order.id, !selectedThread.archived)}
                className="text-ui-subtle"
              >
                {selectedThread.archived ? <ArchiveRestore /> : <Archive />}
                <span className="hidden xl:inline">
                  {selectedThread.archived ? 'Unarchive' : 'Archive'}
                </span>
              </Button> : null}
              <Button asChild size="sm" variant={selectedCanJoinCall ? 'outline' : 'primary'}>
                <Link href={`/account/orders/${selectedThread.order.id}`}>
                  <ClipboardList /> Order
                </Link>
              </Button>
            </div>
          </div>

          {translationError ? (
            <div
              className="border-b border-rust/12 bg-rust/6 px-4 py-2 text-xs font-medium text-rust"
              role="status"
            >
              {translationError}
            </div>
          ) : null}

          {/* Messages area */}
          <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto bg-ui-canvas/70 py-3">
            {conversationItems.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="rounded-[8px] border border-ui-border bg-white px-5 py-4 text-sm leading-6 text-ui-subtle">
                  No messages yet.
                </p>
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{ height: messageVirtualizer.getTotalSize() }}
              >
                {messageVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = conversationItems[virtualRow.index]
                  if (!item) return null
                  return (
                    <div
                      key={item.key}
                      ref={messageVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {item.kind === 'event' ? (
                        <OrderConversationEventCard event={item.event} />
                      ) : (
                        (() => {
                          const message = item.group.at(-1)
                          return message ? renderMessageBubble(message, item.group) : null
                        })()
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Typing indicator */}
          {counterpartyIsTyping ? (
            <div className="border-t border-ink/8 px-4 py-1.5">
              <p className="text-xs italic text-ink/44">
                {partyName(selectedThread.order, data.userId)} is typing…
              </p>
            </div>
          ) : null}

          {conversationActionError && !revisionDialogOpen ? (
            <div className="border-t border-rust/18 bg-rust/6 px-4 py-2 text-sm text-rust">
              {conversationActionError}
            </div>
          ) : null}

          {/* Reply preview bar */}
          {replyingTo ? (
            <div className="flex items-center gap-2 border-t border-needle/20 bg-needle/6 px-4 py-2">
              <div className="flex-1 overflow-hidden">
                <p className="text-[0.65rem] font-semibold text-needle">
                  {replyingTo.sender_name ?? 'Unknown'}
                </p>
                <p className="truncate text-[0.65rem] text-ink/52">
                  {replyingTo.is_deleted
                    ? 'This message was unsent.'
                    : replyingTo.type === 'PHOTO'
                      ? 'Photo'
                      : replyingTo.type === 'VOICE'
                        ? 'Voice note'
                        : safeUserText(replyingTo.body, '')}
                </p>
              </div>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => setReplyingTo(null)}
                label="Cancel reply"
              >
                <X />
              </IconButton>
            </div>
          ) : null}

          {/* Edit mode bar */}
          {editingMessage ? (
            <div className="flex items-center justify-between border-t border-ink/10 bg-bone px-4 py-2">
              <p className="text-xs font-semibold text-ink/52">Editing message</p>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditingMessage(null)}
                label="Cancel edit"
              >
                <X />
              </IconButton>
            </div>
          ) : null}

          {/* Composer */}
          <div className="border-t border-ink/8 bg-white/90 px-3 pb-3 pt-2">
            <MessageComposer
              order={selectedThread.order}
              consultationBooking={selectedConsultationBooking}
              onRefresh={onRefresh}
              channelRef={orderChannelRef}
              replyingTo={replyingTo}
              onClearReply={() => setReplyingTo(null)}
              editingMessage={editingMessage}
              onClearEdit={() => setEditingMessage(null)}
            />
          </div>
          <Dialog open={revisionDialogOpen} onOpenChange={setRevisionDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingRevision ? 'Edit quote change request' : 'Request quote changes'}
                </DialogTitle>
                <DialogDescription>
                  This is a formal revision round. Ordinary questions in chat do not use a round.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-semibold text-ink">What should change?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(QUOTE_REVISION_REASON_LABELS).map(([value, label]) => {
                      const checked = revisionReasons.includes(value)
                      return (
                        <label
                          key={value}
                          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] border border-ui-border px-3 py-2 text-sm text-ink"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setRevisionReasons((current) =>
                                checked
                                  ? current.filter((reason) => reason !== value)
                                  : current.length < 4
                                    ? [...current, value]
                                    : current
                              )
                            }
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <Field
                  label="Change request"
                  hint="Be specific about price, scope, timing, fabric, fulfillment, or fit."
                >
                  <Textarea
                    value={revisionNote}
                    onChange={(event) => setRevisionNote(event.target.value)}
                    rows={5}
                    maxLength={1200}
                  />
                </Field>
                <Field
                  label="Target budget (optional)"
                  hint={`Uses the locked quote currency ${selectedActiveQuote?.currency ?? ''}.`}
                >
                  <Input
                    inputMode="decimal"
                    value={revisionTargetAmount}
                    onChange={(event) => setRevisionTargetAmount(event.target.value)}
                    placeholder="e.g. 85000"
                  />
                </Field>
                {conversationActionError ? (
                  <p className="rounded-[8px] border border-rust/18 bg-rust/6 px-3 py-2 text-sm text-rust">
                    {conversationActionError}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => setRevisionDialogOpen(false)}
                  disabled={conversationActionBusy}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    void submitQuoteRevision()
                  }}
                  disabled={conversationActionBusy || revisionReasons.length === 0}
                >
                  {conversationActionBusy
                    ? 'Saving...'
                    : editingRevision
                      ? 'Save request'
                      : 'Send request'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </section>
  )
}
