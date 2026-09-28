import { Button, Input } from '@/components/ui'
import { Colors } from '@/constants/theme'
import { disputeStyles } from '@/features/orders/customer/CustomerDisputeStyles'
import {
  isLikelyConnectivityIssue,
  isMachineErrorCodeMessage,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import { MATERIAL_ISSUE_RESPONSE_LABELS, type MaterialIssueResponse } from '@/lib/order-support'
import { Sentry } from '@/lib/sentry'
import { invokeFunction } from '@/lib/supabase'
import { filterContactInfo } from '@drape/shared/contact-filter'
import {
  CUSTOMER_CONCERN_REASONS,
  CUSTOMER_CONCERN_REASON_LABELS,
  FINANCIAL_CASE_REQUESTED_OUTCOMES,
  FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS,
  evidencePromptsForConcern,
  type CustomerConcernReason,
  type FinancialCaseRequestedOutcome,
} from '@drape/shared/financial-cases'
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
import {
  AFTERCARE_SUPPORT_LABELS,
  AFTERCARE_SUPPORT_OPTIONS,
  type AftercareSupportType,
} from './CustomerOrderDialogConfig'

const MATERIAL_ISSUE_RESPONSE_OPTIONS: MaterialIssueResponse[] = [
  'REPLACE_FABRIC',
  'ASK_TAILOR_TO_SOURCE',
  'REVISE_DESIGN',
  'CANCEL_ORDER',
]

export function AftercareSupportModal({
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
  const [issueType, setIssueType] = useState<AftercareSupportType | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('Please describe the issue so Drapeon can review it.')
      return false
    }
    if (value.trim().length < 10) {
      setNoteError('Add a little more detail so Drapeon can understand the issue.')
      return false
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
    if (!issueType) {
      Alert.alert(
        'Choose an issue type',
        'Tell Drapeon what kind of aftercare help you need before sending this request.'
      )
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'request-aftercare-support',
        aftercareType: issueType,
        note: note.trim(),
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'request_aftercare_support', orderId, issueType },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your aftercare request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not send this aftercare request right now. Please try again.'
          )
      setSubmitError(message)
      return
    }

    Alert.alert(
      'Aftercare issue logged',
      'Drapeon can now follow this from the order timeline and ops workflow.'
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
            <Text style={disputeStyles.title}>Aftercare help</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Keep fit, finish, and workmanship follow-up inside Drapeon so support and ops can
                review one clean timeline.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Issue type <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {AFTERCARE_SUPPORT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    issueType === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setIssueType(option)}
                >
                  <View
                    style={[disputeStyles.radio, issueType === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      issueType === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {AFTERCARE_SUPPORT_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="What happened? *"
              placeholder="Describe the fit, finish, or workmanship issue and tell Drapeon what you need help with."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={5}
              maxLength={400}
              filterContact
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Add photos and any alteration notes in the live order thread too, so Drapeon can
                follow the full aftercare record.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send to Drapeon support"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !issueType}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function MaterialIssueResponseModal({
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
  const [response, setResponse] = useState<MaterialIssueResponse | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
    }
    const res = filterContactInfo(value)
    if (res.blocked) {
      setNoteError(res.userMessage)
      return false
    }
    setNoteError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!response) {
      Alert.alert(
        'Choose a response',
        'Please tell your tailor how you want to handle this fabric issue.'
      )
      return
    }
    if (!validateNote(note)) return

    setSubmitting(true)
    setSubmitError('')

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'respond-material-issue',
        materialIssueResponse: response,
        note: note.trim() || undefined,
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'respond_material_issue', orderId, response },
      })
      if (isLikelyConnectivityIssue(error)) {
        setSubmitError(
          'Your connection looks weak. This response draft stayed here, so retry when the signal improves.'
        )
        return
      }
      const payload = await readFunctionErrorPayload(error)
      const code = typeof payload?.code === 'string' ? payload.code : null
      const payloadMessage =
        typeof payload?.message === 'string' && payload.message.trim().length > 0
          ? payload.message.trim()
          : typeof payload?.error === 'string' &&
              payload.error.trim().length > 0 &&
              !isMachineErrorCodeMessage(payload.error.trim())
            ? payload.error.trim()
            : null
      if (code === 'THREATENING_LANGUAGE') {
        const message = payloadMessage ?? "That note can't be submitted yet."
        setNoteError(message)
        setSubmitError(message)
        return
      }
      const message = await readFunctionErrorMessage(
        error,
        'Could not save your response right now. Please try again.'
      )
      setSubmitError(message)
      if (code === 'UNAUTHORIZED') {
        Alert.alert('Session expired', message)
      }
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
            <Text style={disputeStyles.title}>Handle fabric issue</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Keep this response inside Drapeon so the order timeline stays clear if support needs
                to step in later.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Your choice <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {MATERIAL_ISSUE_RESPONSE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    disputeStyles.reasonRow,
                    response === option && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setResponse(option)}
                >
                  <View
                    style={[disputeStyles.radio, response === option && disputeStyles.radioActive]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      response === option && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {MATERIAL_ISSUE_RESPONSE_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for your tailor. e.g. I can replace the fabric on Saturday."
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

            {response === 'CANCEL_ORDER' ? (
              <View style={disputeStyles.warningCard}>
                <Text style={disputeStyles.warningText}>
                  Cancelling here sends a request for review. The order does not disappear instantly
                  if work or fabric decisions already happened.
                </Text>
              </View>
            ) : null}

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Send response"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !response}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function DisputeModal({
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
  const [reason, setReason] = useState<CustomerConcernReason | null>(null)
  const [requestedOutcome, setRequestedOutcome] = useState<FinancialCaseRequestedOutcome | null>(
    null
  )
  const [description, setDescription] = useState('')
  const [descError, setDescError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function readPayloadString(payload: Record<string, unknown> | null, key: string) {
    const value = payload?.[key]
    if (typeof value !== 'string' || value.trim().length === 0) return null
    const trimmed = value.trim()
    return key === 'code' || !isMachineErrorCodeMessage(trimmed) ? trimmed : null
  }

  async function resolveConcernFailure(error: Error | null) {
    const payload = error ? await readFunctionErrorPayload(error) : null
    const code = readPayloadString(payload, 'code')
    const payloadMessage =
      readPayloadString(payload, 'message') ?? readPayloadString(payload, 'error')

    if (code === 'UNAUTHORIZED') {
      return {
        message: payloadMessage ?? 'Please sign in again before raising a concern.',
        descMessage: '',
        showAlert: true,
      }
    }

    if (code === 'THREATENING_LANGUAGE') {
      return {
        message: payloadMessage ?? "That concern description can't be submitted yet.",
        descMessage: payloadMessage ?? "That concern description can't be submitted yet.",
        showAlert: false,
      }
    }

    if (code === 'RATE_LIMITED') {
      return {
        message:
          payloadMessage ??
          'Too many concern attempts right now. Please wait a moment before trying again.',
        descMessage: '',
        showAlert: true,
      }
    }

    if (
      code === 'DISPUTE_REASON_REQUIRED' ||
      code === 'DISPUTE_DESCRIPTION_REQUIRED' ||
      code === 'DISPUTE_OUTCOME_REQUIRED'
    ) {
      return {
        message: payloadMessage ?? 'Please finish the concern details before submitting.',
        descMessage:
          code === 'DISPUTE_DESCRIPTION_REQUIRED'
            ? (payloadMessage ?? 'Please describe what happened before submitting this concern.')
            : '',
        showAlert: false,
      }
    }

    if (isLikelyConnectivityIssue(error)) {
      return {
        message:
          'Your connection looks weak. Your concern draft is still here, so retry when the signal improves.',
        descMessage: '',
        showAlert: false,
      }
    }

    return {
      message: await readFunctionErrorMessage(error, 'Could not submit concern. Please try again.'),
      descMessage: '',
      showAlert: true,
    }
  }

  function validateDesc(t: string) {
    const res = filterContactInfo(t)
    if (res.blocked) {
      setDescError(res.userMessage)
      return false
    }
    setDescError('')
    return true
  }

  async function submit() {
    if (submitting) return
    if (!reason) {
      Alert.alert('Select a reason', 'Please pick a reason for your concern.')
      return
    }
    if (!requestedOutcome) {
      Alert.alert(
        'Choose an outcome',
        'Tell us what outcome would help so the review has a clear starting point.'
      )
      return
    }
    if (!description.trim()) {
      Alert.alert('Add details', 'Please describe the issue.')
      return
    }
    if (!validateDesc(description)) return

    setSubmitError('')
    setSubmitting(true)

    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId,
        action: 'open-dispute',
        reason,
        requestedOutcome,
        description: description.trim(),
      },
    })

    setSubmitting(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'open_dispute', orderId } })
      const failure = await resolveConcernFailure(error)
      if (failure.descMessage) setDescError(failure.descMessage)
      setSubmitError(failure.message)
      if (failure.showAlert) {
        Alert.alert(
          failure.message.includes('sign in again') ? 'Session expired' : 'Concern unavailable',
          failure.message
        )
      }
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
            <Text style={disputeStyles.title}>Raise a concern</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={disputeStyles.scroll} contentContainerStyle={disputeStyles.content}>
            <View style={disputeStyles.infoCard}>
              <Text style={disputeStyles.infoText}>
                Our team will review your concern within 72 hours. Keep messaging your tailor in the
                meantime, and include dates, delivery or fit details, and what outcome you need.
              </Text>
            </View>

            <View>
              <Text style={disputeStyles.label}>
                Reason <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {CUSTOMER_CONCERN_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[disputeStyles.reasonRow, reason === r && disputeStyles.reasonRowActive]}
                  disabled={submitting}
                  onPress={() => setReason(r)}
                >
                  <View style={[disputeStyles.radio, reason === r && disputeStyles.radioActive]} />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      reason === r && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {CUSTOMER_CONCERN_REASON_LABELS[r]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View>
              <Text style={disputeStyles.label}>
                What outcome would help? <Text style={{ color: Colors.error }}>*</Text>
              </Text>
              {FINANCIAL_CASE_REQUESTED_OUTCOMES.map((outcome) => (
                <TouchableOpacity
                  key={outcome}
                  style={[
                    disputeStyles.reasonRow,
                    requestedOutcome === outcome && disputeStyles.reasonRowActive,
                  ]}
                  disabled={submitting}
                  onPress={() => setRequestedOutcome(outcome)}
                >
                  <View
                    style={[
                      disputeStyles.radio,
                      requestedOutcome === outcome && disputeStyles.radioActive,
                    ]}
                  />
                  <Text
                    style={[
                      disputeStyles.reasonText,
                      requestedOutcome === outcome && disputeStyles.reasonTextActive,
                    ]}
                  >
                    {FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS[outcome]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {reason && evidencePromptsForConcern(reason).length > 0 ? (
              <View style={disputeStyles.infoCard}>
                <Text style={disputeStyles.infoText}>
                  Helpful evidence:{' '}
                  {evidencePromptsForConcern(reason)
                    .map((prompt) => prompt.label)
                    .join(' · ')}
                  . You can add it securely in the order thread after submitting.
                </Text>
              </View>
            ) : null}

            <Input
              label="Describe the issue"
              placeholder="What happened? Be as specific as possible. Include dates, what was promised, and what you received."
              value={description}
              onChangeText={(v) => {
                setDescription(v)
                if (descError) validateDesc(v)
              }}
              onBlur={() => validateDesc(description)}
              error={descError}
              multiline
              numberOfLines={5}
              maxLength={2000}
              filterContact
              required
            />

            <View style={disputeStyles.warningCard}>
              <Text style={disputeStyles.warningText}>
                Raising a concern pauses the order. Payment stays protected inside Drapeon until the
                concern is resolved, so keep all updates and evidence here.
              </Text>
            </View>

            {submitError ? (
              <View style={disputeStyles.submitErrorCard}>
                <Text style={disputeStyles.submitErrorText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Submit concern"
              onPress={submit}
              loading={submitting}
              disabled={submitting || !reason || !requestedOutcome || !description.trim()}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
