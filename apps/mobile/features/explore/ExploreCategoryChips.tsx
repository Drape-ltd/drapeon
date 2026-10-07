import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { ComponentProps } from 'react'
import { Colors, FontWeight, Radius, Spacing } from '@/constants/theme'

type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name']

export type ExploreToolId = 'studio' | 'measure' | 'guide'

/** Drapeon's focused destinations alongside Explore search. */
export const EXPLORE_TOOLS: ReadonlyArray<{ id: ExploreToolId; label: string; icon: MaterialName }> = [
  // Glyphs chosen to stay legible at chip size: tape-measure reads as a squiggle small,
  // so the body-height mark carries "measure" far better.
  { id: 'studio', label: 'Sketch Room', icon: 'pencil-outline' },
  { id: 'measure', label: 'Vision', icon: 'human-male-height-variant' },
  { id: 'guide', label: 'Guide', icon: 'book-open-page-variant' },
]

export function ExploreCategoryChips({ onSelect }: { onSelect: (id: ExploreToolId) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {EXPLORE_TOOLS.map((tool) => (
        <TouchableOpacity
          key={tool.id}
          style={styles.chip}
          onPress={() => onSelect(tool.id)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={tool.label}
        >
          <MaterialCommunityIcons name={tool.icon} size={19} color={Colors.needleGreenDark} />
          <Text style={styles.label}>{tool.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingRight: Spacing.lg },
  chip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  label: { fontSize: 13, fontWeight: FontWeight.semibold, color: Colors.ink },
})
