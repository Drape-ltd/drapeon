import { Button, Input, MoneyInput } from '@/components/ui'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { Spacing } from '@/constants/theme'
import type { CurrencyCode } from '@/lib/currency'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  SCOPE_CHANGE_IMPACT_LABELS,
  SCOPE_CHANGE_TYPE_LABELS,
  type ScopeChangeImpact,
  type ScopeChangeType,
} from '@/lib/order-support'
import { invokeFunction } from '@/lib/supabase'
import { parseMoneyInputToMinorUnits, type AccountCurrencyCode } from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { useState } from 'react'
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
import { styles } from './TailorOrderStyles'

function commercialAdjustmentTypeForScope(type: ScopeChangeType) {
  if (type === 'MEASUREMENT_AMENDMENT') return 'FIT_REVISION' as const
  if (type === 'FABRIC_OR_MATERIAL') return 'MATERIAL' as const
  if (type === 'DEADLINE_OR_EVENT' || type === 'PAUSE_OR_RESTART')
    return 'DEADLINE_EXTENSION' as const
  if (type === 'REWORK_OR_ALTERATION') return 'CORRECTION' as const
  return 'SCOPE' as const
}

const SCOPE_CHANGE_TYPE_OPTIONS: ScopeChangeType[] = [
  'MEASUREMENT_AMENDMENT',
  'STYLE_OR_REFERENCE',
  'FABRIC_OR_MATERIAL',
  'DEADLINE_OR_EVENT',
  'PAUSE_OR_RESTART',
  'REWORK_OR_ALTERATION',
  'ADD_OR_REMOVE_ITEM',
  'OTHER',
]

const SCOPE_CHANGE_IMPACT_OPTIONS: ScopeChangeImpact[] = [
  'FIT',
  'STYLE',
  'FABRIC',
  'DEADLINE',
  'PRICE',
  'FULFILLMENT',
]

