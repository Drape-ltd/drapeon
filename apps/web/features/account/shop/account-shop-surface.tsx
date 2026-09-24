'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { useRef, useState, ReactNode } from 'react'
import { CheckCheck, Search, ShoppingBag, Video, WalletCards } from 'lucide-react'
import { MoneyInput } from '../../../components/money-input'
import { friendlyActionError } from '@drape/shared/action-errors'
import { normalizeAccountCurrency, getOnboardingProofItemIssues, formatMoney } from '@drape/shared'
import { ALLOWED_READY_MADE_ITEM_CONTENT_TYPES, MEDIA_LIMITS_BYTES, MEDIA_LIMITS_SECONDS, VIDEO_DURATION_LIMIT_MESSAGE, isVideoMediaUrl } from '@drape/shared/media-policy'
import { safeEntityName, safeUserText } from '../../../lib/safe-display'
import type { JoinedProfile, SellerItem, ShopRenderData, TailorProfile } from '../shared/account-data-contracts'
import { hasNonEmptyText, invokeAccountFunction, isPayoutReady, stringList, uniqueValues } from '../shared/account-data-queries'
import { FALLBACK_READY_MADE_FIT_FIELDS, READY_MADE_FIT_FIELDS, READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS, draftToWebReadyMadeSizeGuide, fitGuideFieldsSummary, fitGuideInputValue, guideDraftFromWebReadyMadeSizeGuide, hasReadyMadeSizeGuide, normalizeWebReadyMadeSizeGuide, readyMadeFitFieldLabel, recommendedReadyMadeFitFieldsForCategory, ReadyMadeFitAdvice, ReadyMadeFitFieldKey, ReadyMadeFitUnit, ReadyMadeSizeGuideDraft } from '@drape/shared/ready-made-size-guide-editor'
import { ActionNotice, EmptyState, MutedVideo, accountRoute, assertNoContactLeak, firstJoinedRow, parseMinorUnits, portfolioVideoDuration, reencodeImageFile, safeMediaUrl } from '../messages/account-messages-surface'
import { OpenAppButton } from '../../../components/open-app-button'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { MetricCard } from '../../../components/ui/metric-card'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Switch } from '../../../components/ui/switch'
import { Textarea } from '../../../components/ui/textarea'
import { minorUnitsInput, uploadPublicFile } from '../orders/account-order-actions'

export function itemPhoto(item: SellerItem) {
  return (
    stringList(item.photo_urls)
      .map((src) => safeMediaUrl(src, 'seller-item-media'))
      .filter((src): src is string => !!src)
      .find((src) => !isVideoMediaUrl(src)) ?? null
  )
}

export function fulfillmentSummary({
  pickup,
  delivery,
  shipping,
  pickup_available,
  delivery_available,
  shipping_available,
}: {
  pickup?: boolean | null
  delivery?: boolean | null
  shipping?: boolean | null
  pickup_available?: boolean | null
  delivery_available?: boolean | null
  shipping_available?: boolean | null
}) {
  const values = [
    (pickup ?? pickup_available) ? 'Pickup' : null,
    (delivery ?? delivery_available) ? 'Delivery' : null,
    (shipping ?? shipping_available) ? 'Shipping' : null,
  ].filter(Boolean)
  return values.length > 0 ? values.join(' / ') : 'Fulfillment not set'
}

// trust_verification_* columns are revoked from `authenticated` (they are read
// through identity-handoff-action instead). Including them here made every
// tailor's own-profile read fail with 42501, which is why setup could hang on
// "Loading tailor setup…" or fall through to "Tailor profile not found".

type WebTailorReadiness = {
  profileCompleted: boolean
  identityVerified: boolean
  payoutReady: boolean
  publicDiscoveryReady: boolean
  canAcceptPaidOrders: boolean
  canPublishPaidItems: boolean
  code:
    | 'PROFILE_INCOMPLETE'
    | 'IDENTITY_REVIEW_PENDING'
    | 'IDENTITY_VERIFICATION_REQUIRED'
    | 'PAYOUT_SETUP_REQUIRED'
    | null
  title: string
  body: string
  actionLabel: string | null
  actionHref: Route | null
  tone: 'neutral' | 'warning' | 'success'
}

export function isVerifiedIdentityStatus(status: string | null | undefined) {
  return status === 'VERIFIED' || status === 'APPROVED'
}

export function deriveWebTailorReadiness(profile: TailorProfile | null | undefined): WebTailorReadiness {
  const profileReleased = profile?.is_live === true
  const profileCompleted = profile?.profile_completed === true || profileReleased
  const idStatus = profile?.id_verification_status ?? 'NOT_SUBMITTED'
  const identityVerified =
    isVerifiedIdentityStatus(idStatus) || profile?.is_verified === true || profileReleased
  const needsReverification = profile?.payout_reverification_required === true
  const payoutReady = identityVerified && isPayoutReady(profile)

  if (!profileCompleted) {
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: false,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: 'PROFILE_INCOMPLETE',
      title: 'Finish your tailor profile first',
      body: 'Your public profile, portfolio, and selling setup need to be complete before customers can discover you as a normal live business.',
      actionLabel: 'Complete profile',
      actionHref: '/account/profile' as Route,
      tone: 'warning',
    }
  }

  if (!identityVerified) {
    const pending = idStatus === 'PENDING'
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: false,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: pending ? 'IDENTITY_REVIEW_PENDING' : 'IDENTITY_VERIFICATION_REQUIRED',
      title: pending ? 'Identity review is in progress' : 'Identity verification is still needed',
      body: pending
        ? 'Your profile can finish review before paid work opens. Paid quotes and live shop publishing stay paused until identity review and payout setup are both complete.'
        : idStatus === 'REJECTED'
          ? 'Your verification needs attention before Drapeon can show you publicly or let you take paid work.'
          : 'Customers should not discover or pay an unverified tailor profile as if it were fully ready.',
      actionLabel: pending
        ? 'Set up payout while you wait'
        : idStatus === 'REJECTED'
          ? 'Resubmit verification in app'
          : 'Finish verification in app',
      actionHref: pending ? ('/account/payout' as Route) : null,
      tone: 'warning',
    }
  }

  if (!payoutReady) {
    const reconnect = needsReverification
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: true,
      canAcceptPaidOrders: false,
      canPublishPaidItems: false,
      code: 'PAYOUT_SETUP_REQUIRED',
      title: profileReleased
        ? 'Live profile, checkout paused'
        : reconnect
          ? 'Reconnect your payout account'
          : 'Set up your payout account',
      body: profileReleased
        ? reconnect
          ? 'Your public profile is live, but payout details need review again before paid quotes, checkout, and earnings release continue.'
          : 'Customers can browse your public profile, but paid quotes, checkout, and earnings release stay paused until payout is verified.'
        : reconnect
          ? 'Your payout details changed or need review again. Reconnect your payout account before paid quotes, shop publishing, and earnings release continue.'
          : 'Set up your payout account before paid quotes and live shop items unlock.',
      actionLabel: reconnect ? 'Reconnect payout' : 'Set up payout',
      actionHref: '/account/payout' as Route,
      tone: 'warning',
    }
  }

  if (profile?.is_live !== true) {
    return {
      profileCompleted,
      identityVerified,
      payoutReady,
      publicDiscoveryReady: true,
      canAcceptPaidOrders: true,
      canPublishPaidItems: true,
      code: null,
      title: 'You are payout-ready',
      body: 'Identity and payout checks look good. Review your storefront and go live when you are ready for standard paid work.',
      actionLabel: 'Review profile',
      actionHref: '/account/profile' as Route,
      tone: 'neutral',
    }
  }

  return {
    profileCompleted,
    identityVerified,
    payoutReady,
    publicDiscoveryReady: true,
    canAcceptPaidOrders: true,
    canPublishPaidItems: true,
    code: null,
    title: 'Live and payout-ready',
    body: 'You can accept standard paid work and publish paid items with your current setup.',
    actionLabel: null,
    actionHref: null,
    tone: 'success',
  }
}

