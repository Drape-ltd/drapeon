import type { ImagePickerAsset } from 'expo-image-picker'
import { type ImageStyle, type StyleProp, type ViewStyle } from 'react-native'
import { PortfolioVideoPreview, RemoteImage } from '@/components/ui'
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'

export type StageMediaType = 'image' | 'video'

export type StageMedia = {
  uri: string
  originalUri?: string
  type: StageMediaType
  fingerprint: string
  width?: number | null
  height?: number | null
  duration?: number | null
  fileSize?: number | null
  mimeType?: string | null
  crop?: {
    x: number
    y: number
    width: number
    height: number
    rotation: 0
    aspectRatio: '4:3'
    sourceWidth: number
    sourceHeight: number
  } | null
}

export function isOrderEvidenceVideoUri(uri: string | null | undefined) {
  return typeof uri === 'string' && /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/iu.test(uri)
}

export function stageMediaFromAsset(asset: ImagePickerAsset): StageMedia {
  const type: StageMediaType = asset.type === 'video' ? 'video' : 'image'
  const fingerprintParts = [asset.assetId, asset.fileName, asset.fileSize, asset.width, asset.height, asset.duration, type]
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
  return {
    uri: asset.uri,
    type,
    duration: asset.duration ?? null,
    fileSize: asset.fileSize ?? null,
    mimeType: asset.mimeType ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    fingerprint: fingerprintParts.length > 0 ? fingerprintParts.join('|') : `${type}|${asset.uri}`,
  }
}

export function stageMediaExtension(media: StageMedia) {
  if (media.type === 'image') return 'jpg'
  const extension = media.uri.match(/\.([a-z0-9]+)(?:[?#].*)?$/iu)?.[1]?.toLowerCase()
  return extension === 'mov' ? extension : 'mp4'
}

export function stageMediaContentType(media: StageMedia) {
  if (media.type === 'image') return 'image/jpeg'
  const mimeType = media.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (mimeType && (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(mimeType)) return mimeType
  return stageMediaExtension(media) === 'mov' ? 'video/quicktime' : 'video/mp4'
}

function stageMediaDurationSeconds(media: StageMedia) {
  if (typeof media.duration !== 'number' || !Number.isFinite(media.duration) || media.duration <= 0) return null
  return media.duration > 1000 ? media.duration / 1000 : media.duration
}

export function validateStageMedia(media: StageMedia) {
  if (media.type !== 'video') return null
  const contentType = stageMediaContentType(media)
  if (!(ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return 'That video type is not supported here. Please choose an MP4 or MOV video.'
  }
  if (typeof media.fileSize === 'number' && media.fileSize > MEDIA_LIMITS_BYTES.orderUpdateVideo) {
    return `Choose videos under ${Math.round(MEDIA_LIMITS_BYTES.orderUpdateVideo / (1024 * 1024))} MB.`
  }
  const durationSeconds = stageMediaDurationSeconds(media)
  if (durationSeconds && durationSeconds > MEDIA_LIMITS_SECONDS.orderUpdateVideo) return OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE
  return null
}

export function StageMediaPreview({
  uri,
  mediaType,
  style,
  surface,
}: {
  uri: string
  mediaType?: StageMediaType
  style: StyleProp<ImageStyle>
  surface: string
}) {
  if (mediaType === 'video' || isOrderEvidenceVideoUri(uri)) {
    return <PortfolioVideoPreview uri={uri} style={style as StyleProp<ViewStyle>} contentFit="contain" nativeControls autoplay={false} isLooping={false} />
  }
  return <RemoteImage uri={uri} bucket="order-photos" style={style} contentFit="cover" transition={120} surface={surface} />
}
