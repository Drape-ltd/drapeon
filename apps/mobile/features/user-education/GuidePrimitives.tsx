import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ReactNode } from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { Colors } from '@/constants/theme'
export function GuideButton({
  children,
  onPress,
  disabled = false,
  selected = false,
}: {
  children: ReactNode
  onPress: () => void
  disabled?: boolean
  selected?: boolean
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, selected && s.selected, disabled && { opacity: 0.45 }]}
    >
      <Text style={[s.buttonText, selected && { color: '#fff' }]}>{children}</Text>
    </TouchableOpacity>
  )
}
export function GuideArt({ kind }: { kind: string }) {
  const path =
    kind === 'sleeve'
      ? 'M70 48 L106 35 L124 45 L145 86 L179 103 L168 124 L124 104 L102 72 M70 48 L65 145 L116 145 L111 94 M121 49 Q146 84 173 107'
      : kind === 'body'
        ? 'M102 44 a18 18 0 1 0 0 -36 a18 18 0 1 0 0 36 M82 49 L61 63 L44 111 L58 117 L77 84 L74 142 L129 142 L126 84 L145 117 L159 110 L142 63 L121 49 M75 95 L130 95 M77 118 L128 118'
        : kind === 'care'
          ? 'M102 42 C80 42 86 16 105 19 C126 22 118 42 103 47 L103 57 L41 107 Q36 116 48 116 L162 116 Q174 116 167 107 L105 65 M65 132 L145 132'
          : kind === 'fabric'
            ? 'M49 41 L141 24 L166 137 L74 155 Z M61 55 L139 41 M65 75 L143 61 M69 95 L147 81 M73 115 L151 101 M77 135 L155 121'
            : 'M49 34 L152 34 L152 155 L49 155 Z M91 54 L73 65 L62 85 L77 93 L83 82 L75 132 L127 132 L119 82 L126 93 L140 85 L129 65 L111 54 Q101 68 91 54'
  return (
    <View
      accessible
      accessibilityLabel={
        kind === 'sleeve'
          ? 'Schematic showing a slightly bent elbow and the outer-arm measuring path.'
          : `Illustration: ${kind}`
      }
    >
      <Svg height={130} width="100%" viewBox="0 0 210 175">
        <Rect width={210} height={175} rx={28} fill="#e7ebe0" />
        <Circle cx={108} cy={87} r={65} fill="#f6f4ec" />
        <Path
          d={path}
          fill="none"
          stroke="#285546"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7f5ed' },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  card: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dde3d8',
    gap: 12,
  },
  title: { fontSize: 28, fontWeight: '600', color: Colors.ink },
  heading: { fontSize: 20, fontWeight: '600', color: Colors.ink },
  body: { fontSize: 15, lineHeight: 24, color: Colors.ink },
  muted: { fontSize: 12, lineHeight: 19, color: '#58675d' },
  label: { fontSize: 11, letterSpacing: 1, fontWeight: '600', color: '#285546' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#bbcbbd',
    borderRadius: 14,
    padding: 12,
    color: Colors.ink,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#bacbbb',
    borderRadius: 24,
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#285546', borderColor: '#285546' },
  buttonText: { fontSize: 13, fontWeight: '600', color: '#285546' },
  link: { color: '#285546', textDecorationLine: 'underline', fontSize: 14, paddingVertical: 10 },
  notice: {
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#ad7950',
    backgroundColor: '#f1e7db',
    gap: 6,
  },
})
