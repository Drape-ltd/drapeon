import React, { memo, useMemo, useState } from 'react'
import { StyleProp, View, ViewStyle } from 'react-native'
import { Image, type ImageProps } from 'expo-image'
import { Colors } from '@/constants/theme'
import {
  captureImageLoadFailure,
  PORTFOLIO_IMAGE_PLACEHOLDER,
  resolveStorageImageUrl,
  resolveStorageThumbnailUrl,
  type StorageImageBucket,
} from '@/lib/image-url'

const MAX_IMAGE_LOAD_ATTEMPTS = 2

type RemoteImageProps = Omit<ImageProps, 'source' | 'placeholder' | 'onError'> & {
  uri?: string | null
  bucket?: StorageImageBucket
  containerStyle?: StyleProp<ViewStyle>
  fallback?: React.ReactNode
  placeholder?: ImageProps['placeholder']
  placeholderColor?: string
  surface?: string
  onLoadError?: (url: string | null) => void
  thumbnailWidth?: number
}

function RemoteImageComponent({
  uri,
  bucket,
  containerStyle,
  fallback,
  placeholder = PORTFOLIO_IMAGE_PLACEHOLDER,
  placeholderColor = Colors.boneDeep,
  surface,
  onLoadError,
  thumbnailWidth,
  style,
  contentFit = 'cover',
  cachePolicy = 'memory-disk',
  transition = 300,
  ...imageProps
}: RemoteImageProps) {
  const resolvedUri = useMemo(() => resolveStorageImageUrl(uri, bucket), [bucket, uri])
  const thumbnailUri = useMemo(
    () => thumbnailWidth ? resolveStorageThumbnailUrl(uri, bucket, thumbnailWidth) : resolvedUri,
    [bucket, resolvedUri, thumbnailWidth, uri],
  )
  const [loadFailure, setLoadFailure] = useState<{ uri: string; attempts: number } | null>(null)
  const attempts = thumbnailUri && loadFailure?.uri === thumbnailUri ? loadFailure.attempts : 0
  const failed = !!resolvedUri && attempts >= MAX_IMAGE_LOAD_ATTEMPTS
  const activeCachePolicy = attempts > 0 ? 'none' : cachePolicy
  const activeUri = attempts > 0 && thumbnailUri !== resolvedUri ? resolvedUri : thumbnailUri

  if (!resolvedUri || failed) {
    return (
      <View style={containerStyle}>
        {fallback ?? <View style={[{ backgroundColor: placeholderColor }, style as StyleProp<ViewStyle>]} />}
      </View>
    )
  }

  return (
    <View style={containerStyle}>
      <Image
        {...imageProps}
        source={{ uri: activeUri ?? resolvedUri }}
        recyclingKey={`${activeUri}:${attempts}`}
        style={[{ backgroundColor: placeholderColor }, style]}
        contentFit={contentFit}
        cachePolicy={activeCachePolicy}
        transition={attempts > 0 ? 0 : transition}
        placeholder={placeholder}
        onError={(error) => {
          const nextAttempts = Math.min(MAX_IMAGE_LOAD_ATTEMPTS, attempts + 1)
          const willRetry = nextAttempts < MAX_IMAGE_LOAD_ATTEMPTS
          setLoadFailure({ uri: thumbnailUri ?? resolvedUri, attempts: nextAttempts })
          captureImageLoadFailure({
            url: activeUri,
            bucket,
            surface,
            error,
            attempt: nextAttempts,
            willRetry,
            cachePolicy: String(activeCachePolicy),
          })
          if (!willRetry) onLoadError?.(resolvedUri)
        }}
      />
    </View>
  )
}

export const RemoteImage = memo(RemoteImageComponent)
