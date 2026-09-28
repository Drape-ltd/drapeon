import { Button, Input } from '@/components/ui'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { Colors, Spacing } from '@/constants/theme'
import { disputeStyles } from '@/features/orders/customer/CustomerDisputeStyles'
import { type CurrencyCode } from '@/lib/currency'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  CANCELLATION_REVIEW_REASON_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  SCOPE_CHANGE_IMPACT_LABELS,
  SCOPE_CHANGE_TYPE_LABELS,
  type CancellationReviewReason,
  type DeliveryReviewReason,
  type ScopeChangeImpact,
  type ScopeChangeType,
} from '@/lib/order-support'
import { Sentry } from '@/lib/sentry'
import { invokeFunction } from '@/lib/supabase'
import { filterContactInfo } from '@drape/shared/contact-filter'
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
import { customerCommercialAdjustmentTypeForScope } from './CustomerOrderDialogConfig'

const CUSTOMER_CANCELLATION_REVIEW_OPTIONS: CancellationReviewReason[] = [
  'CUSTOMER_CHANGED_MIND',
  'NEED_FULFILLMENT_CHANGE',
  'OTHER',
]

const CUSTOMER_DELIVERY_REVIEW_OPTIONS: DeliveryReviewReason[] = [
  'TRACKING_STALLED',
  'SIGNIFICANT_DELAY',
  'NOT_RECEIVED',
  'WRONG_ADDRESS_OR_RECIPIENT',
  'DAMAGED_IN_TRANSIT',
  'MISSING_CONTENTS',
  'RETURNED_TO_DRAPEON',
  'CUSTOMS_OR_CARRIER_CHARGE',
  'RECIPIENT_CONTACT_PROBLEM',
  'OTHER',
]

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

