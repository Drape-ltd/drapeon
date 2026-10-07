import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Colors } from '@/constants/theme'
import { MaterialCommunityIcons } from '@expo/vector-icons'
export function EducationTools({ returnTo = '/(tailor)' }: { returnTo?: string }) {
  const router = useRouter()
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.label}>Tools</Text>
      <View style={styles.actions}>
        {(
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Sketch Room"
            onPress={() => router.push({ pathname: '/studio', params: { returnTo } } as never)}
          >
            <View style={styles.toolAction}>
              <MaterialCommunityIcons name="pencil-outline" size={16} color={Colors.needleGreenDark} />
              <Text style={styles.action}>Sketch Room</Text>
            </View>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open Guide"
          onPress={() => router.push({ pathname: '/guide', params: { returnTo } } as never)}
        >
          <Text style={styles.action}>Guide</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  label: { color: Colors.ink, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  toolAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  action: { color: Colors.needleGreenDark, fontSize: 13, fontWeight: '600', paddingVertical: 14 },
})
