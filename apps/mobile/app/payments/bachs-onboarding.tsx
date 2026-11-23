import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Colors } from '@/constants/theme'

export default function BachsOnboardingReturnScreen() {
  const router = useRouter()
  const { routeId } = useLocalSearchParams<{ routeId?: string }>()

  useEffect(() => {
    if (!routeId) return
    router.replace({
      pathname: '/(tailor)/profile/payout-setup',
      params: { setup: 'bachs-complete', routeId },
    })
  }, [routeId, router])

  return (
    <View style={styles.container}>
      <ActivityIndicator color={Colors.needleGreen} />
      <Text style={styles.text}>Returning to your payout setup…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: Colors.bone,
  },
  text: { color: Colors.ink, fontSize: 16 },
})
