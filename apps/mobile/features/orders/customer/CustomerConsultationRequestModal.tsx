import { Button, Input } from '@/components/ui'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { Colors } from '@/constants/theme'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { invokeFunction, supabase } from '@/lib/supabase'
import { recommendedSchedulingStartDate } from '@drape/shared'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { defaultConsultationStart, formatConsultationStart } from './CustomerOrderFormatting'
import { styles } from './CustomerOrderStyles'

export function CustomerConsultationRequestModal({
  visible,
  orderId,
  tailorName,
  tailorUserId,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  tailorName: string
  tailorUserId: string
  onClose: () => void
  onSent: () => void
}) {
  const [scheduledAt, setScheduledAt] = useState<Date>(defaultConsultationStart())
  const [minimumStartAt] = useState<Date>(defaultConsultationStart())
  const [showPicker, setShowPicker] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [callPolicy, setCallPolicy] = useState<'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'>('VIDEO')
  const [callType, setCallType] = useState<'AUDIO' | 'VIDEO'>('VIDEO')

  useEffect(() => {
    if (!visible || !tailorUserId) return
    let active = true
    void supabase
      .from('tailor_profiles')
      .select('consultation_call_type')
      .eq('user_id', tailorUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        const nextPolicy =
          data?.consultation_call_type === 'AUDIO' ||
          data?.consultation_call_type === 'AUDIO_OR_VIDEO'
            ? data.consultation_call_type
            : 'VIDEO'
        setCallPolicy(nextPolicy)
        if (nextPolicy !== 'AUDIO_OR_VIDEO') setCallType(nextPolicy)
      })
    return () => {
      active = false
    }
  }, [tailorUserId, visible])

  async function send() {
    if (sending) return
    if (scheduledAt.getTime() < Date.now() + 120 * 60 * 1000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
      Alert.alert(
        'Use the next available time?',
        `That time is too soon. The nearest valid option is ${formatExplicitZonedDateTime(suggestion)}.`,
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Use suggested time', onPress: () => setScheduledAt(suggestion) },
        ]
      )
      return
    }

    setSending(true)
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const { data, error } = await invokeFunction('customer-order-action', {
        body: {
          orderId,
          action: 'request-consultation',
          scheduledStartAt: scheduledAt.toISOString(),
          callType,
          timezone,
          note: note.trim() || undefined,
        },
      })

      if (error || !data?.ok) {
        const message = error
          ? await readFunctionErrorMessage(error, 'Could not request consultation right now.')
          : 'Could not request consultation right now.'
        throw new Error(message)
      }

      onSent()
    } catch (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your requested time stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not request consultation right now.')
      Alert.alert('Consultation unavailable', message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} disabled={sending}>
              <Text style={styles.modalClose}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Request consultation</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>
                Consultation with {tailorName.split(' ')[0]}
              </Text>
              <Text style={styles.supportHint}>
                The tailor has 48 hours to respond. You will see any fee before payment.
              </Text>
            </View>
            {callPolicy === 'AUDIO_OR_VIDEO' ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Call type</Text>
                <View style={styles.consultationCallChoices}>
                  {(['AUDIO', 'VIDEO'] as const).map((value) => (
                    <TouchableOpacity
                      key={value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: callType === value }}
                      style={[
                        styles.consultationCallChoice,
                        callType === value && styles.consultationCallChoiceActive,
                      ]}
                      onPress={() => setCallType(value)}
                    >
                      <Feather
                        name={value === 'AUDIO' ? 'phone' : 'video'}
                        size={18}
                        color={Colors.needleGreenDark}
                      />
                      <Text style={styles.consultationCallChoiceText}>
                        {value === 'AUDIO' ? 'Audio' : 'Video'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>
                  {callType === 'AUDIO' ? 'Audio consultation' : 'Video consultation'}
                </Text>
                <Text style={styles.supportHint}>This is the call type offered by the tailor.</Text>
              </View>
            )}
            <Input
              label="Preferred time"
              value={formatConsultationStart(scheduledAt)}
              onPressIn={() => setShowPicker(true)}
              showSoftInputOnFocus={false}
              hint="Pick a time at least 2 hours from now."
              required
            />
            {showPicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                minimumDate={minimumStartAt}
                onChange={(_, value) => {
                  setShowPicker(Platform.OS === 'ios')
                  if (value) setScheduledAt(value)
                }}
              />
            ) : null}
            <Input
              label="What do you want to cover? (optional)"
              placeholder="e.g. Fit, fabric choice, deadline, or styling direction."
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
            <Button label="Send request" onPress={send} loading={sending} disabled={sending} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
