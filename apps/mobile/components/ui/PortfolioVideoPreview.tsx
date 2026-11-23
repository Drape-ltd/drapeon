import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { ResizeMode, Video } from 'expo-av'
import { Colors } from '@/constants/theme'
import { supabase } from '@/lib/supabase'
import { orderMediaStoragePath } from '@drape/shared/order-media'

type PortfolioVideoPreviewProps = {
  uri: string
  style?: StyleProp<ViewStyle>
  contentFit?: 'contain' | 'cover' | 'fill'
  nativeControls?: boolean
  autoplay?: boolean
  isLooping?: boolean
  showMuteToggle?: boolean
  onFirstFrame?: () => void
  onDuration?: (seconds: number) => void
  bucket?: 'order-photos'
}

export function PortfolioVideoPreview({
  uri,
  style,
  contentFit = 'cover',
  nativeControls = false,
  autoplay = true,
  isLooping = true,
  showMuteToggle,
  onFirstFrame,
  onDuration,
  bucket,
}: PortfolioVideoPreviewProps) {
  const videoRef = useRef<Video>(null)
  const [isMuted, setIsMuted] = useState(true)
  const orderMediaPath = bucket === 'order-photos' ? orderMediaStoragePath(uri) : null
  const [signedOrderMedia, setSignedOrderMedia] = useState<string | null>(null)

  useEffect(() => {
    if (!orderMediaPath) {
      setSignedOrderMedia(null)
      return undefined
    }
    let cancelled = false
    void supabase.storage.from('order-photos').createSignedUrl(orderMediaPath, 10 * 60)
      .then(({ data, error }) => {
        if (!cancelled) setSignedOrderMedia(error ? null : data?.signedUrl ?? null)
      })
    return () => { cancelled = true }
  }, [orderMediaPath])
  const playbackUri = orderMediaPath ? signedOrderMedia : uri
  const resizeMode =
    contentFit === 'contain'
      ? ResizeMode.CONTAIN
      : contentFit === 'fill'
        ? ResizeMode.STRETCH
        : ResizeMode.COVER
  const shouldShowMuteToggle = showMuteToggle ?? nativeControls

  useEffect(() => {
    const player = videoRef.current
    return () => {
      void player?.unloadAsync().catch(() => {})
    }
  }, [playbackUri])

  useEffect(() => {
    if (autoplay) return
    void videoRef.current?.pauseAsync().catch(() => {})
  }, [autoplay])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        void videoRef.current?.pauseAsync().catch(() => {})
      }
    })

    return () => subscription.remove()
  }, [])

  return (
    <View style={[style, styles.wrap]}>
      {playbackUri ? <Video
        ref={videoRef}
        source={{ uri: playbackUri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        shouldPlay={autoplay}
        isMuted={isMuted}
        isLooping={isLooping}
        useNativeControls={nativeControls}
        progressUpdateIntervalMillis={1000}
        onReadyForDisplay={onFirstFrame}
        onLoad={(status) => {
          if (status.isLoaded && typeof status.durationMillis === 'number') onDuration?.(Math.round(status.durationMillis / 1000))
        }}
      /> : null}
      {shouldShowMuteToggle ? (
        <TouchableOpacity
          style={styles.soundToggle}
          onPress={() => setIsMuted((value) => !value)}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
        >
          <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={18} color={Colors.textInverse} />
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  soundToggle: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
})