export function ScopeChangeModal({
  visible,
  orderId,
  currency,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  currency: CurrencyCode
  onClose: () => void
  onSubmitted: () => void
}) {
  const [type, setType] = useState<ScopeChangeType | null>(null)
  const [impacts, setImpacts] = useState<ScopeChangeImpact[]>([])
  const [summary, setSummary] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [proposedDeadline, setProposedDeadline] = useState<Date | null>(null)
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false)
  const [deadlinePickerMinimum] = useState(() => new Date())
  const [deadlinePickerDefault] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function toggleImpact(value: ScopeChangeImpact) {
    setImpacts((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    )
  }

  function validateSummary(value: string) {
    if (value.trim().length < 10) {
      setSummaryError('Describe what needs to change so the tailor has a clear record.')
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setSummaryError(result.userMessage)
      return false
    }
    setSummaryError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!type) {
      Alert.alert(
        'Choose a change type',
        'Tell Drapeon what kind of change this is before sending it.'
      )
      return
    }
    if (!validateSummary(summary)) return

    const adjustmentType = customerCommercialAdjustmentTypeForScope(type)
    if ((type === 'DEADLINE_OR_EVENT' || type === 'PAUSE_OR_RESTART') && !proposedDeadline) {
      Alert.alert(
        'Choose the requested deadline',
        'Record the exact date and time so your tailor can make a clear decision.'
      )
      return
    }

    setSubmitting(true)
    setSubmitError('')
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
        responsibility: 'UNRESOLVED',
        amountDelta: 0,
        currency,
        proposedDeadline: proposedDeadline?.toISOString() ?? null,
        evidenceIds: [],
        idempotencyKey: `mobile-customer:${orderId}:${Date.now()}`,
      },
    })
    setSubmitting(false)

    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_scope_change', orderId, type, impacts },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your change stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not send this change request right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    onSubmitted()
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
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Request change</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Use this before the next production step when measurements, style, fabric, deadline,
                or scope need to change. Price or deadline changes stay on record inside Drapeon.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Change type <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    type === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setType(option)}
                >
                  <View
                    style={[disputeStyles.radio, type === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      type === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {SCOPE_CHANGE_TYPE_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View>
              <Text style={disputeStyles.label}>What could this affect?</Text>
              {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => {
                const active = impacts.includes(option)
                return (
                  <TouchableOpacity
                    key={option}
                    style={[disputeStyles.reasonRow, active && disputeStyles.reasonRowActive]}
                    disabled={submitting}
                    onPress={() => toggleImpact(option)}
                  >
                    <View style={[disputeStyles.radio, active && disputeStyles.radioActive]} />
                    <Text
                      style={[disputeStyles.reasonText, active && disputeStyles.reasonTextActive]}
                    >
                      {SCOPE_CHANGE_IMPACT_LABELS[option]}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Input
              label="What needs to change? *"
              placeholder="e.g. I used old measurements and need the waist updated before cutting starts."
              value={summary}
              onChangeText={(value) => {
                setSummary(value)
                if (summaryError) validateSummary(value)
              }}
              onBlur={() => validateSummary(summary)}
              error={summaryError}
              multiline
              numberOfLines={5}
              maxLength={500}
              filterContact
              required
            />

            {type === 'DEADLINE_OR_EVENT' || type === 'PAUSE_OR_RESTART' ? (
              <View style={{ gap: Spacing.sm }}>
                <Text style={disputeStyles.label}>Exact requested deadline *</Text>
                <Button
                  label={
                    proposedDeadline ? proposedDeadline.toLocaleString() : 'Choose date and time'
                  }
                  variant="secondary"
                  onPress={() => setShowDeadlinePicker(true)}
                />
                {showDeadlinePicker ? (
                  <DateTimePicker
                    value={proposedDeadline ?? deadlinePickerDefault}
                    mode="datetime"
                    minimumDate={deadlinePickerMinimum}
                    onChange={(_event, value) => {
                      setShowDeadlinePicker(false)
                      if (value) setProposedDeadline(value)
                    }}
                  />
                ) : null}
              </View>
            ) : null}

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                If the tailor has already cut fabric, this may affect price, timing, or the remedy
                Drapeon can approve.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send change request"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !type || summary.trim().length < 10 || !!summaryError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function CancellationReviewModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [reason, setReason] = useState<CancellationReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError(result.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) {
      Alert.alert(
        'Choose a reason',
        'Tell Drapeon why this ready-made order needs review before handoff.'
      )
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-cancellation-review',
        cancellationReason: reason,
        note: note.trim() || undefined,
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_cancellation_review', orderId, reason },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not open cancellation review right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    onSubmitted()
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
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Cancellation review</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Use this before pickup or dispatch starts. Drapeon will pause the handoff and review
                the best remedy with you and the seller.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Reason <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {CUSTOMER_CANCELLATION_REVIEW_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    reason === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setReason(option)}
                >
                  <View
                    style={[disputeStyles.radio, reason === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      reason === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {CANCELLATION_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. I need to switch from delivery to pickup before dispatch is booked."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={4}
              maxLength={300}
              filterContact
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                If dispatch has already been booked or the order is already at pickup handoff,
                Drapeon may need a fuller support review instead of an instant cancellation.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Request review"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function EmergencySupportModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [description, setDescription] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function validateDescription(value: string) {
    if (value.trim().length < 10) {
      setDescriptionError('Tell Drapeon what is urgent and when the garment is needed.')
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setDescriptionError(result.userMessage)
      return false
    }
    setDescriptionError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!validateDescription(description)) return
    setSubmitting(true)
    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-emergency-support',
        description: description.trim(),
      },
    })
    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'request_emergency_support', orderId } })
      Alert.alert(
        'Emergency request not sent',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(
              error,
              'Could not send this emergency request right now.'
            )
      )
      return
    }
    Alert.alert(
      'Drapeon support alerted',
      'We opened an urgent ops review and will keep the order thread as the source of truth.'
    )
    onSubmitted()
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
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Emergency help</Text>
            <View style={{ width: 64 }} />
          </View>
          <ScrollView contentContainerStyle={disputeStyles.content}>
            <Text style={disputeStyles.infoText}>
              Use this for event-sensitive issues only: wear date within 24 hours, item cannot be
              worn, delivery is missing, or a handoff has broken down.
            </Text>
            <Input
              label="What happened?"
              value={description}
              onChangeText={(value) => {
                setDescription(value)
                if (descriptionError) validateDescription(value)
              }}
              placeholder="Example: My wedding is tomorrow morning and the zipper broke during pickup inspection."
              multiline
              numberOfLines={5}
              error={descriptionError}
              hint="Enter at least 10 characters so support can act without asking you to repeat the issue."
              filterContact
              required
            />
            <Button
              label="Alert Drapeon support"
              variant="danger"
              onPress={submit}
              loading={submitting}
              disabled={submitting || description.trim().length < 10 || !!descriptionError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function DeliveryReviewModal({
  visible,
  orderId,
  onClose,
  onSubmitted,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSubmitted: () => void
}) {
  const [reason, setReason] = useState<DeliveryReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError(result.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) {
      Alert.alert('Choose a reason', 'Tell Drapeon what went wrong with dispatch or delivery.')
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-delivery-review',
        deliveryReason: reason,
        note: note.trim() || undefined,
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_delivery_review', orderId, reason },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your delivery review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not open delivery review right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    onSubmitted()
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
        <SafeAreaView style={disputeStyles.safe}>
          <View style={disputeStyles.header}>
            <TouchableOpacity onPress={onClose} disabled={submitting}>
              <Text style={disputeStyles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={disputeStyles.title}>Shipping &amp; delivery help</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Tell Drapeon what happened. Routine follow-up stays open without stopping the order;
                high-risk custody, damage, missing-content, or non-delivery reports pause protected
                steps for review.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Reason <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {CUSTOMER_DELIVERY_REVIEW_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    reason === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setReason(option)}
                >
                  <View
                    style={[disputeStyles.radio, reason === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      reason === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {DELIVERY_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. The tracking says delivered, but nothing reached my address."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={4}
              maxLength={300}
              filterContact
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Keep dispatch, courier, or proof details inside Drapeon while the review is open so
                support can follow one clean record.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send to Drapeon"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export {
  AftercareSupportModal,
  DisputeModal,
  MaterialIssueResponseModal,
} from './CustomerOrderSupportDialogs'
