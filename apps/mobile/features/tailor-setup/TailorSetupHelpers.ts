/**
 * Tailor profile setup wizard — 4 steps
 * Step 0: Identity (display name, phone, location, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (at least one work sample)
 * Step 3: Fulfillment + private trust-video verification
 */
import type { TagGroup } from '@/components/ui'
import { Spacing } from '@/constants/theme'
import { MAX_PORTFOLIO_VIDEO_SECONDS } from '@/features/tailor-setup/TailorSetupLimits'
import type { PortfolioItem } from '@/features/tailor-setup/TailorSetupTypes'
import { validateVideoPickerAsset } from '@/lib/video-asset'
import { TAILOR_LANGUAGE_GROUPS, TAILOR_SPECIALTY_GROUPS } from '@drape/shared'
import { MEDIA_LIMITS_BYTES, VIDEO_DURATION_LIMIT_MESSAGE } from '@drape/shared/media-policy'
import { type TailorSetupField, type TailorSetupStep } from '@drape/shared/tailor-setup'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import { Platform, UIManager } from 'react-native'

type PortfolioGridEntry = { item: PortfolioItem; originalIndex: number }
export const MAX_PORTFOLIO_VIDEOS = 4
export const MAX_PORTFOLIO_VIDEO_BYTES = MEDIA_LIMITS_BYTES.portfolioVideo
export const MAX_LANGUAGE_TAGS = 12
export const MAX_SPECIALTY_TAGS = 20
export const PORTFOLIO_GRID_COLUMNS = 3
export const PORTFOLIO_GRID_TILE_SIZE = 100
export const PORTFOLIO_GRID_CELL_SIZE = PORTFOLIO_GRID_TILE_SIZE + Spacing.sm

export const STEP_TITLES = ['Your identity', 'What you make', 'Portfolio', 'Setup & verification']
export const STEP_SUBS = [
  'This is your public tailor profile. No contact details here. Buyers find you through Drapeon.',
  'Tell people what you make, your business type, and what to expect on price.',
  'Add at least one real work sample. More photos help buyers trust your profile faster.',
  'Confirm handoff options, order status, and record a private trust video for review.',
]
export const INVALID_PROFILE_IMAGE_REJECTION_CODE = 'INVALID_PROFILE_IMAGE'
export const INVALID_PORTFOLIO_MEDIA_REJECTION_CODE = 'INVALID_PORTFOLIO_MEDIA'
export const PROFILE_IMAGE_REJECTION_MESSAGE =
  'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.'
export const SETUP_STEP_IDS: TailorSetupStep[] = [0, 1, 2, 3]
export const STEP_LABELS = ['Identity', 'Specialties', 'Portfolio', 'Setup']
export const SETUP_ERROR_FIELD_PRIORITY: Record<TailorSetupStep, TailorSetupField[]> = {
  0: ['profilePhoto', 'displayName', 'phone', 'location', 'bio', 'languages'],
  1: ['specialties', 'priceRange'],
  2: ['portfolio'],
  3: ['orderMode', 'fulfillment', 'pickupAddress', 'idDocument'],
}
// Shared with web so onboarding never drifts into a second taxonomy.
export const LANGUAGE_GROUPS: TagGroup[] = TAILOR_LANGUAGE_GROUPS
export const SPECIALTY_GROUPS: TagGroup[] = TAILOR_SPECIALTY_GROUPS
export const BIO_PROMPTS = [
  'What you make best',
  'Who you usually sew for',
  'How fittings and timelines work',
] as const
export const PRICE_PRESETS: Array<{
  label: string
  currency: 'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD'
  min: string
  max: string
}> = [
  { label: 'Budget', currency: 'NGN', min: '50000', max: '120000' },
  { label: 'Mid-range', currency: 'NGN', min: '120000', max: '300000' },
  { label: 'Premium', currency: 'NGN', min: '300000', max: '800000' },
] as const
export const FOCUSED_FIELD_SCROLL_DELAY_MS = 140
export const FOCUSED_FIELD_TOP_OFFSET = 96
export const PHONE_AVAILABILITY_DEBOUNCE_MS = 650
export const TAILOR_SETUP_DRAFT_VERSION = 1
export const TRUST_VIDEO_DRAFT_DIRECTORY = 'drapeon-trust-video-drafts'

export function tailorSetupDraftKey(userId: string) {
  return `drape:tailor-setup-draft:v${TAILOR_SETUP_DRAFT_VERSION}:${userId}`
}

export function trustVideoDraftDirectory() {
  const documentDirectory = FileSystem.documentDirectory
  return documentDirectory ? `${documentDirectory}${TRUST_VIDEO_DRAFT_DIRECTORY}/` : null
}

export function trustVideoDraftExtension(contentType: 'video/mp4' | 'video/quicktime') {
  return contentType === 'video/quicktime' ? 'mov' : 'mp4'
}

