import { PortfolioVideoPreview, RemoteImage } from '@/components/ui'
import { Colors, Spacing } from '@/constants/theme'
import { Feather } from '@expo/vector-icons'
import { useEffect, useRef } from 'react'
import { FlatList, Modal, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { styles } from './TailorSetupStyles'
import type { PortfolioItem } from './TailorSetupTypes'

export function PortfolioMediaManagerModal({
  items,
  index,
  onIndexChange,
  onClose,
  onReplace,
  onDelete,
}: {
  items: PortfolioItem[]
  index: number
  onIndexChange: (index: number | null) => void
  onClose: () => void
  onReplace: () => void
  onDelete: () => void
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const pageWidth = Math.max(280, width - Spacing.lg * 2)
  const activeIndex = Math.max(0, Math.min(index, items.length - 1))
  const activeItem = items[activeIndex] ?? null
  const listRef = useRef<FlatList<PortfolioItem> | null>(null)

  useEffect(() => {
    if (!activeItem) return
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: activeIndex, animated: false })
    })
  }, [activeIndex, activeItem, pageWidth])

  if (!activeItem) return null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.mediaManagerOverlay}>
        <TouchableOpacity style={styles.mediaManagerScrim} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.mediaManagerSheet,
            { paddingBottom: Math.max(insets.bottom + Spacing.lg, Spacing.xl) },
          ]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.mediaManagerHeader}>
            <View>
              <Text style={styles.mediaManagerEyebrow}>Portfolio media</Text>
              <Text style={styles.mediaManagerTitle}>
                {activeIndex === 0 ? 'Cover media' : `Media ${activeIndex + 1} of ${items.length}`}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.sheetClose}
              onPress={onClose}
              accessibilityLabel="Close media preview"
            >
              <Text style={styles.sheetCloseText}>x</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.mediaManagerPreview, { width: pageWidth }]}>
            <FlatList
              ref={listRef}
              data={items}
              keyExtractor={(item, itemIndex) => `${item.type}-${item.url}-${itemIndex}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={activeIndex}
              getItemLayout={(_, itemIndex) => ({
                length: pageWidth,
                offset: pageWidth * itemIndex,
                index: itemIndex,
              })}
              onScrollToIndexFailed={() => undefined}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth)
                onIndexChange(Math.max(0, Math.min(items.length - 1, nextIndex)))
              }}
              renderItem={({ item, index: itemIndex }) => (
                <View style={[styles.mediaManagerCarouselPage, { width: pageWidth }]}>
                  {item.type === 'photo' ? (
                    <RemoteImage
                      uri={item.url}
                      style={styles.mediaManagerPreviewMedia}
                      contentFit="cover"
                      contentPosition="top"
                      transition={120}
                      surface="tailor_setup_portfolio_manager"
                    />
                  ) : (
                    <PortfolioVideoPreview
                      uri={item.url}
                      style={styles.mediaManagerPreviewMedia}
                      contentFit="contain"
                      nativeControls
                      autoplay={itemIndex === activeIndex}
                    />
                  )}
                </View>
              )}
            />
          </View>

          <View style={styles.mediaManagerDots}>
            {items.map((item, itemIndex) => (
              <View
                key={`${item.type}-${item.url}-${itemIndex}-dot`}
                style={[
                  styles.mediaManagerDot,
                  itemIndex === activeIndex && styles.mediaManagerDotActive,
                ]}
              />
            ))}
          </View>

          <Text style={styles.mediaManagerHint}>
            Drag thumbnails in the grid to change the cover and order.
          </Text>

          <View style={styles.mediaManagerActions}>
            <View style={styles.mediaManagerActionRow}>
              <TouchableOpacity
                style={[styles.mediaManagerAction, styles.mediaManagerActionCompact]}
                onPress={onReplace}
                activeOpacity={0.82}
              >
                <Feather name="refresh-cw" size={16} color={Colors.needleGreen} />
                <Text style={styles.mediaManagerActionText}>Replace</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.mediaManagerAction,
                  styles.mediaManagerActionCompact,
                  styles.mediaManagerActionDestructive,
                ]}
                onPress={onDelete}
                activeOpacity={0.82}
              >
                <Feather name="trash-2" size={16} color={Colors.kanteRust} />
                <Text
                  style={[styles.mediaManagerActionText, styles.mediaManagerActionTextDestructive]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}