export function readyMadeInventoryCount(item: SellerItem) {
  if (typeof item.inventory_quantity === 'number' && Number.isFinite(item.inventory_quantity)) {
    return Math.max(0, Math.floor(item.inventory_quantity))
  }

  const sizeInventory = item.size_inventory
  if (!sizeInventory || typeof sizeInventory !== 'object' || Array.isArray(sizeInventory)) return 0

  return Object.values(sizeInventory).reduce((sum, value) => {
    const parsedValue =
      typeof value === 'number'
        ? value
        : Number.parseInt(typeof value === 'string' ? value : '', 10)
    return sum + (Number.isFinite(parsedValue) ? Math.max(0, Math.floor(parsedValue)) : 0)
  }, 0)
}

function hasStructuredReadyMadeSizeGuide(
  sizeGuide: Record<string, unknown> | null | undefined,
  sizes: string[]
) {
  return hasReadyMadeSizeGuide(normalizeWebReadyMadeSizeGuide(sizeGuide, sizes), sizes)
}

function readyMadeLiveListingIssues(input: {
  category: string | null | undefined
  description: string
  sizes: string[]
  photoCount: number
  inventoryQuantity: number
  hasSizeGuide: boolean
  requiresPickupAddress: boolean
}) {
  const issues: string[] = []

  if (!input.category?.trim()) {
    issues.push('Before this item can go live, choose a category so buyers know where it belongs.')
  }
  if (input.photoCount === 0) {
    issues.push(
      'Before this item can go live, add at least one clear photo so buyers can see the piece.'
    )
  }
  if (input.sizes.length === 0) {
    issues.push(
      'Before this item can go live, add at least one size. Use One size if that is how you sell it.'
    )
  }
  if (!input.hasSizeGuide) {
    issues.push(
      'Before this item can go live, add at least one fit-guide range so buyers can see what each size means and Drapeon can recommend the right fit.'
    )
  }
  if (input.description.trim().length < 24) {
    issues.push(
      'Before this item can go live, add a fuller description. Aim for 1 or 2 sentences on the style, fit, fabric, or occasion so buyers understand the piece.'
    )
  }
  if (input.inventoryQuantity < 1) {
    issues.push(
      'Before this item can go live, add at least 1 unit to at least one size so buyers can actually order it.'
    )
  }
  if (input.requiresPickupAddress) {
    issues.push('Before pickup items can go live, add your private pickup address in Profile.')
  }

  return issues
}

export function isReadyMadeBuyableOnWeb(item: SellerItem, tailor: JoinedProfile | null) {
  const stockStatus = (item.stock_status ?? 'IN_STOCK').toUpperCase()
  return (
    item.is_live === true &&
    tailor?.is_live === true &&
    tailor?.shop_paused !== true &&
    !['SOLD_OUT', 'HIDDEN'].includes(stockStatus) &&
    readyMadeInventoryCount(item) > 0
  )
}

export function splitList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseInventoryFromSizes(sizes: string[], inventoryValue: string) {
  const fallback = Number.parseInt(inventoryValue, 10)
  const count = Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  return Object.fromEntries(sizes.map((size, index) => [size, index === 0 ? count : 0]))
}

export const MESSAGE_PHOTO_MAX_BYTES = 10 * 1024 * 1024

const READY_MADE_MEDIA_MAX_BYTES = MEDIA_LIMITS_BYTES.readyMadeItemVideo

const READY_MADE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.readyMadeItemVideo

const READY_MADE_MEDIA_CONTENT_TYPES = new Set<string>(ALLOWED_READY_MADE_ITEM_CONTENT_TYPES)

const MAX_READY_MADE_MEDIA = 6

function readyMadeMediaContentType(file: File) {
  const normalized = file.type.split(';')[0]?.trim().toLowerCase()
  if (normalized && READY_MADE_MEDIA_CONTENT_TYPES.has(normalized)) return normalized
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return null
}

async function prepareReadyMadeMediaFile(file: File) {
  const contentType = readyMadeMediaContentType(file)
  if (!contentType || !READY_MADE_MEDIA_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      'That file type is not supported here. Please choose a photo or video from your device.'
    )
  }

  if (contentType.startsWith('video/')) {
    if (file.size > READY_MADE_MEDIA_MAX_BYTES) {
      throw new Error(
        `Choose videos under ${Math.round(READY_MADE_MEDIA_MAX_BYTES / (1024 * 1024))} MB.`
      )
    }
    const duration = await portfolioVideoDuration(file)
    if (Number.isFinite(duration) && duration > READY_MADE_VIDEO_MAX_SECONDS) {
      throw new Error(VIDEO_DURATION_LIMIT_MESSAGE)
    }
    return new File([file], file.name, {
      type: contentType,
      lastModified: file.lastModified,
    })
  }

  if (file.size > MESSAGE_PHOTO_MAX_BYTES) {
    throw new Error('Choose a photo under 10 MB.')
  }
  return reencodeImageFile(file)
}

export type SortableMediaEntry = {
  id: string
  url: string
  label: string
}

export function moveMediaEntry(entries: SortableMediaEntry[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= entries.length ||
    toIndex >= entries.length ||
    fromIndex === toIndex
  ) {
    return entries
  }
  const next = [...entries]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return entries
  next.splice(toIndex, 0, item)
  return next
}

