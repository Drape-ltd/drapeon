'use client'

import { parseDateValue } from '@drape/shared'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  isVideoMediaUrl,
} from '@drape/shared/media-policy'
import { OrderStage, canTransition } from '@drape/shared/order-machine'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import {
  MediaViewerOverlay,
  MutedVideo,
  extensionBackedMediaContentType,
  isVideoContentType,
  prepareOperationalMediaFile,
  safeMediaUrl,
} from '../messages/message-foundation'
import type {
  AccountOrder,
  OrderActorData,
  ProductionEvidence,
  StageUpdate,
} from '../shared/account-data-contracts'
export const PRE_CUTTING_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
])

export const SCOPE_CHANGE_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
])

export const SCOPE_CHANGE_TYPE_OPTIONS = [
  { value: 'MEASUREMENT_AMENDMENT', label: 'Measurement amendment' },
  { value: 'STYLE_OR_REFERENCE', label: 'Style or reference' },
  { value: 'FABRIC_OR_MATERIAL', label: 'Fabric or material' },
  { value: 'ADD_OR_REMOVE_ITEM', label: 'Add or remove item' },
  { value: 'DEADLINE_OR_EVENT', label: 'Deadline or event' },
  { value: 'PAUSE_OR_RESTART', label: 'Pause or restart' },
  { value: 'REWORK_OR_ALTERATION', label: 'Rework or alteration' },
  { value: 'OTHER', label: 'Other' },
] as const

export const SCOPE_CHANGE_IMPACT_OPTIONS = [
  { value: 'PRICE', label: 'Price' },
  { value: 'DEADLINE', label: 'Deadline' },
  { value: 'FIT', label: 'Fit' },
  { value: 'FABRIC', label: 'Fabric' },
  { value: 'STYLE', label: 'Style' },
  { value: 'FULFILLMENT', label: 'Fulfillment' },
] as const

export const MATERIAL_ISSUE_REASON_OPTIONS = [
  { value: 'POOR_FABRIC_QUALITY', label: 'Poor fabric quality' },
  { value: 'INSUFFICIENT_YARDAGE', label: 'Insufficient yardage' },
  { value: 'FABRIC_NOT_RECEIVED', label: 'Fabric not received' },
  { value: 'WRONG_FABRIC_TYPE', label: 'Wrong fabric type' },
  { value: 'FABRIC_DAMAGED', label: 'Fabric damaged' },
  { value: 'FABRIC_MISMATCH', label: 'Fabric mismatch' },
] as const

export const TAILOR_CANCELLATION_REASON_OPTIONS = [
  { value: 'ITEM_UNAVAILABLE', label: 'Item unavailable' },
  { value: 'ITEM_DAMAGED_BEFORE_DISPATCH', label: 'Item damaged before dispatch' },
  { value: 'TAILOR_CANNOT_FULFIL', label: 'Tailor cannot fulfil' },
  { value: 'DISPATCH_DELAY', label: 'Dispatch delay' },
  { value: 'OTHER', label: 'Other' },
] as const

export const TAILOR_DELIVERY_REASON_OPTIONS = [
  { value: 'DRAPEON_COLLECTION_MISSED', label: 'Drapeon collection was missed' },
  { value: 'CUSTODY_SCAN_MISMATCH', label: 'Custody acknowledgement is missing or wrong' },
  { value: 'PARCEL_RETURNED_TO_TAILOR', label: 'Parcel was returned to me' },
  { value: 'HANDOFF_DAMAGE', label: 'Damage was found during handoff' },
  { value: 'OTHER', label: 'Other' },
] as const

export function measurementSnapshotForOrder(order: AccountOrder) {
  const snapshot = order.customer_measurements_snapshot
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
}

