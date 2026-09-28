'use client'

import {
  ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
  formatDatabaseEnumLabel,
  formatExplicitZonedDateTime,
  formatRelative,
  parseDateValue,
  parseMoneyInputToMinorUnits,
} from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
import type { Route } from 'next'
import { safeEntityName, safeUserText } from '../../../lib/safe-display'
import { createClient } from '../../../lib/supabase'
import type { AccountOrder, ConsultationBookingSnapshot } from '../shared/account-data-contracts'

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
        booking.fee_mode === 'PAID' ? ('BEFORE_CALL_STARTS' as const) : ('WAIVED_OR_FREE' as const),
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

export const ORDER_CALL_STAGES = new Set([
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

export type OrderSupportMeta = {
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

export function canStartOrderCall(order: AccountOrder) {
  if (order.stage === 'CONSULTATION') return true
  return ORDER_CALL_STAGES.has(order.stage ?? '')
}

export const CUSTOMER_ACTIVE_THREAD_STAGES = new Set([
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

export const TAILOR_ACTIVE_THREAD_STAGES = new Set([
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

export function isActiveConversationOrder(order: AccountOrder, userId: string | null) {
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

export function partyAvatar(order: AccountOrder, userId: string | null) {
  if (order.customer_id === userId) {
    return safeMediaUrl(firstJoinedRow(order.tailor_profiles)?.avatar_url ?? null, 'avatars')
  }
  return safeMediaUrl(firstJoinedRow(order.customer_profiles)?.avatar_url ?? null, 'avatars')
}

export function partyKey(order: AccountOrder, userId: string | null): string {
  return order.customer_id === userId
    ? (order.tailor_profile_id ?? order.tailor_id ?? `_${order.id}`)
    : (order.customer_id ?? `_${order.id}`)
}

export type PublicMediaBucket =
  | 'avatars'
  | 'portfolio-photos'
  | 'seller-item-media'
  | 'review-media'

export const PUBLIC_MEDIA_BUCKETS: PublicMediaBucket[] = [
  'avatars',
  'portfolio-photos',
  'seller-item-media',
  'review-media',
]

export const TRUSTED_EXTERNAL_IMAGE_HOSTS = new Set(['images.unsplash.com'])

export function isPublicMediaBucket(value: string): value is PublicMediaBucket {
  return PUBLIC_MEDIA_BUCKETS.includes(value as PublicMediaBucket)
}

export function runtimeSupabaseUrl() {
  const envUrl =
    process.env.DRAPEON_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (envUrl.trim()) return envUrl.replace(/\/+$/u, '')

  if (typeof window === 'undefined') return ''
  return window.__DRAPEON_PUBLIC_ENV__?.supabaseUrl?.trim().replace(/\/+$/u, '') ?? ''
}

export function encodeStoragePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

export function publicStorageMediaUrl(src: string, fallbackBucket: PublicMediaBucket) {
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

export function initialsForName(value: string | null | undefined) {
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

export function datetimeLocalToIso(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function dateToDatetimeLocal(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export const MESSAGE_MEDIA_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.messageVideo

export const MESSAGE_MEDIA_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.messageVideo

export const MESSAGE_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_MESSAGE_MEDIA_CONTENT_TYPES)

export function extensionBackedMediaContentType(
  file: File,
  allowedContentTypes: ReadonlySet<string>
) {
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

export function prepareMessageMediaFile(file: File) {
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

export async function createMessageMediaSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage.from('message-media').createSignedUrl(storagePath, 3600)
  return data?.signedUrl ?? null
}
