import { EducationHelp } from '@/features/user-education/EducationHelp'
import { TouchableOpacity, Text, View, ActivityIndicator } from 'react-native'
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { appendToHistory } from '@/lib/navigation'
import { Colors, Spacing } from '@/constants/theme'
import { STUDIO_DEV_ENABLED } from './availability'
export function StudioEntry({ returnTo, brief = false, beforeOpen, onUpload }: { returnTo: string; brief?: boolean; beforeOpen?: () => Promise<void>; onUpload?: () => void }) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const open = async (mode: 'create' | 'saved') => {
    setOpening(true)
    setError('')
    try {
      await beforeOpen?.()
      router.push({ pathname: '/studio', params: { returnTo, mode, historyChain: appendToHistory(undefined, returnTo) } } as never)
    } catch {
      setError('Your brief could not be saved before opening Sketch Room. Try again.')
    } finally { setOpening(false) }
  }
  if (brief) return (
    <View style={{ padding: Spacing.md, borderColor: Colors.needleGreen, borderWidth: 1, borderRadius: 12, marginBottom: Spacing.md, gap: Spacing.sm }}>
      <Text style={{ color: Colors.ink, fontWeight: '600' }}>Show the tailor your idea</Text>
      <Text style={{ color: Colors.midGrey, fontSize: 12 }}>Attach a source image directly, or use Sketch Room to sample a reference photo or draw over a paper sketch.</Text>
      <TouchableOpacity accessibilityRole="button" onPress={onUpload} style={{ padding: Spacing.sm, backgroundColor: Colors.needleGreen, borderRadius: 9 }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>Attach a source image</Text>
      </TouchableOpacity>
      {STUDIO_DEV_ENABLED ? <>
        <TouchableOpacity accessibilityRole="button" disabled={opening} onPress={() => void open('create')} style={{ padding: Spacing.sm, borderColor: Colors.needleGreen, borderWidth: 1, borderRadius: 9, opacity: opening ? 0.65 : 1 }}>
          <Text style={{ color: Colors.needleGreen, fontWeight: '600' }}>Open Sketch Room</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={opening} onPress={() => void open('saved')} style={{ padding: Spacing.sm, opacity: opening ? 0.65 : 1 }}>
          <Text style={{ color: Colors.needleGreen, fontWeight: '600' }}>Use a saved sketch</Text>
        </TouchableOpacity>
      </> : null}
      <EducationHelp context="brief" />
      {opening ? <ActivityIndicator color={Colors.needleGreen} /> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: Colors.error, fontSize: 12 }}>{error}</Text> : null}
    </View>
  )
  if (!STUDIO_DEV_ENABLED) return null
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => void open('create')}
      style={{
        padding: Spacing.md,
        borderColor: Colors.needleGreen,
        borderWidth: 1,
        borderRadius: 12,
        marginBottom: Spacing.md,
      }}
    >
      <Text style={{ color: Colors.needleGreen, fontWeight: '600' }}>Sketch Room · Start an idea</Text>
      <Text style={{ color: Colors.midGrey, fontSize: 12, marginTop: 4 }}>
        Draw, trace a paper sketch, and share clear directions.
      </Text>
    </TouchableOpacity>
  )
}