export function dateTimeLocalInputValue(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function stageUpdatesFor(orderId: string, updates: StageUpdate[]) {
  return updates.filter((update) => update.order_id === orderId)
}

export function productionEvidenceFor(orderId: string, evidence: ProductionEvidence[]) {
  return evidence.filter((item) => item.order_id === orderId)
}

export function mediaFingerprint(file: File) {
  return [file.name, file.type, file.size, file.lastModified]
    .join(':')
    .replace(/\s+/g, '-')
    .slice(0, 240)
}

export function minorUnitsInput(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return (value / 100).toFixed(2).replace(/\.00$/, '')
}

export const ORDER_STAGE_VALUES: OrderStage[] = [
  'DRAFT',
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
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'IN_DISPUTE',
  'REFUNDED',
  'CANCELLED',
]

export const ORDER_STAGE_SET = new Set<OrderStage>(ORDER_STAGE_VALUES)

export const CUSTOM_TAILOR_STAGE_TARGETS: OrderStage[] = [
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
]

export function asOrderStage(value: string | null | undefined): OrderStage | null {
  if (!value || !ORDER_STAGE_SET.has(value as OrderStage)) return null
  return value as OrderStage
}

export function filterFulfillmentStage(order: AccountOrder, stage: OrderStage) {
  if (stage === 'READY_FOR_COLLECTION') return order.delivery_method === 'LOCAL_COLLECTION'
  if (stage === 'READY_FOR_DRAPE_DISPATCH') return order.delivery_method !== 'LOCAL_COLLECTION'
  return true
}

export function nextStageOptions(order: AccountOrder): OrderStage[] {
  const currentStage = asOrderStage(order.stage)
  if (!currentStage) return []

  if (order.order_kind === 'READY_MADE') {
    if (currentStage === 'CONFIRMED') return ['FINISHING']
    if (currentStage === 'FINISHING') {
      return (['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'] as OrderStage[])
        .filter((stage) => canTransition(currentStage, stage, 'TAILOR'))
        .filter((stage) => filterFulfillmentStage(order, stage))
    }
    return []
  }

  return CUSTOM_TAILOR_STAGE_TARGETS.filter((stage) =>
    canTransition(currentStage, stage, 'TAILOR')
  ).filter((stage) => filterFulfillmentStage(order, stage))
}

export function isTailorOrder(order: AccountOrder, data: OrderActorData) {
  return Boolean(
    data.tailorProfile &&
    (order.tailor_profile_id === data.tailorProfile.id || order.tailor_id === data.userId)
  )
}

export const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo

export const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo

export const ORDER_EVIDENCE_CONTENT_TYPES = new Set<string>(ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES)

export function prepareOrderEvidenceFile(file: File) {
  return prepareOperationalMediaFile(file, {
    allowedContentTypes: ORDER_EVIDENCE_CONTENT_TYPES,
    videoMaxBytes: ORDER_EVIDENCE_VIDEO_MAX_BYTES,
    videoMaxSeconds: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
  })
}

export async function uploadPublicFile(bucket: string, pathPrefix: string, file: File) {
  const uploaded = await uploadPublicFileWithLocation(bucket, pathPrefix, file)
  return uploaded.publicUrl
}

export async function uploadPublicFileWithLocation(bucket: string, pathPrefix: string, file: File) {
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
    cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable,
    upsert: false,
  })
  if (error) throw new Error('The media could not upload. Try a smaller file.')
  return {
    publicUrl: supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl,
    bucket,
    path: filePath,
  }
}

export function PhotoTile({ src, label }: { src: string | null; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const safeSrc = safeMediaUrl(src)
  if (!safeSrc) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-[8px] bg-needle/10 text-sm font-semibold text-needle">
        {label}
      </div>
    )
  }
  if (isVideoMediaUrl(safeSrc)) {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="block w-full overflow-hidden rounded-[8px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
          aria-label={`Open ${label} full screen`}
        >
          <MutedVideo
            src={safeSrc}
            className="pointer-events-none aspect-[4/3] w-full bg-ink object-cover"
            ariaLabel={label}
            showMuteToggle={false}
          />
        </button>
        {expanded ? (
          <MediaViewerOverlay
            src={safeSrc}
            label={label}
            video
            onClose={() => setExpanded(false)}
          />
        ) : null}
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative block aspect-[4/3] w-full overflow-hidden rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        aria-label={`Open ${label} full screen`}
      >
        <Image
          src={safeSrc}
          alt={label}
          fill
          sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 90vw"
          className="object-cover"
          unoptimized
        />
      </button>
      {expanded ? (
        <MediaViewerOverlay src={safeSrc} label={label} onClose={() => setExpanded(false)} />
      ) : null}
    </>
  )
}

export function LocalEvidencePreview({
  file,
  index,
  onRemove,
  onReplace,
}: {
  file: File
  index: number
  onRemove: () => void
  onReplace: (file: File) => void
}) {
  const [previewUrl] = useState(() => URL.createObjectURL(file))
  const [expanded, setExpanded] = useState(false)
  const video = isVideoContentType(
    extensionBackedMediaContentType(file, ORDER_EVIDENCE_CONTENT_TYPES)
  )

  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  return (
    <div className="overflow-hidden rounded-[8px] border border-ink/10 bg-bone/55">
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-ink/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        aria-label={`Preview proof item ${index + 1}`}
      >
        {previewUrl ? (
          video ? (
            <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
          ) : (
            <img
              src={previewUrl}
              alt={`Proof item ${index + 1}`}
              className="h-full w-full object-cover"
            />
          )
        ) : null}
      </button>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs text-ink/55">{file.name}</span>
        <div className="flex shrink-0 items-center gap-3">
          <label className="cursor-pointer text-xs font-semibold text-needle">
            Replace
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="sr-only"
              onChange={(event) => {
                const replacement = event.target.files?.[0]
                if (replacement) onReplace(replacement)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <button type="button" onClick={onRemove} className="text-xs font-semibold text-rust-700">
            Remove
          </button>
        </div>
      </div>
      {expanded && previewUrl ? (
        <MediaViewerOverlay
          src={previewUrl}
          label={`Proof item ${index + 1}`}
          video={video}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </div>
  )
}
