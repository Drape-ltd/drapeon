import { useState } from 'react'
import { Modal, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { parseGuideReferences } from '@drape/shared/guide-library'
import { GuideLibrary } from './GuideLibrary'
import { GuideButton, s } from './GuidePrimitives'
export function GuidePicker({
  onSelect,
  disabled,
}: {
  onSelect: (body: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <GuideButton disabled={disabled} onPress={() => setOpen(true)}>
        Guide
      </GuideButton>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={s.safe}>
          <View style={[s.row, { padding: 16 }]}>
            <GuideButton onPress={() => setOpen(false)}>Close</GuideButton>
            <Text style={s.heading}>Send a guide</Text>
          </View>
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <Text style={s.body}>Add a guide to your draft, write a note and send when ready.</Text>
            <GuideLibrary
              onSelect={(body) => {
                onSelect(body)
                setOpen(false)
              }}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}
export function GuideMessageCards({
  body,
  orderId,
  currentUserRole,
}: {
  body: string
  orderId: string
  currentUserRole: 'CUSTOMER' | 'TAILOR'
}) {
  const refs = parseGuideReferences(body)
  const router = useRouter()
  if (!refs.length) return null
  return (
    <View style={{ gap: 8 }}>
      {refs.map((r, i) => (
        <View key={`${r.guide.id}-${i}`} style={s.card}>
          <Text style={s.label}>DRAPEON GUIDE</Text>
          <Text style={s.body}>{r.guide.title}</Text>
          <GuideButton
            onPress={() => router.push({
              pathname: '/guide/[slug]',
              params: {
                slug: r.guide.id,
                ...(r.section ? { section: r.section } : {}),
                returnTo: `/(${currentUserRole === 'TAILOR' ? 'tailor' : 'customer'})/messages/${orderId}`,
              },
            } as never)}
          >
            Open guide
          </GuideButton>
        </View>
      ))}
    </View>
  )
}
