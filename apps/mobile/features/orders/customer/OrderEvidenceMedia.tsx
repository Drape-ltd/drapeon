import type { StyleProp, ImageStyle, ViewStyle } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

import { PortfolioVideoPreview, RemoteImage } from '@/components/ui'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'

export const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo
export const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo

export function isVideoUri(uri: string | null | undefined) {
  return typeof uri === 'string' && /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/iu.test(uri)
}

export function orderEvidenceContentType(asset: ImagePicker.ImagePickerAsset) {
  const normalizedMimeType = asset.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (
    normalizedMimeType &&
    (ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(normalizedMimeType)
  ) return normalizedMimeType

  const extension = (asset.fileName ?? asset.uri).match(/\.([a-z0-9]+)(?:[?#].*)?$/iu)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'mov') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return asset.type === 'video' ? 'video/mp4' : 'image/jpeg'
}

export function orderEvidenceExtension(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'video/quicktime') return 'mov'
  if (contentType === 'video/mp4') return 'mp4'
  return 'jpg'
}

function orderEvidenceDurationSeconds(asset: ImagePicker.ImagePickerAsset) {
  if (typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0) return null
  return asset.duration > 1000 ? asset.duration / 1000 : asset.duration
}

export function validateOrderEvidenceAsset(asset: ImagePicker.ImagePickerAsset) {
  const contentType = orderEvidenceContentType(asset)
  const isVideo = asset.type === 'video' || (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)
  if (!isVideo) return null

  if (!(ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return 'That video type is not supported here. Please choose an MP4 or MOV video.'
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > ORDER_EVIDENCE_VIDEO_MAX_BYTES) {
    return `Choose videos under ${Math.round(ORDER_EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
  }
  const durationSeconds = orderEvidenceDurationSeconds(asset)
  if (durationSeconds && durationSeconds > ORDER_EVIDENCE_VIDEO_MAX_SECONDS) {
    return OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE
  }
  return null
}

export function StageMediaPreview({
  uri,
  style,
  surface,
  accessibilityLabel,
}: {
  uri: string
  style: StyleProp<ImageStyle>
  surface: string
  accessibilityLabel?: string
}) {
  if (isVideoUri(uri)) {
    return (
      <PortfolioVideoPreview
        uri={uri}
        style={style as StyleProp<ViewStyle>}
        contentFit="contain"
        nativeControls
        autoplay={false}
        isLooping={false}
      />
    )
  }
  return (
    <RemoteImage
      uri={uri}
      bucket="order-photos"
      style={style}
      contentFit="cover"
      transition={120}
      surface={surface}
      accessibilityLabel={accessibilityLabel}
    />
  )
}