function SortableMediaGrid({
  entries,
  onReorder,
  onDelete,
  onInspect,
  renderActions,
  busy,
  imageClassName = 'object-cover',
}: {
  entries: SortableMediaEntry[]
  onReorder: (nextEntries: SortableMediaEntry[]) => void
  onDelete?: (index: number) => void
  onInspect?: (index: number) => void
  renderActions?: (entry: SortableMediaEntry, index: number) => ReactNode
  busy?: boolean
  imageClassName?: string
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)

  if (entries.length === 0) return null

  return (
    <div className="grid grid-cols-3 gap-3">
      {entries.map((entry, index) => {
        const safeSrc = safeMediaUrl(entry.url)
        const isCover = index === 0
        return (
          <article
            key={`${entry.id}-${index}`}
            draggable={!busy}
            onDragStart={(event) => {
              setDraggingIndex(index)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(event) => {
              event.preventDefault()
              const fromIndex = Number(event.dataTransfer.getData('text/plain'))
              setDraggingIndex(null)
              if (!Number.isFinite(fromIndex)) return
              onReorder(moveMediaEntry(entries, fromIndex, index))
            }}
            onDragEnd={() => setDraggingIndex(null)}
            className={`group relative overflow-hidden rounded-[8px] border bg-white shadow-sm transition ${
              draggingIndex === index
                ? 'border-needle opacity-70'
                : 'border-ink/8 hover:border-needle/30'
            }`}
          >
            <button
              type="button"
              onClick={() => onInspect?.(index)}
              className="relative block aspect-square w-full overflow-hidden bg-bone text-left"
            >
              {safeSrc && isVideoMediaUrl(safeSrc) ? (
                <>
                  <MutedVideo
                    src={safeSrc}
                    className="h-full w-full object-cover"
                    ariaLabel={entry.label}
                    showMuteToggle={false}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-semibold text-white"
                  >
                    <Video className="size-3" /> Video
                  </span>
                </>
              ) : safeSrc ? (
                <Image
                  src={safeSrc}
                  alt={entry.label}
                  fill
                  sizes="(min-width: 1024px) 12vw, 30vw"
                  className={imageClassName}
                  unoptimized
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-needle">
                  Media
                </span>
              )}
              {isCover ? (
                <span className="absolute left-2 top-2 rounded-full bg-needle px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white">
                  Cover
                </span>
              ) : null}
              <span className="absolute bottom-2 left-2 rounded-full bg-ink/72 px-2 py-1 text-[0.65rem] font-semibold text-white">
                {isVideoMediaUrl(safeSrc ?? '') ? 'Video' : 'Photo'} {index + 1}
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2 p-2">
              {renderActions?.(entry, index)}
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(index)}
                  disabled={busy}
                  className="rounded-full border border-rust/20 bg-white px-3 py-1 text-xs font-semibold text-rust disabled:text-ink/35"
                >
                  Delete
                </button>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export function MediaInspectionOverlay({
  entries,
  initialIndex,
  onClose,
}: {
  entries: SortableMediaEntry[]
  initialIndex: number
  onClose: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const activeEntry = entries[activeIndex] ?? entries[0] ?? null
  const safeSrc = safeMediaUrl(activeEntry?.url)

  if (!activeEntry || !safeSrc) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/78 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close media preview"
      />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-[8px] border border-white/12 bg-ink shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/52">
              Media preview
            </p>
            <h3 className="mt-1 text-lg font-semibold">{activeEntry.label}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 px-3 py-2 text-sm font-semibold text-white"
          >
            Close
          </button>
        </div>
        <div className="relative aspect-[4/3] max-h-[72vh] bg-black">
          {isVideoMediaUrl(safeSrc) ? (
            <MutedVideo
              src={safeSrc}
              controls
              autoPlay={false}
              loop={false}
              className="h-full w-full object-contain"
              ariaLabel={activeEntry.label}
              showMuteToggle
            />
          ) : (
            <Image
              src={safeSrc}
              alt={activeEntry.label}
              fill
              sizes="90vw"
              className="object-contain"
              unoptimized
            />
          )}
          {entries.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((current) => (current - 1 + entries.length) % entries.length)
                }
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/88 px-3 py-2 text-sm font-semibold text-ink shadow"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => (current + 1) % entries.length)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/88 px-3 py-2 text-sm font-semibold text-ink shadow"
              >
                Next
              </button>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-center gap-1.5 px-4 py-3">
          {entries.map((entry, index) => (
            <button
              key={`${entry.id}-${index}-dot`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`h-1.5 rounded-full transition ${index === activeIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/35'}`}
              aria-label={`Show media ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function SellerItemManager({
  data,
  onRefresh,
  onboardingProofMode = false,
}: {
  data: Pick<ShopRenderData, 'userId' | 'tailorProfile' | 'pickupDetails' | 'sellerItems'>
  onRefresh: () => void
  onboardingProofMode?: boolean
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(data.tailorProfile?.currency ?? 'USD')
  const [sizes, setSizes] = useState('M')
  const [inventory, setInventory] = useState('1')
  const [fitGuideUnit, setFitGuideUnit] = useState<ReadyMadeFitUnit>('in')
  const [fitGuideFields, setFitGuideFields] = useState<ReadyMadeFitFieldKey[]>(
    FALLBACK_READY_MADE_FIT_FIELDS
  )
  const [fitGuideDraft, setFitGuideDraft] = useState<ReadyMadeSizeGuideDraft>({})
  const [activeFitGuideSize, setActiveFitGuideSize] = useState<string | null>(null)
  const [fitNotes, setFitNotes] = useState('')
  const [stretchNotes, setStretchNotes] = useState('')
  const [sizeAdvice, setSizeAdvice] = useState<ReadyMadeFitAdvice>('ASK_SELLER')
  const [fulfillment, setFulfillment] = useState({ pickup: true, delivery: false, shipping: false })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [publish, setPublish] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([])
  const [readyMadeInspectIndex, setReadyMadeInspectIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const readiness = deriveWebTailorReadiness(data.tailorProfile)
  const sellerType = data.tailorProfile?.seller_type
  const isOnboardingProofMode =
    onboardingProofMode ||
    (!readiness.publicDiscoveryReady && (sellerType === 'BOUTIQUE' || sellerType === 'TAILOR_SHOP'))
  const canPublishLive =
    data.tailorProfile?.supports_ready_made === true && readiness.canPublishPaidItems
  const hasPickupAddress = hasNonEmptyText(data.pickupDetails?.pickup_address)
  const publishBlockedReason = !data.tailorProfile?.supports_ready_made
    ? 'Enable ready-made shop in Selling setup before publishing live items.'
    : !readiness.canPublishPaidItems
      ? readiness.body
      : fulfillment.pickup && !hasPickupAddress
        ? 'Add the exact private pickup address in Profile before publishing a pickup item.'
        : null
  const publishBlocked = !isOnboardingProofMode && publish && !!publishBlockedReason
  const draftSizes = splitList(sizes)
  const selectedFitGuideSize =
    activeFitGuideSize && draftSizes.includes(activeFitGuideSize)
      ? activeFitGuideSize
      : (draftSizes[0] ?? null)
  const currentSizeAdvice = READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.find(
    (option) => option.value === sizeAdvice
  )
  const currentFitGuide = draftToWebReadyMadeSizeGuide({
    sizes: draftSizes,
    unit: fitGuideUnit,
    fields: fitGuideFields,
    draft: fitGuideDraft,
    fitNotes,
    stretchNotes,
    sizeAdvice,
  })
  const currentFitGuideReady = hasReadyMadeSizeGuide(currentFitGuide, draftSizes)
  const portfolioVideoUrls = stringList(data.tailorProfile?.portfolio_video_urls)
  const readyMadeMediaEntries: SortableMediaEntry[] = existingPhotoUrls.map((url, index) => ({
    id: `ready-made-${index}-${url}`,
    url,
    label: `Product media ${index + 1}`,
  }))

  function resetForm() {
    setEditingItemId(null)
    setExistingPhotoUrls([])
    setReadyMadeInspectIndex(null)
    setTitle('')
    setCategory('')
    setDescription('')
    setPrice('')
    setCurrency(data.tailorProfile?.currency ?? 'USD')
    setSizes('M')
    setInventory('1')
    setFitGuideUnit('in')
    setFitGuideFields(FALLBACK_READY_MADE_FIT_FIELDS)
    setFitGuideDraft({})
    setActiveFitGuideSize(null)
    setFitNotes('')
    setStretchNotes('')
    setSizeAdvice('ASK_SELLER')
    setFulfillment({ pickup: true, delivery: false, shipping: false })
    setPhotoFile(null)
    setPublish(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  function toggleFitGuideField(field: ReadyMadeFitFieldKey) {
    setFitGuideFields((current) =>
      current.includes(field) ? current.filter((entry) => entry !== field) : [...current, field]
    )
  }

  function setFitGuideRange(
    size: string,
    field: ReadyMadeFitFieldKey,
    edge: 'min' | 'max',
    value: string
  ) {
    const nextValue = fitGuideInputValue(value)
    setFitGuideDraft((current) => {
      const currentSize = current[size] ?? {}
      const currentRange = currentSize[field] ?? { min: '', max: '' }
      return {
        ...current,
        [size]: {
          ...currentSize,
          [field]: {
            ...currentRange,
            [edge]: nextValue,
          },
        },
      }
    })
  }

  function applyRecommendedFitGuideFields() {
    setFitGuideFields(recommendedReadyMadeFitFieldsForCategory(category))
  }

  function startEditItem(item: SellerItem) {
    setError(null)
    setSuccess(null)
    if (item.is_live && item.stock_status !== 'SOLD_OUT') {
      setError(
        'Unpublish this item before editing it. This prevents customers from buying while details are changing.'
      )
      return
    }
    setEditingItemId(item.id)
    setExistingPhotoUrls(stringList(item.photo_urls))
    setTitle(item.title ?? '')
    setCategory(item.category ?? '')
    setDescription(item.description ?? '')
    setPrice(minorUnitsInput(item.price_amount))
    setCurrency(item.currency ?? data.tailorProfile?.currency ?? 'USD')
    const itemSizes = stringList(item.sizes)
    setSizes(itemSizes.join(', ') || 'M')
    setInventory(String(item.inventory_quantity ?? 1))
    const normalizedGuide = normalizeWebReadyMadeSizeGuide(item.size_guide, itemSizes)
    const nextFitGuideFields =
      normalizedGuide.fields.length > 0
        ? normalizedGuide.fields
        : recommendedReadyMadeFitFieldsForCategory(item.category)
    setFitGuideUnit(normalizedGuide.unit)
    setFitGuideFields(nextFitGuideFields)
    setFitGuideDraft(
      guideDraftFromWebReadyMadeSizeGuide({
        sizes: itemSizes,
        fields: nextFitGuideFields,
        guide: normalizedGuide,
      })
    )
    setActiveFitGuideSize(itemSizes[0] ?? null)
    setFitNotes(normalizedGuide.fitNotes ?? '')
    setStretchNotes(normalizedGuide.stretchNotes ?? '')
    setSizeAdvice(normalizedGuide.sizeAdvice ?? 'ASK_SELLER')
    setFulfillment({
      pickup: item.pickup_available ?? true,
      delivery: item.delivery_available ?? false,
      shipping: item.shipping_available ?? false,
    })
    setPhotoFile(null)
    setPublish(item.is_live ?? false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  async function chooseReadyMadeMedia(file: File | null) {
    setError(null)
    if (!file) {
      setPhotoFile(null)
      return
    }
    if (existingPhotoUrls.length >= MAX_READY_MADE_MEDIA) {
      setPhotoFile(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
      setError(
        `Remove one media item first. Ready-made items can have up to ${MAX_READY_MADE_MEDIA} media files.`
      )
      return
    }

    try {
      await prepareReadyMadeMediaFile(file)
      setPhotoFile(file)
    } catch (mediaError) {
      setPhotoFile(null)
      if (photoInputRef.current) photoInputRef.current.value = ''
      setError(friendlyActionError(mediaError, 'This media file could not be used.'))
    }
  }

  function attachPortfolioVideo(videoUrl: string) {
    setError(null)
    setExistingPhotoUrls((current) => {
      if (current.includes(videoUrl)) return current
      if (current.length >= MAX_READY_MADE_MEDIA) {
        setError(
          `Remove one media item first. Ready-made items can have up to ${MAX_READY_MADE_MEDIA} media files.`
        )
        return current
      }
      return [...current, videoUrl]
    })
  }

  async function saveItem() {
    setError(null)
    setSuccess(null)
    if (!data.userId || !data.tailorProfile?.id) return
    const textToCheck = [title, category, description, fitNotes, stretchNotes]
      .filter(Boolean)
      .join('\n')
    const leak = assertNoContactLeak(
      textToCheck,
      "Ready-made listings can't include contact details."
    )
    if (leak) {
      setError(leak)
      return
    }
    const priceAmount = parseMinorUnits(price)
    const nextSizes = splitList(sizes)
    const sizeInventory = parseInventoryFromSizes(nextSizes, inventory)
    const inventoryQuantity = Object.values(sizeInventory).reduce((sum, value) => sum + value, 0)
    const nextSizeGuide = draftToWebReadyMadeSizeGuide({
      sizes: nextSizes,
      unit: fitGuideUnit,
      fields: fitGuideFields,
      draft: fitGuideDraft,
      fitNotes,
      stretchNotes,
      sizeAdvice,
    })
    const mediaCount = existingPhotoUrls.length + (photoFile ? 1 : 0)
    if (isOnboardingProofMode) {
      const proofIssues = getOnboardingProofItemIssues({
        title,
        category,
        description,
        mediaCount,
        sizes: nextSizes,
        inventoryQuantity,
      })
      if (proofIssues.length > 0) {
        setError(proofIssues[0]?.message ?? 'Finish the required setup item details.')
        return
      }
    } else {
      if (
        !title.trim() ||
        !category.trim() ||
        !description.trim() ||
        !priceAmount ||
        nextSizes.length === 0
      ) {
        setError('Add title, category, description, price, and at least one size.')
        return
      }
      if (publishBlocked) {
        setError(publishBlockedReason ?? 'Finish go-live checks before publishing this item.')
        return
      }
      if (publish) {
        const liveIssues = readyMadeLiveListingIssues({
          category,
          description,
          sizes: nextSizes,
          photoCount: mediaCount,
          inventoryQuantity,
          hasSizeGuide: hasStructuredReadyMadeSizeGuide(nextSizeGuide, nextSizes),
          requiresPickupAddress: fulfillment.pickup && !hasPickupAddress,
        })
        if (liveIssues.length > 0) {
          setError(liveIssues[0] ?? 'Finish go-live checks before publishing this item.')
          return
        }
      }
    }
    setBusy(true)
    try {
      const preparedMedia = photoFile ? await prepareReadyMadeMediaFile(photoFile) : null
      const uploadedMediaUrl = preparedMedia
        ? await uploadPublicFile(
            'seller-item-media',
            `shop/${data.userId}/${readyMadeMediaContentType(preparedMedia)?.startsWith('video/') ? 'videos' : 'photos'}`,
            preparedMedia
          )
        : null
      const photoUrls = uploadedMediaUrl
        ? [...new Set([...existingPhotoUrls, uploadedMediaUrl])].slice(0, MAX_READY_MADE_MEDIA)
        : existingPhotoUrls
      const result = await invokeAccountFunction<{ isLive?: boolean }>('seller-item-action', {
        action: editingItemId ? 'update-item' : 'create-item',
        itemId: editingItemId ?? undefined,
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        sizes: nextSizes,
        sizeInventory,
        priceAmount: isOnboardingProofMode ? null : priceAmount,
        currency,
        photoUrls,
        inventoryQuantity,
        sizeGuide: isOnboardingProofMode ? null : nextSizeGuide,
        pickupAvailable: isOnboardingProofMode ? false : fulfillment.pickup,
        deliveryAvailable: isOnboardingProofMode ? false : fulfillment.delivery,
        shippingAvailable: isOnboardingProofMode ? false : fulfillment.shipping,
        isLive: isOnboardingProofMode ? false : publish,
        onboarding: isOnboardingProofMode,
      })
      const savedLive = result.isLive === true
      setSuccess(
        isOnboardingProofMode
          ? 'Ready-made proof item saved for setup review.'
          : editingItemId
            ? savedLive
              ? 'Ready-made item updated and published.'
              : 'Ready-made draft updated.'
            : savedLive
              ? 'Ready-made item saved and publish checks passed.'
              : 'Ready-made draft saved.'
      )
      resetForm()
      onRefresh()
    } catch (itemError) {
      setError(
        friendlyActionError(
          itemError,
          'Ready-made item could not save. Check required fields and try again.'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  async function runSellerItemAction(
    action: 'publish-item' | 'hide-item' | 'delete-item',
    item: SellerItem
  ) {
    setError(null)
    setSuccess(null)
    if (!data.userId || !data.tailorProfile?.id) return
    if (action === 'delete-item') {
      const confirmed = window.confirm(
        'Delete this hidden draft permanently? Items with order history cannot be deleted.'
      )
      if (!confirmed) return
    }
    if (action === 'publish-item') {
      if (!canPublishLive) {
        setError(
          data.tailorProfile?.supports_ready_made === false
            ? 'Enable ready-made shop in Selling setup before publishing live items.'
            : readiness.body
        )
        return
      }
      const itemSizes = stringList(item.sizes)
      const liveIssues = readyMadeLiveListingIssues({
        category: item.category,
        description: item.description ?? '',
        sizes: itemSizes,
        photoCount: stringList(item.photo_urls).length,
        inventoryQuantity: readyMadeInventoryCount(item),
        hasSizeGuide: hasStructuredReadyMadeSizeGuide(item.size_guide, itemSizes),
        requiresPickupAddress: (item.pickup_available ?? false) && !hasPickupAddress,
      })
      if (liveIssues.length > 0) {
        setError(liveIssues[0] ?? 'Finish go-live checks before publishing this item.')
        return
      }
    }
    const busyKey = `${action}:${item.id}`
    setActionBusy(busyKey)
    try {
      await invokeAccountFunction('seller-item-action', {
        action,
        itemId: item.id,
      })
      if (editingItemId === item.id && (action === 'hide-item' || action === 'delete-item')) {
        resetForm()
      }
      setSuccess(
        action === 'publish-item'
          ? 'Item published after preflight checks.'
          : action === 'hide-item'
            ? 'Item hidden from customers.'
            : 'Hidden draft deleted.'
      )
      onRefresh()
    } catch (itemError) {
      setError(
        friendlyActionError(
          itemError,
          'Shop item action could not be completed. Refresh and try again.'
        )
      )
    } finally {
      setActionBusy(null)
    }
  }

  if (!data.tailorProfile) return null

  return (
    <Surface className="overflow-hidden">
      {readyMadeInspectIndex != null ? (
        <MediaInspectionOverlay
          entries={readyMadeMediaEntries}
          initialIndex={readyMadeInspectIndex}
          onClose={() => setReadyMadeInspectIndex(null)}
        />
      ) : null}
      <SurfaceHeader
        eyebrow={isOnboardingProofMode ? 'Setup proof' : 'Catalogue'}
        title={
          isOnboardingProofMode
            ? 'Add ready-made proof item'
            : editingItemId
              ? 'Edit listing'
              : 'Add a listing'
        }
        description={
          isOnboardingProofMode
            ? 'Add one inspectable ready-made item for setup review. It stays hidden from buyers; pricing and go-live setup happen later in Catalogue.'
            : 'Publishing checks photos, sizes, stock, fit guide, fulfillment, and payout readiness. Unpublish items before editing.'
        }
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        {!isOnboardingProofMode &&
        (!canPublishLive || (fulfillment.pickup && !hasPickupAddress)) ? (
          <div
            className={`rounded-[8px] border p-4 ${
              canPublishLive && fulfillment.pickup && !hasPickupAddress
                ? 'border-amber-300/35 bg-amber-400/8'
                : 'border-rust/18 bg-rust/8'
            }`}
          >
            <p className="text-sm font-semibold text-ink">
              {canPublishLive ? 'Pickup needs private details' : readiness.title}
            </p>
            <p className="mt-1.5 text-sm leading-6 text-ink/62">
              {data.tailorProfile?.supports_ready_made === false
                ? 'Draft items are fine, but live ready-made listings should stay hidden until ready-made shop is enabled on your tailor profile.'
                : canPublishLive
                  ? 'Drafts can still be saved. To publish pickup items, add the exact private pickup address in Profile first.'
                  : readiness.body}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {!canPublishLive && readiness.actionHref ? (
                <Link href={readiness.actionHref} className="text-sm font-semibold text-needle">
                  {readiness.actionLabel ?? 'Review readiness'} →
                </Link>
              ) : null}
              {(fulfillment.pickup && !hasPickupAddress) ||
              data.tailorProfile?.supports_ready_made === false ? (
                <Link href="/account/profile" className="text-sm font-semibold text-needle">
                  Open Selling setup →
                </Link>
              ) : null}
              {!readiness.identityVerified && !readiness.actionHref ? (
                <OpenAppButton
                  label={readiness.actionLabel ?? 'Open app verification'}
                  className="text-sm font-semibold text-needle"
                />
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Category">
            <Input value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-4">
          {!isOnboardingProofMode ? (
            <MoneyInput
              id="ready-made-listing-price"
              label="Price"
              value={price}
              onValueChange={setPrice}
              currency={normalizeAccountCurrency(currency) ?? 'USD'}
              required
            />
          ) : null}
          {!isOnboardingProofMode ? (
            <Field label="Currency">
              <NativeSelect
                value={currency}
                onChange={(event) =>
                  setCurrency(normalizeAccountCurrency(event.target.value) ?? currency)
                }
              >
                {['USD', 'GBP', 'NGN', 'CAD', 'EUR', 'GHS', 'KES'].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field label="Sizes">
            <Input value={sizes} onChange={(event) => setSizes(event.target.value)} />
          </Field>
          <Field label="Stock">
            <Input
              inputMode="numeric"
              value={inventory}
              onChange={(event) => setInventory(event.target.value)}
            />
          </Field>
        </div>
        {!isOnboardingProofMode ? (
          <div className="grid gap-4 rounded-[8px] border border-ink/8 bg-bone/35 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Fit guide</p>
                <p className="mt-1 text-xs leading-5 text-ink/56">
                  Add the buyer measurement ranges that should fit each size.
                </p>
              </div>
              <span
                className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                  currentFitGuideReady
                    ? 'bg-needle/10 text-needle'
                    : 'bg-amber-400/12 text-amber-800'
                }`}
              >
                {currentFitGuideReady ? 'Fit guide ready' : 'Required before live'}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Unit">
                <NativeSelect
                  value={fitGuideUnit}
                  onChange={(event) => setFitGuideUnit(event.target.value === 'cm' ? 'cm' : 'in')}
                >
                  <option value="in">Inches</option>
                  <option value="cm">Centimetres</option>
                </NativeSelect>
              </Field>
              <Field
                label="Buyer guidance"
                hint={
                  currentSizeAdvice?.hint ??
                  'Tell buyers how to choose when they sit between sizes.'
                }
              >
                <NativeSelect
                  value={sizeAdvice}
                  onChange={(event) => setSizeAdvice(event.target.value as ReadyMadeFitAdvice)}
                >
                  {READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">
                    Measurements
                  </span>
                  <p className="mt-1 text-xs leading-5 text-ink/52">
                    {fitGuideFieldsSummary(fitGuideFields)}
                  </p>
                </div>
                <Button
                  onClick={applyRecommendedFitGuideFields}
                  variant="secondary"
                  size="sm"
                  className="w-fit"
                >
                  Use category defaults
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {READY_MADE_FIT_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="flex items-center justify-between gap-2 rounded-[8px] border border-ui-border bg-white px-3 py-2 text-xs font-semibold text-ink"
                  >
                    <span>{field.label}</span>
                    <Switch
                      checked={fitGuideFields.includes(field.key)}
                      onCheckedChange={() => toggleFitGuideField(field.key)}
                      aria-label={`${field.label} fit field`}
                    />
                  </div>
                ))}
              </div>
            </div>
            {draftSizes.length === 0 ? (
              <p className="rounded-[8px] border border-amber-300/35 bg-white px-4 py-3 text-sm leading-6 text-ink/62">
                Add at least one size first, then enter size ranges here.
              </p>
            ) : fitGuideFields.length === 0 ? (
              <p className="rounded-[8px] border border-amber-300/35 bg-white px-4 py-3 text-sm leading-6 text-ink/62">
                Choose at least one measurement field. Chest, waist, and hips are a good start for
                most pieces.
              </p>
            ) : selectedFitGuideSize ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  {draftSizes.map((size) => {
                    const selected = selectedFitGuideSize === size
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setActiveFitGuideSize(size)}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                          selected
                            ? 'border-needle bg-needle text-white'
                            : 'border-ink/10 bg-white text-ink'
                        }`}
                      >
                        {size}
                      </button>
                    )
                  })}
                </div>
                <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
                  <div>
                    <p className="text-sm font-semibold text-ink">Size {selectedFitGuideSize}</p>
                    <p className="mt-1 text-xs leading-5 text-ink/52">
                      Enter the buyer range that should fit this size.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {fitGuideFields.map((field) => (
                      <div
                        key={`${selectedFitGuideSize}-${field}`}
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center"
                      >
                        <span className="text-sm font-semibold text-ink">
                          {readyMadeFitFieldLabel(field)}
                        </span>
                        <Input
                          inputMode="decimal"
                          value={fitGuideDraft[selectedFitGuideSize]?.[field]?.min ?? ''}
                          onChange={(event) =>
                            setFitGuideRange(selectedFitGuideSize, field, 'min', event.target.value)
                          }
                          placeholder={`Min ${fitGuideUnit}`}
                        />
                        <Input
                          inputMode="decimal"
                          value={fitGuideDraft[selectedFitGuideSize]?.[field]?.max ?? ''}
                          onChange={(event) =>
                            setFitGuideRange(selectedFitGuideSize, field, 'max', event.target.value)
                          }
                          placeholder={`Max ${fitGuideUnit}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Fit notes">
                <Textarea
                  value={fitNotes}
                  onChange={(event) => setFitNotes(event.target.value)}
                  rows={3}
                  placeholder="Example: relaxed through the chest, structured shoulders."
                />
              </Field>
              <Field label="Stretch notes">
                <Textarea
                  value={stretchNotes}
                  onChange={(event) => setStretchNotes(event.target.value)}
                  rows={3}
                  placeholder="Example: no stretch, choose the larger size if unsure."
                />
              </Field>
            </div>
          </div>
        ) : null}
        <div className={isOnboardingProofMode ? 'grid gap-3' : 'grid gap-3 md:grid-cols-[1fr_1fr]'}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-ink">Product media</span>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              onChange={(event) => {
                void chooseReadyMadeMedia(event.target.files?.[0] ?? null)
              }}
              className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink"
            />
            <span className="text-xs leading-5 text-ink/52">
              {editingItemId && !photoFile && existingPhotoUrls.length > 0
                ? `${existingPhotoUrls.length} existing media item${existingPhotoUrls.length === 1 ? '' : 's'} will be kept.`
                : 'Choose a garment photo or a video up to 30 seconds.'}
            </span>
            {photoFile ? (
              <span className="text-xs font-semibold text-needle">{photoFile.name} selected</span>
            ) : null}
            {readyMadeMediaEntries.length > 0 ? (
              <div className="grid gap-2 rounded-[8px] border border-ink/8 bg-bone/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/48">
                    Media order
                  </span>
                  <span className="text-xs text-ink/48">First tile is cover</span>
                </div>
                <SortableMediaGrid
                  entries={readyMadeMediaEntries}
                  busy={busy}
                  onInspect={setReadyMadeInspectIndex}
                  onReorder={(nextEntries) =>
                    setExistingPhotoUrls(nextEntries.map((entry) => entry.url))
                  }
                  onDelete={(index) =>
                    setExistingPhotoUrls((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                />
              </div>
            ) : null}
            {portfolioVideoUrls.length > 0 ? (
              <div className="grid gap-2 rounded-[8px] border border-needle/14 bg-needle/5 p-3">
                <span className="text-xs font-semibold text-needle">
                  Choose from Portfolio Videos
                </span>
                {portfolioVideoUrls.map((videoUrl, index) => (
                  <button
                    key={videoUrl}
                    type="button"
                    onClick={() => attachPortfolioVideo(videoUrl)}
                    disabled={existingPhotoUrls.includes(videoUrl)}
                    className="flex items-center justify-between gap-3 rounded-full border border-needle/14 bg-white px-4 py-2 text-left text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/36"
                  >
                    <span>Portfolio video {index + 1}</span>
                    <span className="text-needle">
                      {existingPhotoUrls.includes(videoUrl) ? 'Attached' : 'Attach'}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          {!isOnboardingProofMode ? (
            <div className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Fulfillment</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { key: 'pickup', label: 'Pickup' },
                    { key: 'delivery', label: 'Delivery' },
                    { key: 'shipping', label: 'Shipping' },
                  ] as const
                ).map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-[8px] border border-ui-border bg-white px-3 py-2.5 text-sm font-semibold text-ink"
                  >
                    <span>{label}</span>
                    <Switch
                      checked={fulfillment[key]}
                      onCheckedChange={(checked) =>
                        setFulfillment((current) => ({ ...current, [key]: checked }))
                      }
                      aria-label={`${label} fulfillment`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {!isOnboardingProofMode ? (
          <div className="flex max-w-md items-center justify-between gap-3 rounded-[8px] border border-ui-border bg-ui-muted/40 px-4 py-3 text-sm font-semibold text-ink">
            <span>Publish after preflight</span>
            <Switch
              checked={publish}
              onCheckedChange={setPublish}
              aria-label="Publish after preflight"
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={saveItem} disabled={busy || publishBlocked} className="w-full sm:w-auto">
            {busy
              ? 'Saving...'
              : isOnboardingProofMode
                ? 'Add item to setup'
                : editingItemId
                  ? publish
                    ? 'Update and publish'
                    : 'Update draft'
                  : publish
                    ? 'Save and publish'
                    : 'Save draft'}
          </Button>
          {editingItemId ? (
            <Button
              variant="secondary"
              onClick={resetForm}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              Cancel edit
            </Button>
          ) : null}
        </div>
      </div>
      {data.sellerItems.length > 0 ? (
        <div className="mt-6 border-t border-needle/12 pt-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-xl font-semibold text-ink">
              {isOnboardingProofMode ? 'Saved proof items' : 'Manage existing listings'}
            </h3>
            <Button variant="ghost" size="sm" onClick={resetForm}>
              {isOnboardingProofMode ? 'New proof item' : 'New listing'}
            </Button>
          </div>
          <div className="mt-4 grid gap-3">
            {data.sellerItems.map((item) => {
              const busyForItem = actionBusy?.endsWith(`:${item.id}`) ?? false
              const canEdit = !item.is_live || item.stock_status === 'SOLD_OUT'
              const isHiddenDraft = !item.is_live && item.stock_status === 'HIDDEN'
              const itemPublishBlocked =
                !canPublishLive || (item.pickup_available === true && !hasPickupAddress)
              return (
                <div key={item.id} className="rounded-[8px] border border-ink/8 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                          {safeUserText(item.category, 'Ready-made')}
                        </p>
                        <StatusChip
                          status={
                            isOnboardingProofMode
                              ? 'HIDDEN_SETUP_PROOF'
                              : item.is_live
                                ? 'PUBLISHED'
                                : item.stock_status
                          }
                          fallback="Draft"
                        />
                      </div>
                      <h4 className="mt-1 font-semibold text-ink">
                        {safeUserText(item.title, 'Ready-made item')}
                      </h4>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/58">
                        <span>{formatMoney(item.price_amount, item.currency)}</span>
                        <StatusChip status={item.stock_status} fallback="In stock" />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => startEditItem(item)}
                        disabled={!canEdit || busy || !!actionBusy}
                        variant="secondary"
                        size="sm"
                      >
                        Edit
                      </Button>
                      {!isOnboardingProofMode && item.is_live ? (
                        <Button
                          onClick={() => runSellerItemAction('hide-item', item)}
                          disabled={busy || !!actionBusy}
                          variant="secondary"
                          size="sm"
                        >
                          {busyForItem ? 'Hiding...' : 'Hide'}
                        </Button>
                      ) : !isOnboardingProofMode ? (
                        <Button
                          onClick={() => runSellerItemAction('publish-item', item)}
                          disabled={busy || !!actionBusy || itemPublishBlocked}
                          size="sm"
                        >
                          {busyForItem
                            ? 'Publishing...'
                            : itemPublishBlocked
                              ? 'Publishing locked'
                              : 'Publish'}
                        </Button>
                      ) : null}
                      {isHiddenDraft ? (
                        <Button
                          onClick={() => runSellerItemAction('delete-item', item)}
                          disabled={busy || !!actionBusy}
                          variant="outline"
                          size="sm"
                          className="border-rust/20 text-rust hover:bg-rust/5"
                        >
                          {busyForItem ? 'Deleting...' : 'Delete'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {!isOnboardingProofMode && !canEdit ? (
                    <p className="mt-3 text-xs leading-5 text-ink/50">
                      Unpublish this item before editing details, photos, price, sizes, or stock.
                    </p>
                  ) : null}
                  {!isOnboardingProofMode && itemPublishBlocked && !item.is_live ? (
                    <p className="mt-3 text-xs leading-5 text-rust">
                      {item.pickup_available === true && !hasPickupAddress
                        ? 'Add private pickup details before publishing this pickup item.'
                        : readiness.body}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Surface>
  )
}

export function RenderShop({ data, onRefresh }: { data: ShopRenderData; onRefresh: () => void }) {
  const isTailor = !!data.tailorProfile
  const allItems = isTailor
    ? data.sellerItems
    : data.exploreItems.filter((item) =>
        isReadyMadeBuyableOnWeb(item, firstJoinedRow(item.tailor_profiles))
      )
  const [shopSearch, setShopSearch] = useState('')
  const [shopCategory, setShopCategory] = useState('all')
  const [shopSort, setShopSort] = useState('newest')

  const categories = uniqueValues(
    allItems.map((item) => item.category).filter((c): c is string => !!c)
  ).slice(0, 12)

  const filteredItems = allItems
    .filter((item) => {
      if (shopSearch.trim()) {
        const hay = [
          item.title,
          item.description,
          item.category,
          firstJoinedRow(item.tailor_profiles)?.display_name,
          firstJoinedRow(item.tailor_profiles)?.business_name,
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(shopSearch.trim().toLowerCase())) return false
      }
      if (shopCategory !== 'all' && item.category !== shopCategory) return false
      return true
    })
    .sort((a, b) => {
      if (shopSort === 'price-asc') return (a.price_amount ?? 0) - (b.price_amount ?? 0)
      if (shopSort === 'price-desc') return (b.price_amount ?? 0) - (a.price_amount ?? 0)
      return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
    })

  if (isTailor) {
    return (
      <div className="grid gap-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Total items"
            value={data.sellerItems.length}
            hint="All catalogue records"
            icon={<ShoppingBag />}
          />
          <MetricCard
            label="Published"
            value={data.sellerItems.filter((item) => item.is_live).length}
            hint="Visible to customers"
            icon={<CheckCheck />}
          />
          <MetricCard
            label="Payout"
            value={isPayoutReady(data.tailorProfile) ? 'Ready' : 'Setup needed'}
            hint="Controls checkout availability"
            icon={<WalletCards />}
          />
        </section>
        <SellerItemManager data={data} onRefresh={onRefresh} />
      </div>
    )
  }

  // Customer marketplace view
  return (
    <div className="grid gap-4">
      {/* Search + sort bar */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" />
          <Input
            value={shopSearch}
            onChange={(e) => setShopSearch(e.target.value)}
            placeholder="Search pieces, categories, or tailors..."
            className="pl-9"
          />
        </div>
        <select
          value={shopSort}
          onChange={(e) => setShopSort(e.target.value)}
          className="h-10 rounded-[8px] border border-ui-border bg-white px-3 text-sm font-semibold text-ink outline-none focus:border-needle/40"
        >
          <option value="newest">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>

      {/* Category chips */}
      {categories.length > 0 ? (
        <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
          {(['all', ...categories] as string[]).map((cat) => (
            <Button
              key={cat}
              type="button"
              onClick={() => setShopCategory(cat)}
              variant={shopCategory === cat ? 'primary' : 'secondary'}
              size="sm"
              className="whitespace-nowrap"
            >
              {cat === 'all' ? 'All pieces' : cat}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Explore tailors link */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/52">
          {filteredItems.length} piece{filteredItems.length !== 1 ? 's' : ''}
        </p>
        <Link href="/account/explore" className="text-sm font-semibold text-needle">
          Browse tailors →
        </Link>
      </div>

      {/* Item grid */}
      {filteredItems.length === 0 ? (
        <EmptyState
          title="No pieces match your search."
          body="Try a different category or clear the search."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const tailor = firstJoinedRow(item.tailor_profiles)
            const photo = itemPhoto(item)
            const safeSrc = safeMediaUrl(photo)
            const tailorAvatarSrc = safeMediaUrl(tailor?.avatar_url, 'avatars')
            return (
              <article
                key={item.id}
                className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-needle/8">
                  {safeSrc ? (
                    <Image
                      src={safeSrc}
                      alt={safeUserText(item.title, 'Item')}
                      fill
                      sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">
                      No photo
                    </div>
                  )}
                  {item.category ? (
                    <div className="absolute left-3 top-3">
                      <Badge tone="neutral" className="bg-white/90 shadow-sm backdrop-blur-sm">
                        {item.category}
                      </Badge>
                    </div>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 to-transparent px-4 pb-3 pt-10">
                    <p
                      className="text-sm font-semibold text-white"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                    >
                      {formatMoney(item.price_amount, item.currency)}
                    </p>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-xl font-semibold text-ink">
                    {safeUserText(item.title, 'Ready-made item')}
                  </h3>
                  {tailor ? (
                    <Link
                      href={accountRoute(`/account/tailors/${tailor.id}`)}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm text-needle hover:underline"
                    >
                      {tailorAvatarSrc ? (
                        <span className="relative inline-block h-5 w-5 overflow-hidden rounded-full bg-needle/10">
                          <Image
                            src={tailorAvatarSrc}
                            alt=""
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        </span>
                      ) : null}
                      {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                    </Link>
                  ) : null}
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/58">
                    {fulfillmentSummary(item)}
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button asChild variant="secondary">
                      <Link href={accountRoute(`/account/items/${item.id}`)}>View item</Link>
                    </Button>
                    {tailor?.id ? (
                      <Button asChild>
                        <Link href={accountRoute(`/account/tailors/${tailor.id}`)}>
                          View tailor
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
