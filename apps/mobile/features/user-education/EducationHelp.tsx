import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useUserRole } from '@/lib/auth'
import { EDUCATION_TOURS, type EducationTour } from '@drape/shared/education-tours'
import type { EducationProgress } from '@drape/shared/education-state'
import { GuideButton, s } from './GuidePrimitives'
import { useEducation } from './use-education'
export function EducationHelp({ context = 'welcome', compact = false, hideWhenSeen = false }: { context?: EducationTour; compact?: boolean; hideWhenSeen?: boolean }) {
  const { store, state } = useEducation(),
    role = useUserRole(),
    router = useRouter(),
    [open, setOpen] = useState(false),
    [step, setStep] = useState(0)
  const tour = EDUCATION_TOURS[context],
    key = `progress:${role === 'TAILOR' ? 'TAILOR' : 'CUSTOMER'}:${context}:v1`,
    previous = state.data[key]
  const tourInProgress = !!previous && typeof previous === 'object' && 'status' in previous && previous.status === 'started'
  const completedBefore = !!previous && !tourInProgress
  const save = (status: EducationProgress['status'], index = step) => {
    void store.set(key, { status, step: index }).catch(() => {})
  }
  if (compact && hideWhenSeen && completedBefore) return null
  return (
    <View style={compact && !open ? styles.compactRow : s.card}>
      {open ? (
        <>
          <Text style={s.label}>
            {step + 1} of {tour.steps.length}
          </Text>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={s.heading}>
            {tour.steps[step].title}
          </Text>
          <Text style={s.body}>{tour.steps[step].body}</Text>
          <View style={s.row}>
            {step > 0 && (
              <GuideButton
                onPress={() => {
                  setStep(step - 1)
                  save('started', step - 1)
                }}
              >
                Back
              </GuideButton>
            )}
            <GuideButton
              selected
              onPress={() => {
                if (step + 1 === tour.steps.length) {
                  save('completed')
                  setOpen(false)
                } else {
                  setStep(step + 1)
                  save('started', step + 1)
                }
              }}
            >
              {step + 1 === tour.steps.length ? 'Done' : 'Next'}
            </GuideButton>
            <GuideButton
              onPress={() => {
                save('dismissed')
                setOpen(false)
              }}
            >
              Close
            </GuideButton>
            <GuideButton onPress={() => router.push(`/guide/${tour.guide}` as never)}>
              Read full guide
            </GuideButton>
          </View>
        </>
      ) : compact ? (
        <>
          <Text style={styles.compactLabel}>{previous ? 'Tour available anytime' : 'New here? Take a quick tour'}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={previous ? 'Replay introduction' : 'Start introduction'}
            disabled={!state.ready}
            onPress={() => {
              setStep(0)
              save('started', 0)
              setOpen(true)
            }}
          >
            <Text style={styles.compactAction}>{previous ? 'Replay' : 'Start tour'} →</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.body}>{previous ? 'Help is here when you need it.' : tour.title}</Text>
          <View style={s.row}>
            <GuideButton
              disabled={!state.ready}
              onPress={() => {
                setStep(0)
                save('started', 0)
                setOpen(true)
              }}
            >
              {previous ? 'Replay introduction' : 'Show me'}
            </GuideButton>
            {!previous && (
              <GuideButton disabled={!state.ready} onPress={() => save('skipped', 0)}>
                Skip
              </GuideButton>
            )}
          </View>
        </>
      )}
      {state.error && <Text style={s.muted}>{state.error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  compactRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dde3d8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  compactLabel: { flex: 1, fontSize: 13, color: '#58675d' },
  compactAction: { fontSize: 13, fontWeight: '600', color: '#285546', paddingVertical: 12 },
})
