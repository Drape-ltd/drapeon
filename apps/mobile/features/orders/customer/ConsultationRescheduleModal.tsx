import { Button, Input } from '@/components/ui'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { readFunctionErrorMessage } from '@/lib/function-errors'
import { invokeFunction } from '@/lib/supabase'
import { recommendedSchedulingStartDate } from '@drape/shared'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import { useMemo, useState } from 'react'
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
import { formatConsultationStart } from './CustomerOrderFormatting'
import { styles } from './CustomerOrderStyles'

export function ConsultationRescheduleModal({
  visible,
  orderId,
  counterpartName,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  counterpartName: string
  onClose: () => void
  onSent: () => void
}) {
  const initialTime = useMemo(() => {
    const value = new Date(Date.now() + 90 * 60 * 1000)
    value.setMinutes(Math.ceil(value.getMinutes() / 15) * 15, 0, 0)
    return value
  }, [])
  const [scheduledAt, setScheduledAt] = useState(initialTime)
  const [showPicker, setShowPicker] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (sending) return
    if (scheduledAt.getTime() < Date.now() + 60 * 60 * 1000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })
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
      const { data, error } = await invokeFunction<{ ok?: boolean }>(
        'consultation-reschedule-action',
        {
          body: {
            action: 'request',
            orderId,
            proposedStartAt: scheduledAt.toISOString(),
            note: note.trim() || undefined,
          },
        }
      )
      if (error || !data?.ok) {
        throw new Error(
          error
            ? await readFunctionErrorMessage(error, 'Could not send the new time.')
            : 'Could not send the new time.'
        )
      }
      onSent()
    } catch (error) {
      Alert.alert(
        'Could not send new time',
        await readFunctionErrorMessage(error, 'Try again in a moment.')
      )
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
            <Text style={styles.modalTitle}>Propose new time</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Current time stays booked</Text>
              <Text style={styles.supportHint}>
                {counterpartName.split(' ')[0]} must accept before Drapeon moves the consultation
                and its reminders.
              </Text>
            </View>
            <Input
              label="New time"
              value={formatConsultationStart(scheduledAt)}
              onPressIn={() => setShowPicker(true)}
              showSoftInputOnFocus={false}
              required
            />
            {showPicker ? (
              <DateTimePicker
                value={scheduledAt}
                mode="datetime"
                minimumDate={recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })}
                onChange={(_, value) => {
                  setShowPicker(Platform.OS === 'ios')
                  if (value) setScheduledAt(value)
                }}
              />
            ) : null}
            <Input
              label="Note (optional)"
              placeholder="Why this time works better"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
            <Button
              label="Send new time"
              onPress={() => {
                void send()
              }}
              loading={sending}
              disabled={sending}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
