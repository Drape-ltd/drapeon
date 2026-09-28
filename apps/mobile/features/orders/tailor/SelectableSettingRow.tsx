import { Colors } from '@/constants/theme'
import { Feather } from '@expo/vector-icons'
import { Text, TouchableOpacity, View } from 'react-native'
import { styles } from './TailorOrderStyles'

export function SelectableSettingRow({
  label,
  detail,
  active,
  onPress,
}: {
  label: string
  detail?: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.selectableSettingRow, active && styles.selectableSettingRowActive]}
    >
      <View style={[styles.selectableSettingRadio, active && styles.selectableSettingRadioActive]}>
        {active ? <Feather name="check" size={12} color={Colors.textInverse} /> : null}
      </View>
      <View style={styles.selectableSettingBody}>
        <Text
          style={[styles.selectableSettingLabel, active && styles.selectableSettingLabelActive]}
        >
          {label}
        </Text>
        {detail ? <Text style={styles.selectableSettingDetail}>{detail}</Text> : null}
      </View>
    </TouchableOpacity>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