export function ScopeChangeRequestModal({
  visible,
  orderId,
  currency,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  currency: CurrencyCode
  onClose: () => void
  onSent: () => void
}) {
  const [type, setType] = useState<ScopeChangeType | null>(null)
  const [impacts, setImpacts] = useState<ScopeChangeImpact[]>([])
  const [summary, setSummary] = useState('')
  const [priceImpact, setPriceImpact] = useState('')
  const [proposedDeadline, setProposedDeadline] = useState<Date | null>(null)
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false)
  const [responsibility, setResponsibility] = useState<
    'CUSTOMER' | 'TAILOR' | 'DRAPEON' | 'SHARED' | 'UNRESOLVED'
  >('UNRESOLVED')
  const [summaryError, setSummaryError] = useState('')
  const [priceError, setPriceError] = useState('')
  const [sending, setSending] = useState(false)

  function toggleImpact(value: ScopeChangeImpact) {
    setImpacts((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    )
  }

  function validateSummary(value: string) {
    if (value.trim().length < 10) {
      setSummaryError('Explain what changed and what the customer needs to approve.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Change note')
    if (placeholder) {
      setSummaryError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setSummaryError("Contact details can't be included.")
      return false
    }
    setSummaryError('')
    return true
  }

  function validatePrice(value: string) {
    if (!value.trim()) {
      setPriceError('')
      return true
    }
    const parsed = parseMoneyInputToMinorUnits(value)
    if (parsed == null) {
      setPriceError('Enter a valid added price, or leave this blank.')
      return false
    }
    setPriceError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!type) {
      Alert.alert(
        'Choose a change type',
        'Pick what kind of order change this is before sending it.'
      )
      return
    }
    if (!validateSummary(summary)) return
    if (!validatePrice(priceImpact)) return

    const priceImpactMinor = parseMoneyInputToMinorUnits(priceImpact)
    const adjustmentType = commercialAdjustmentTypeForScope(type)
    if (adjustmentType === 'DEADLINE_EXTENSION' && !proposedDeadline) {
      Alert.alert(
        'Choose the new deadline',
        'Deadline extensions need an exact date and time—not a loose note such as “three more days.”'
      )
      return
    }
    if ((priceImpactMinor ?? 0) > 0 && responsibility !== 'CUSTOMER') {
      Alert.alert(
        'Confirm responsibility',
        'An added customer payment can only be proposed when Customer is selected as responsible.'
      )
      return
    }

    setSending(true)
    const { error } = await invokeFunction('commercial-adjustment-action', {
      body: {
        action: 'propose',
        orderId,
        type: adjustmentType,
        summary: summary.trim(),
        reason:
          impacts.length > 0
            ? `${summary.trim()} Affects: ${impacts.map((impact) => SCOPE_CHANGE_IMPACT_LABELS[impact]).join(', ')}.`
            : summary.trim(),
        responsibility,
        amountDelta: priceImpactMinor ?? 0,
        currency,
        proposedDeadline: proposedDeadline?.toISOString() ?? null,
        evidenceIds: [],
        idempotencyKey: `mobile-tailor:${orderId}:${Date.now()}`,
      },
    })
    setSending(false)

    if (error) {
      Alert.alert(
        'Change unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your change stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not send this change request right now.')
      )
      return
    }
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
            <Text style={styles.modalTitle}>Propose change</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Keep changes formal</Text>
              <Text style={styles.supportWarningText}>
                Use this when the order scope, measurements, fabric, deadline, or rework plan
                changes. The customer sees it in the order timeline before you continue.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>
                Change type <Text style={styles.required}>*</Text>
              </Text>
              {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.reasonRow, type === option && styles.reasonRowActive]}
                  disabled={sending}
                  onPress={() => setType(option)}
                >
                  <View style={[styles.reasonRadio, type === option && styles.reasonRadioActive]} />
                  <Text style={[styles.reasonText, type === option && styles.reasonTextActive]}>
                    {SCOPE_CHANGE_TYPE_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>What this affects</Text>
              {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => {
                const active = impacts.includes(option)
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.reasonRow, active && styles.reasonRowActive]}
                    disabled={sending}
                    onPress={() => toggleImpact(option)}
                  >
                    <View style={[styles.reasonRadio, active && styles.reasonRadioActive]} />
                    <Text style={[styles.reasonText, active && styles.reasonTextActive]}>
                      {SCOPE_CHANGE_IMPACT_LABELS[option]}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Input
              label="What changed?"
              placeholder="e.g. The sleeve reference needs a different cuff, which adds embroidery time before cutting."
              value={summary}
              onChangeText={(value) => {
                setSummary(value)
                if (summaryError) validateSummary(value)
              }}
              onBlur={() => validateSummary(summary)}
              error={summaryError}
              multiline
              numberOfLines={4}
              maxLength={500}
              filterContact
              required
            />

            <MoneyInput
              label="Added price (optional)"
              value={priceImpact}
              onChangeText={(value) => {
                setPriceImpact(value)
                if (priceError) validatePrice(value)
              }}
              onBlur={() => validatePrice(priceImpact)}
              error={priceError}
              currency={currency as AccountCurrencyCode}
            />

            <View style={{ gap: Spacing.sm }}>
              <Text style={styles.fieldLabel}>Who is responsible?</Text>
              {(['CUSTOMER', 'TAILOR', 'DRAPEON', 'SHARED', 'UNRESOLVED'] as const).map(
                (option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.reasonRow, responsibility === option && styles.reasonRowActive]}
                    onPress={() => setResponsibility(option)}
                    disabled={sending}
                  >
                    <View
                      style={[
                        styles.reasonRadio,
                        responsibility === option && styles.reasonRadioActive,
                      ]}
                    />
                    <Text
                      style={[
                        styles.reasonText,
                        responsibility === option && styles.reasonTextActive,
                      ]}
                    >
                      {option === 'UNRESOLVED'
                        ? 'Needs Drapeon review'
                        : option.charAt(0) + option.slice(1).toLowerCase()}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            <View style={{ gap: Spacing.sm }}>
              <Text style={styles.fieldLabel}>
                Proposed deadline{' '}
                {commercialAdjustmentTypeForScope(type ?? 'OTHER') === 'DEADLINE_EXTENSION'
                  ? '(required)'
                  : '(optional)'}
              </Text>
              <Button
                label={
                  proposedDeadline
                    ? proposedDeadline.toLocaleString()
                    : 'Choose exact date and time'
                }
                variant="secondary"
                onPress={() => setShowDeadlinePicker(true)}
              />
              {showDeadlinePicker ? (
                <DateTimePicker
                  value={proposedDeadline ?? new Date(Date.now() + 24 * 60 * 60 * 1000)}
                  mode="datetime"
                  minimumDate={new Date()}
                  onChange={(_event, value) => {
                    setShowDeadlinePicker(false)
                    if (value) setProposedDeadline(value)
                  }}
                />
              ) : null}
            </View>

            <Button
              label="Send change request"
              onPress={send}
              loading={sending}
              disabled={
                sending || !type || summary.trim().length < 10 || !!summaryError || !!priceError
              }
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