export async function persistTrustVideoDraft(
  uri: string,
  userId: string,
  contentType: 'video/mp4' | 'video/quicktime'
) {
  const directory = trustVideoDraftDirectory()
  // ImagePicker can return either a file URI or an Android content URI. Both
  // are local inputs that FileSystem can copy; only an already-remote URI
  // should be left untouched.
  if (!directory || /^https?:\/\//iu.test(uri)) return uri
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  const destination = `${directory}${userId}-${Date.now()}.${trustVideoDraftExtension(contentType)}`
  await FileSystem.copyAsync({ from: uri, to: destination })
  return destination
}

export async function removeTrustVideoDraft(uri: string | null | undefined) {
  const directory = trustVideoDraftDirectory()
  if (!directory || !uri?.startsWith(directory)) return
  await FileSystem.deleteAsync(uri, { idempotent: true })
}

export function currencySyncRetryDelayMs(attempt: number) {
  return 450 * 2 ** attempt + Math.floor(Math.random() * 250)
}

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

export function getPortfolioDropTargetIndex(
  fromIndex: number,
  dx: number,
  dy: number,
  itemCount: number
) {
  if (itemCount <= 0 || fromIndex < 0 || fromIndex >= itemCount) return null
  const columnDelta = Math.round(dx / PORTFOLIO_GRID_CELL_SIZE)
  const rowDelta = Math.round(dy / PORTFOLIO_GRID_CELL_SIZE)
  const rawTargetIndex = fromIndex + columnDelta + rowDelta * PORTFOLIO_GRID_COLUMNS
  return Math.max(0, Math.min(itemCount - 1, rawTargetIndex))
}

export function previewPortfolioGridEntries(
  items: PortfolioItem[],
  dragIndex: number | null,
  hoverIndex: number | null
): PortfolioGridEntry[] {
  const entries = items.map((item, originalIndex) => ({ item, originalIndex }))
  if (
    dragIndex == null ||
    hoverIndex == null ||
    dragIndex < 0 ||
    dragIndex >= entries.length ||
    hoverIndex < 0 ||
    hoverIndex >= entries.length ||
    dragIndex === hoverIndex
  ) {
    return entries
  }
  const next = [...entries]
  const [dragged] = next.splice(dragIndex, 1)
  if (!dragged) return entries
  next.splice(hoverIndex, 0, dragged)
  return next
}

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function readStringField(
  record: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

export function readIdentityRejectionCode(row: {
  id_verification_metadata?: Record<string, unknown> | null
}) {
  const metadata =
    row.id_verification_metadata && typeof row.id_verification_metadata === 'object'
      ? row.id_verification_metadata
      : null
  const nested =
    metadata?.identity_verification && typeof metadata.identity_verification === 'object'
      ? (metadata.identity_verification as Record<string, unknown>)
      : null
  return (
    readStringField(metadata, ['rejection_code', 'rejectionCode']) ??
    readStringField(nested, ['rejection_code', 'rejectionCode']) ??
    ''
  ).toUpperCase()
}

export function isProfileImageRejectionCode(code: string | null | undefined) {
  return (code ?? '').trim().toUpperCase() === INVALID_PROFILE_IMAGE_REJECTION_CODE
}

export function isPortfolioMediaRejectionCode(code: string | null | undefined) {
  return (code ?? '').trim().toUpperCase() === INVALID_PORTFOLIO_MEDIA_REJECTION_CODE
}

export function readIdentityRejectionMessage(row: {
  id_verification_rejection_reason?: string | null
  id_verification_metadata?: Record<string, unknown> | null
}) {
  const rejectionCode = readIdentityRejectionCode(row)
  if (isProfileImageRejectionCode(rejectionCode)) return PROFILE_IMAGE_REJECTION_MESSAGE

  const direct = row.id_verification_rejection_reason?.trim()
  if (direct) return direct

  const metadata =
    row.id_verification_metadata && typeof row.id_verification_metadata === 'object'
      ? row.id_verification_metadata
      : null
  const nested =
    metadata?.identity_verification && typeof metadata.identity_verification === 'object'
      ? (metadata.identity_verification as Record<string, unknown>)
      : null
  return (
    readStringField(metadata, [
      'rejection_reason',
      'rejectionReason',
      'moderation_note',
      'moderationMessage',
      'reason',
      'note',
    ]) ??
    readStringField(nested, [
      'rejection_reason',
      'rejectionReason',
      'moderation_note',
      'moderationMessage',
      'reason',
      'note',
    ]) ??
    'Trust review needs a clearer retake. Record the challenge again with your face, voice, and full private phrase clearly captured.'
  )
}

export function portfolioAssetDuplicateKey(asset: ImagePicker.ImagePickerAsset) {
  const assetId = typeof asset.assetId === 'string' ? asset.assetId.trim() : ''
  if (assetId.length > 0) return `${asset.type ?? 'media'}:asset:${assetId}`

  const contentType = asset.mimeType?.split(';')[0]?.trim().toLowerCase() ?? asset.type ?? 'media'
  const fileName = typeof asset.fileName === 'string' ? asset.fileName.trim().toLowerCase() : ''
  const fileSize =
    typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize)
      ? String(asset.fileSize)
      : ''
  const dimensions =
    typeof asset.width === 'number' && typeof asset.height === 'number'
      ? `${asset.width}x${asset.height}`
      : ''
  const duration =
    typeof asset.duration === 'number' && Number.isFinite(asset.duration)
      ? String(Math.round(asset.duration))
      : ''
  const metadataKey = [contentType, fileName, fileSize, dimensions, duration]
    .filter((part) => part.length > 0)
    .join(':')

  return metadataKey
    ? `${asset.type ?? 'media'}:meta:${metadataKey}`
    : `${asset.type ?? 'media'}:uri:${asset.uri}`
}

export function validatePortfolioVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  return validateVideoPickerAsset(asset, {
    maxBytes: MAX_PORTFOLIO_VIDEO_BYTES,
    maxSeconds: MAX_PORTFOLIO_VIDEO_SECONDS,
    maxBytesMessage: `Choose portfolio videos under ${Math.round(MAX_PORTFOLIO_VIDEO_BYTES / (1024 * 1024))} MB.`,
    durationMessage: VIDEO_DURATION_LIMIT_MESSAGE,
    skipNonVideo: true,
  })
}
