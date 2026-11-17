import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
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
          style={styles.tapTarget}
          onPress={() => onSelect(tool.id)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={tool.label}
        >
          <View style={styles.chip}>
            <MaterialCommunityIcons name={tool.icon} size={15} color={Colors.inkLight} />
            <Text style={styles.label}>{tool.label}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: 4, paddingRight: Spacing.lg },
  tapTarget: {
    minHeight: 44,
    justifyContent: 'center',
  },
  chip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
  },
  label: { fontSize: 12, fontWeight: FontWeight.medium, color: Colors.inkLight },
})
