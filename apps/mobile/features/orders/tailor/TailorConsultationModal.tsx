import { Button, Input, MoneyInput } from '@/components/ui'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { Colors } from '@/constants/theme'
import { SelectableSettingRow } from '@/features/orders/tailor/SelectableSettingRow'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import { capture } from '@/lib/analytics'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import {
  isLikelyConnectivityIssue,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import { fetchReadGateway } from '@/lib/read-gateway'
import { Sentry } from '@/lib/sentry'
import { invokeFunction } from '@/lib/supabase'
import {
  formatMoneyInputValue,
  parseMoneyInputToMinorUnits,
  recommendedSchedulingStartDate,
  type AccountCurrencyCode,
} from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
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
import { defaultConsultationStart, formatConsultationStart } from './TailorOrderFormatting'

type ConsultationPolicy = {
  mode: 'UNAVAILABLE' | 'FREE' | 'PAID'
  feeAmount: number | null
  currency: CurrencyCode
  durationMinutes: 15 | 30 | 45 | 60
  callType: 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'
  feeCreditable: boolean
}

export function ConsultationModal({
  visible,
  orderId,
  tailorProfileId,
  action,
  defaultCurrency,
  initialCallType,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  tailorProfileId: string | null
  action: 'request-consultation' | 'approve-consultation'
  defaultCurrency: CurrencyCode
  initialCallType: 'AUDIO' | 'VIDEO' | null
  onClose: () => void
  onSent: () => void
}) {
  const [scheduledAt, setScheduledAt] = useState<Date>(defaultConsultationStart())
  const [showPicker, setShowPicker] = useState(false)
  const [policy, setPolicy] = useState<ConsultationPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [policyError, setPolicyError] = useState('')
  const [policyReload, setPolicyReload] = useState(0)
  const [editingPolicy, setEditingPolicy] = useState(false)
  const [draftMode, setDraftMode] = useState<'FREE' | 'PAID'>('FREE')
  const [draftFee, setDraftFee] = useState('')
  const [draftDuration, setDraftDuration] = useState<15 | 30 | 45 | 60>(30)
  const [draftCallType, setDraftCallType] = useState<'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO'>('VIDEO')
  const [draftFeeCreditable, setDraftFeeCreditable] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policySaveError, setPolicySaveError] = useState('')
  const [policySaved, setPolicySaved] = useState(false)
  const [callType, setCallType] = useState<'AUDIO' | 'VIDEO'>(initialCallType ?? 'VIDEO')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!visible) return
    let active = true
    setPolicy(null)
    setPolicyError('')
    setPolicyLoading(true)
    if (!tailorProfileId) {
      setPolicyLoading(false)
      setPolicyError('Tailor profile is missing from this order.')
      return () => {
        active = false
      }
    }
    void fetchReadGateway<{
      profile: {
        consultationMode?: string | null
        consultationFeeAmount?: number | null
        consultationCurrency?: string | null
        consultationDurationMinutes?: number | null
        consultationCallType?: string | null
        consultationFeeCreditable?: boolean | null
      } | null
    }>({ action: 'tailor-profile', tailorId: tailorProfileId }, { forceRefresh: policyReload > 0 })
      .then((result) => {
        if (!active) return
        setPolicyLoading(false)
        const data = result?.profile
        if (!data) {
          const message = 'Your consultation settings could not be loaded.'
          setPolicyError(message)
          Sentry.captureException(new Error(message), {
            extra: { context: 'tailor_consultation_policy', orderId, tailorProfileId },
          })
          return
        }
        const publishedCallType =
          data.consultationCallType === 'AUDIO' || data.consultationCallType === 'AUDIO_OR_VIDEO'
            ? data.consultationCallType
            : 'VIDEO'
        const nextPolicy: ConsultationPolicy = {
          mode:
            data.consultationMode === 'PAID'
              ? 'PAID'
              : data.consultationMode === 'UNAVAILABLE'
                ? 'UNAVAILABLE'
                : 'FREE',
          feeAmount: data.consultationMode === 'PAID' ? (data.consultationFeeAmount ?? null) : null,
          currency: (data.consultationCurrency ?? defaultCurrency) as CurrencyCode,
          durationMinutes:
            data.consultationDurationMinutes === 15 ||
            data.consultationDurationMinutes === 45 ||
            data.consultationDurationMinutes === 60
              ? data.consultationDurationMinutes
              : 30,
          callType: publishedCallType,
          feeCreditable: data.consultationFeeCreditable === true,
        }
        setPolicy(nextPolicy)
        setDraftMode(nextPolicy.mode === 'PAID' ? 'PAID' : 'FREE')
        setDraftFee(
          nextPolicy.feeAmount ? formatMoneyInputValue(String(nextPolicy.feeAmount / 100)) : ''
        )
        setDraftDuration(nextPolicy.durationMinutes)
        setDraftCallType(nextPolicy.callType)
        setDraftFeeCreditable(nextPolicy.feeCreditable)
        setEditingPolicy(false)
        setPolicySaveError('')
        setPolicySaved(false)
        if (publishedCallType !== 'AUDIO_OR_VIDEO') setCallType(publishedCallType)
      })
      .catch((error: unknown) => {
        if (!active) return
        setPolicyLoading(false)
        const message =
          error instanceof Error ? error.message : 'Your consultation settings could not be loaded.'
        setPolicyError(message)
        Sentry.captureException(error, {
          extra: { context: 'tailor_consultation_policy', orderId, tailorProfileId },
        })
      })
    return () => {
      active = false
    }
  }, [defaultCurrency, orderId, policyReload, tailorProfileId, visible])

  async function saveConsultationPolicy() {
    if (!policy || savingPolicy) return false
    const feeAmount = draftMode === 'PAID' ? parseMoneyInputToMinorUnits(draftFee) : null
    if (draftMode === 'PAID' && !feeAmount) {
      setPolicySaveError('Enter a valid consultation fee.')
      return false
    }

    setSavingPolicy(true)
    setPolicySaveError('')
    setPolicySaved(false)
    const { data, error } = await invokeFunction<{ policy?: ConsultationPolicy }>(
      'tailor-profile-action',
      {
        body: {
          action: 'update-consultation-policy',
          consultationMode: draftMode,
          consultationFeeAmount: feeAmount,
          consultationDurationMinutes: draftDuration,
          consultationCallType: draftCallType,
          consultationFeeCreditable: draftMode === 'PAID' && draftFeeCreditable,
        },
      }
    )
    setSavingPolicy(false)

    if (error || !data?.policy) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your changes are still here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save your consultation terms right now.')
      setPolicySaveError(message)
      return false
    }

    const savedPolicy = data.policy
    setPolicy(savedPolicy)
    setDraftMode(savedPolicy.mode === 'PAID' ? 'PAID' : 'FREE')
    setDraftFee(
      savedPolicy.feeAmount ? formatMoneyInputValue(String(savedPolicy.feeAmount / 100)) : ''
    )
    setDraftDuration(savedPolicy.durationMinutes)
    setDraftCallType(savedPolicy.callType)
    setDraftFeeCreditable(savedPolicy.feeCreditable)
    if (savedPolicy.callType !== 'AUDIO_OR_VIDEO') setCallType(savedPolicy.callType)
    setEditingPolicy(false)
    setPolicySaved(true)
    capture('consultation_policy_updated', {
      consultation_mode: savedPolicy.mode.toLowerCase(),
      call_type: savedPolicy.callType.toLowerCase(),
    })
    return true
  }

  function validateNote(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!policy) {
      Alert.alert(
        'Consultation settings unavailable',
        'Reload your consultation settings before sending this request.'
      )
      return
    }
    if (!validateNote(note)) return
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

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action,
        callType,
        scheduledStartAt: scheduledAt.toISOString(),
        timezone,
        note: note.trim() || undefined,
      },
    })

    if (efError || !efData?.ok) {
      const errorPayload = efError ? await readFunctionErrorPayload(efError) : null
      const errorMessage =
        typeof efData?.error === 'string' && efData.error.length > 0
          ? efData.error
          : typeof errorPayload?.error === 'string' && errorPayload.error.length > 0
            ? errorPayload.error
            : (efError?.message ?? 'Could not request consultation right now.')
      const err = new Error(errorMessage)
      Sentry.captureException(err, { extra: { context: 'request_consultation', orderId } })
      Alert.alert(
        'Consultation unavailable',
        isLikelyConnectivityIssue(efError)
          ? 'Connection looks weak. Your consultation request details stayed here, so retry when the signal improves.'
          : errorMessage
      )
      setSending(false)
      return
    }

    capture(
      action === 'approve-consultation' ? 'consultation_approved' : 'consultation_requested',
      { call_type: callType.toLowerCase() }
    )
    setSending(false)
    onSent()
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
            <Text style={styles.modalTitle}>
              {action === 'approve-consultation' ? 'Approve consultation' : 'Request consultation'}
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.consultationInfo}>
              <Text style={styles.consultationInfoText}>
                {action === 'approve-consultation'
                  ? 'Confirm the time.'
                  : 'Choose a time to speak before you quote.'}
              </Text>
            </View>
            <Input
              label="Consultation time"
              value={formatConsultationStart(scheduledAt)}
              onPressIn={() => setShowPicker(true)}
              showSoftInputOnFocus={false}
              hint="At least 1 hour from now. Drapeon sends the reminders."
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
            {policyLoading ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Consultation terms</Text>
                <Text style={styles.supportHint}>
                  Checking your published fee and call options…
                </Text>
              </View>
            ) : policyError ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Settings unavailable</Text>
                <Text style={styles.supportHint}>We could not load your fee or call options.</Text>
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => setPolicyReload((value) => value + 1)}
                />
              </View>
            ) : policy ? (
              <View style={styles.supportCard}>
                <View style={styles.consultationTermsHeader}>
                  <View style={styles.consultationTermsCopy}>
                    <Text style={styles.supportCardTitle}>Consultation terms</Text>
                    {!editingPolicy ? (
                      <Text style={styles.supportHint}>
                        {policy.feeAmount
                          ? `${formatAmount(policy.feeAmount, policy.currency, policy.currency, STATIC_FALLBACK_RATES)}${policy.feeCreditable ? ' · credited to order' : ''}`
                          : 'Free'}
                        {` · ${policy.durationMinutes} min · ${policy.callType === 'AUDIO_OR_VIDEO' ? 'Audio or video' : policy.callType === 'AUDIO' ? 'Audio' : 'Video'}`}
                      </Text>
                    ) : null}
                  </View>
                  {!editingPolicy ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Edit consultation terms here"
                      onPress={() => {
                        setEditingPolicy(true)
                        setPolicySaved(false)
                        setPolicySaveError('')
                      }}
                    >
                      <Text style={styles.inlineLink}>Edit</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {editingPolicy ? (
                  <View style={styles.consultationPolicyEditor}>
                    <View style={styles.consultationOptionGroup}>
                      <Text style={styles.fieldLabel}>Fee</Text>
                      <View style={styles.consultationChipRow}>
                        {(['FREE', 'PAID'] as const).map((mode) => (
                          <TouchableOpacity
                            key={mode}
                            accessibilityRole="button"
                            accessibilityState={{ selected: draftMode === mode }}
                            style={[
                              styles.consultationChip,
                              draftMode === mode && styles.consultationChipActive,
                            ]}
                            onPress={() => {
                              setDraftMode(mode)
                              if (mode === 'FREE') {
                                setDraftFee('')
                                setDraftFeeCreditable(false)
                              }
                              setPolicySaveError('')
                            }}
                          >
                            <Text
                              style={[
                                styles.consultationChipText,
                                draftMode === mode && styles.consultationChipTextActive,
                              ]}
                            >
                              {mode === 'FREE' ? 'Free' : 'Paid'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {draftMode === 'PAID' ? (
                      <>
                        <MoneyInput
                          label="Consultation fee"
                          value={draftFee}
                          onChangeText={(value) => {
                            setDraftFee(value)
                            setPolicySaveError('')
                          }}
                          currency={policy.currency as AccountCurrencyCode}
                          required
                        />
                        <TouchableOpacity
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: draftFeeCreditable }}
                          style={styles.consultationCreditRow}
                          onPress={() => setDraftFeeCreditable((value) => !value)}
                        >
                          <View
                            style={[
                              styles.consultationCheck,
                              draftFeeCreditable && styles.consultationCheckActive,
                            ]}
                          >
                            {draftFeeCreditable ? (
                              <Feather name="check" size={13} color={Colors.white} />
                            ) : null}
                          </View>
                          <Text style={styles.consultationCreditText}>
                            Credit this fee toward an accepted order
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}

                    <View style={styles.consultationOptionGroup}>
                      <Text style={styles.fieldLabel}>Length</Text>
                      <View style={styles.consultationChipRow}>
                        {([15, 30, 45, 60] as const).map((duration) => (
                          <TouchableOpacity
                            key={duration}
                            accessibilityRole="button"
                            accessibilityState={{ selected: draftDuration === duration }}
                            style={[
                              styles.consultationChip,
                              draftDuration === duration && styles.consultationChipActive,
                            ]}
                            onPress={() => setDraftDuration(duration)}
                          >
                            <Text
                              style={[
                                styles.consultationChipText,
                                draftDuration === duration && styles.consultationChipTextActive,
                              ]}
                            >
                              {duration} min
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    <View style={styles.consultationOptionGroup}>
                      <Text style={styles.fieldLabel}>Call options</Text>
                      <View style={styles.consultationChipRow}>
                        {(['AUDIO', 'VIDEO', 'AUDIO_OR_VIDEO'] as const).map((type) => (
                          <TouchableOpacity
                            key={type}
                            accessibilityRole="button"
                            accessibilityState={{ selected: draftCallType === type }}
                            style={[
                              styles.consultationChip,
                              draftCallType === type && styles.consultationChipActive,
                            ]}
                            onPress={() => setDraftCallType(type)}
                          >
                            <Text
                              style={[
                                styles.consultationChipText,
                                draftCallType === type && styles.consultationChipTextActive,
                              ]}
                            >
                              {type === 'AUDIO' ? 'Audio' : type === 'VIDEO' ? 'Video' : 'Either'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {policySaveError ? (
                      <Text style={styles.fieldError}>{policySaveError}</Text>
                    ) : null}
                    <View style={styles.consultationEditorActions}>
                      <Button
                        label="Cancel"
                        variant="secondary"
                        onPress={() => {
                          setDraftMode(policy.mode === 'PAID' ? 'PAID' : 'FREE')
                          setDraftFee(
                            policy.feeAmount
                              ? formatMoneyInputValue(String(policy.feeAmount / 100))
                              : ''
                          )
                          setDraftDuration(policy.durationMinutes)
                          setDraftCallType(policy.callType)
                          setDraftFeeCreditable(policy.feeCreditable)
                          setPolicySaveError('')
                          setEditingPolicy(false)
                        }}
                        disabled={savingPolicy}
                      />
                      <Button
                        label="Save terms"
                        onPress={saveConsultationPolicy}
                        loading={savingPolicy}
                        disabled={savingPolicy}
                      />
                    </View>
                  </View>
                ) : null}

                {policySaved ? (
                  <View
                    accessible
                    accessibilityLiveRegion="polite"
                    style={styles.consultationSavedRow}
                  >
                    <Feather name="check-circle" size={16} color={Colors.needleGreenDark} />
                    <Text style={styles.consultationSavedText}>
                      Saved here and on your profile.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {policy?.callType === 'AUDIO_OR_VIDEO' && !initialCallType ? (
              <View style={styles.supportCard}>
                <Text style={styles.fieldLabel}>Call type</Text>
                <View style={styles.choiceList}>
                  <SelectableSettingRow
                    label="Audio"
                    active={callType === 'AUDIO'}
                    onPress={() => setCallType('AUDIO')}
                  />
                  <SelectableSettingRow
                    label="Video"
                    active={callType === 'VIDEO'}
                    onPress={() => setCallType('VIDEO')}
                  />
                </View>
              </View>
            ) : policy ? (
              <View style={styles.policySummaryRow}>
                <Text style={styles.policySummaryLabel}>Call type</Text>
                <Text style={styles.policySummaryValue}>
                  {callType === 'AUDIO' ? 'Audio' : 'Video'}
                </Text>
              </View>
            ) : null}
            <Input
              label="Note to customer (optional)"
              placeholder="Explain what you need from the consultation..."
              value={note}
              onChangeText={(v) => {
                setNote(v)
                if (noteError) validateNote(v)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={3}
              maxLength={300}
              filterContact
            />
            <Button
              label={
                action === 'approve-consultation' ? 'Approve consultation' : 'Request consultation'
              }
              onPress={send}
              loading={sending}
              disabled={
                sending ||
                savingPolicy ||
                editingPolicy ||
                policyLoading ||
                !policy ||
                policy.mode === 'UNAVAILABLE' ||
                !!policyError ||
                !!noteError
              }
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Collection Code Modal ────────────────────────────────────────────────────
