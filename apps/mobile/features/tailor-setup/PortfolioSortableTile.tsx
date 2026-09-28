/**
 * Tailor profile setup wizard — 4 steps
 * Step 0: Identity (display name, phone, location, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (at least one work sample)
 * Step 3: Fulfillment + private trust-video verification
 */
import { PortfolioVideoPreview, RemoteImage } from '@/components/ui'
import { Colors } from '@/constants/theme'
import { styles } from '@/features/tailor-setup/TailorSetupStyles'
import type { PortfolioItem } from '@/features/tailor-setup/TailorSetupTypes'
import { Feather } from '@expo/vector-icons'
import { useEffect, useMemo, useRef } from 'react'
import { Animated, PanResponder, Text, TouchableOpacity, Vibration, View } from 'react-native'

export function PortfolioSortableTile({
  item,
  index,
  isCover,
  dragging,
  onOpen,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
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
}) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragActiveRef = useRef(false)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const opacityAnim = useRef(new Animated.Value(1)).current
  // Stable callback refs so the PanResponder (created once) always calls current props
  const onDragStartRef = useRef(onDragStart)
  const onDragMoveRef = useRef(onDragMove)
  const onDragEndRef = useRef(onDragEnd)
  const onOpenRef = useRef(onOpen)
  onDragStartRef.current = onDragStart
  onDragMoveRef.current = onDragMove
  onDragEndRef.current = onDragEnd
  onOpenRef.current = onOpen

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragActiveRef.current = false
          longPressTimerRef.current = setTimeout(() => {
            dragActiveRef.current = true
            Vibration.vibrate(30)
            onDragStartRef.current()
            Animated.spring(scaleAnim, {
              toValue: 1.05,
              useNativeDriver: true,
              friction: 6,
              tension: 200,
            }).start()
            Animated.spring(opacityAnim, {
              toValue: 0.7,
              useNativeDriver: true,
              friction: 6,
              tension: 200,
            }).start()
          }, 400)
        },
        onPanResponderMove: (_, gesture) => {
          if (!dragActiveRef.current && (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5)) {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
            return
          }
          if (dragActiveRef.current) {
            onDragMoveRef.current(gesture.dx, gesture.dy)
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          const wasDrag = dragActiveRef.current
          dragActiveRef.current = false
          Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
            tension: 200,
          }).start()
          Animated.spring(opacityAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
            tension: 200,
          }).start()
          if (wasDrag) {
            onDragEndRef.current(gesture.dx, gesture.dy)
          } else {
            onOpenRef.current()
          }
        },
        onPanResponderTerminate: (_, gesture) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
          }
          const wasDrag = dragActiveRef.current
          dragActiveRef.current = false
          Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
            tension: 200,
          }).start()
          Animated.spring(opacityAnim, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
            tension: 200,
          }).start()
          if (wasDrag) {
            onDragEndRef.current(gesture.dx, gesture.dy)
          }
        },
      }),
    []
  )

  return (
    <View style={styles.portfolioThumb}>
      <Animated.View
        style={[
          styles.portfolioThumbPress,
          dragging && styles.portfolioThumbDragging,
          { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
        ]}
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={`Open portfolio media ${index + 1}`}
      >
        {item.type === 'photo' ? (
          <RemoteImage
            uri={item.url}
            style={styles.portfolioImg}
            contentFit="cover"
            contentPosition="top"
            transition={120}
            surface="tailor_setup_portfolio_preview"
          />
        ) : (
          <View style={[styles.portfolioImg, styles.videoThumb]}>
            <PortfolioVideoPreview uri={item.url} style={styles.portfolioImg} autoplay={false} />
            <View style={styles.videoBadge}>
              <Feather name="play" size={12} color={Colors.textInverse} />
              <Text style={styles.videoLabel}>Video</Text>
            </View>
          </View>
        )}
        {isCover ? (
          <View style={styles.coverBadge}>
            <Text style={styles.coverBadgeText}>Cover</Text>
          </View>
        ) : null}
        {dragging ? (
          <View style={styles.portfolioDragBadge}>
            <Text style={styles.portfolioDragBadgeText}>Drop to reorder</Text>
          </View>
        ) : null}
      </Animated.View>
      <TouchableOpacity
        style={styles.portfolioRemove}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Remove portfolio media"
      >
        <Text style={styles.portfolioRemoveText}>x</Text>
      </TouchableOpacity>
    </View>
  )
}
