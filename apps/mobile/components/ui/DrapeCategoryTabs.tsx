import { MaterialCommunityIcons } from '@expo/vector-icons'
import type { MarketplaceCategory } from '@drape/shared'
import { useColorScheme, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { FontWeight, Fonts, getDrapeColors } from '@/constants/theme'

const CATEGORY_PRESENTATION: Record<MarketplaceCategory, {
  label: string
  icon: 'content-cut' | 'tshirt-crew'
}> = {
  TAILORING: { label: 'Tailors', icon: 'content-cut' },
  READY_TO_WEAR: { label: 'Ready-to-wear', icon: 'tshirt-crew' },
}

type DrapeCategoryTabsProps = {
  options: readonly MarketplaceCategory[]
  value: MarketplaceCategory
  onChange: (category: MarketplaceCategory) => void
}

/** Shared marketplace switcher for signed-in and public Explore. */
export function DrapeCategoryTabs({ options, value, onChange }: DrapeCategoryTabsProps) {
  const scheme = useColorScheme()
  const colors = getDrapeColors(scheme === 'dark' ? 'dark' : 'light')

  // A single available category needs no switcher; the section title already names it.
  if (options.length < 2) return null

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.row, { borderBottomColor: colors.lightGrey }]}
    >
      {options.map((category) => {
        const presentation = CATEGORY_PRESENTATION[category]
        const selected = value === category
        const color = selected ? colors.needleGreen : colors.midGrey

        return (
          <TouchableOpacity
            key={category}
            accessibilityRole="tab"
            accessibilityLabel={presentation.label}
            accessibilityState={{ selected }}
            activeOpacity={0.8}
            onPress={() => onChange(category)}
            style={styles.tab}
          >
            <MaterialCommunityIcons name={presentation.icon} size={19} color={color} />
            <Text
              style={[
                styles.label,
                { color: selected ? colors.ink : colors.midGrey },
                selected && styles.labelSelected,
              ]}
            >
              {presentation.label}
            </Text>
            <View
              style={[
                styles.indicator,
                selected
                  ? { backgroundColor: colors.needleGreen }
                  : styles.indicatorInactive,
              ]}
            />
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    position: 'relative',
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingTop: 4,
    paddingBottom: 8,
  },
  label: {
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: FontWeight.medium,
  },
  labelSelected: { fontFamily: Fonts.bodySemiBold, fontWeight: FontWeight.semibold },
  indicator: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: 2,
    borderRadius: 1,
  },
  indicatorInactive: { backgroundColor: 'transparent' },
})
