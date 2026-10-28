import { PortfolioVideoPreview, RemoteImage } from '@/components/ui'
import { Colors } from '@/constants/theme'
import { styles } from '@/features/tailor-setup/TailorSetupStyles'
import type { PortfolioItem } from '@/features/tailor-setup/TailorSetupTypes'
import { marketplaceMediaContentPosition } from '@drape/shared'
import { Feather } from '@expo/vector-icons'
import { useRef, useState } from 'react'
import { Text, TouchableOpacity, Vibration, View } from 'react-native'

/** Shared media tile for onboarding and portfolio management. */
export function PortfolioSortableTile({
  item, index, isCover, dragging, onOpen, onDelete,
  onDragStart, onDragMove, onDragEnd,
  width, height, focalX = 0.5, focalY = 0.5,
  hideRemove = false, durationLabel,
}: {
  item: PortfolioItem
  index: number
  isCover: boolean
  dragging: boolean
  onOpen: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragMove: (dx: number, dy: number) => void
  onDragEnd: (dx: number, dy: number) => void
  width?: number
  height?: number
  focalX?: number
  focalY?: number
  hideRemove?: boolean
  durationLabel?: string
}) {
  const touchStart = useRef({ x: 0, y: 0 })
  const lastDelta = useRef({ x: 0, y: 0 })
  const dragActive = useRef(false)
  const skipPress = useRef(false)
  const [videoSeconds, setVideoSeconds] = useState<number | null>(null)
  const size = width ? { width, height: height ?? width } : null

  function finishDrag() {
    if (!dragActive.current) return
    dragActive.current = false
    onDragEnd(lastDelta.current.x, lastDelta.current.y)
  }

  return (
    <View
      style={[styles.portfolioThumb, size]}
      onTouchStart={(event) => {
        skipPress.current = false
        touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
        lastDelta.current = { x: 0, y: 0 }
      }}
      onTouchMove={(event) => {
        const dx = event.nativeEvent.pageX - touchStart.current.x
        const dy = event.nativeEvent.pageY - touchStart.current.y
        if (!dragActive.current) {
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) skipPress.current = true
          return
        }
        lastDelta.current = { x: dx, y: dy }
        onDragMove(dx, dy)
      }}
      onTouchEnd={finishDrag}
      onTouchCancel={finishDrag}
    >
      <TouchableOpacity
        style={[styles.portfolioThumbPress, size, dragging && styles.portfolioThumbDragging]}
        activeOpacity={0.86}
        delayLongPress={400}
        onPress={() => {
          if (skipPress.current) { skipPress.current = false; return }
          onOpen()
        }}
        onLongPress={() => {
          skipPress.current = true
          dragActive.current = true
          Vibration.vibrate(30)
          onDragStart()
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open portfolio ${item.type} ${index + 1}. Hold to reorder.`}
      >
        {item.type === 'photo' ? (
          <RemoteImage
            uri={item.url}
            style={[styles.portfolioImg, size]}
            contentFit="cover"
            contentPosition={marketplaceMediaContentPosition({ focalX, focalY })}
            transition={120}
            surface="tailor_setup_portfolio_preview"
          />
        ) : (
          <View style={[styles.portfolioImg, styles.videoThumb, size]}>
            <PortfolioVideoPreview uri={item.url} style={[styles.portfolioImg, size]} autoplay={false} onDuration={setVideoSeconds} />
            <View style={styles.videoBadge}>
              <Feather name="play" size={12} color={Colors.textInverse} />
              <Text style={styles.videoLabel}>{durationLabel ?? (videoSeconds != null ? `${Math.floor(videoSeconds / 60)}:${String(videoSeconds % 60).padStart(2, '0')}` : 'Video')}</Text>
            </View>
          </View>
        )}
        {isCover ? <View style={styles.coverBadge}><Text style={styles.coverBadgeText}>Cover</Text></View> : null}
        {dragging ? <View style={styles.portfolioDragBadge}><Text style={styles.portfolioDragBadgeText}>Drop to reorder</Text></View> : null}
      </TouchableOpacity>
      {!hideRemove && <TouchableOpacity
        style={styles.portfolioRemove}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Remove portfolio media"
      ><Text style={styles.portfolioRemoveText}>x</Text></TouchableOpacity>}
    </View>
  )
}
