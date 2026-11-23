import { StyleSheet, Text, View } from 'react-native'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

export type OrderProgressTrackStep = { labels: string[]; current: number }

const DELIVERY_STAGES = ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'SHIPPED', 'OUT_FOR_DELIVERY']
const DONE_STAGES = ['DELIVERED', 'COLLECTED', 'COMPLETE']

/** The macro steps an order moves through, shared by the customer and tailor order screens. */
export function orderProgressSteps(input: {
  stage: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  isCollection: boolean
  terminalComplete?: boolean
}): OrderProgressTrackStep {
  const deliveryLabel = input.isCollection ? 'Pickup' : 'Delivery'
  const readyMade = input.orderKind === 'READY_MADE'
  const labels = readyMade
    ? ['Confirmed', 'Preparing', deliveryLabel, 'Received']
    : ['Confirmed', 'Fabric', 'Making', deliveryLabel, 'Received']
  const stage = input.stage
  let current: number
  if (DONE_STAGES.includes(stage) || input.terminalComplete) current = labels.length
  else if (DELIVERY_STAGES.includes(stage)) current = labels.length - 2
  else if (readyMade) current = stage === 'CONFIRMED' ? 0 : 1
  else if (stage === 'SOURCING') current = 1
  else if (['CUTTING', 'SEWING', 'FINISHING'].includes(stage)) current = 2
  else current = 0
  return { labels, current }
}

export function OrderProgressTrack({ labels, current }: OrderProgressTrackStep) {
  const activeIndex = Math.min(current, labels.length - 1)
  return (
    <View
      style={styles.progress}
      accessible
      accessibilityLabel={current >= labels.length
        ? `All ${labels.length} steps complete`
        : `Step ${activeIndex + 1} of ${labels.length}, ${labels[activeIndex]}`}
    >
      <View style={styles.track}>
        {labels.map((label, index) => (
          <View
            key={label}
            style={[styles.segment, index < current && styles.segmentDone, index === current && styles.segmentActive]}
          />
        ))}
      </View>
      <View style={styles.labels}>
        {labels.map((label, index) => (
          <Text
            key={label}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={[styles.label, index === current && styles.labelActive]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  progress: { gap: 6, marginTop: Spacing.xs },
  track: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.lightGrey },
  segmentDone: { backgroundColor: Colors.needleGreenDark },
  segmentActive: { backgroundColor: Colors.needleGreen },
  labels: { flexDirection: 'row', gap: 4 },
  label: { flex: 1, textAlign: 'center', fontSize: FontSize.xs, color: Colors.midGrey },
  labelActive: { color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
})
