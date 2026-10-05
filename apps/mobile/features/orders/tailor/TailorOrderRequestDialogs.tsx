import { Button, Input } from '@/components/ui'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import type { Measurement } from '@/features/orders/tailor/TailorOrderTypes'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  getAdditionalMeasurementRows,
  labelMeasurementField,
  MATERIAL_ISSUE_REASON_LABELS,
  type MaterialIssueReason,
} from '@/lib/order-support'
import { invokeFunction } from '@/lib/supabase'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { stripExif } from '@/lib/stripExif'
import { launchImagePickerSafely } from '@/lib/image-picker-safe'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { MEDIA_LIMITS_BYTES } from '@drape/shared/media-policy'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SelectableSettingRow } from './SelectableSettingRow'

const MATERIAL_ISSUE_REASON_OPTIONS: MaterialIssueReason[] = [
  'POOR_FABRIC_QUALITY',
  'INSUFFICIENT_YARDAGE',
  'FABRIC_NOT_RECEIVED',
  'WRONG_FABRIC_TYPE',
  'FABRIC_DAMAGED',
  'FABRIC_MISMATCH',
]

export function MeasurementConfirmationRequestModal({
  visible,
  orderId,
  measurements,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  measurements: Measurement | null
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const fieldOptions = [
    'chest',
    'waist',
    'hips',
    'shoulderWidth',
    'inseam',
    'sleeveLength',
    'neckCircumference',
    'height',
    'backLength',
    'outseam',
    'thighCircumference',
    'kneeCircumference',
    'torsoLength',
  ]
    .filter((key) => measurements?.[key] != null)
    .map((key) => ({ key, label: labelMeasurementField(key), value: measurements?.[key] }))
    .concat(
      getAdditionalMeasurementRows(measurements).map((row) => ({
        key: row.label,
        label: row.label,
        value: row.value,
      }))
    )

  function toggleField(field: string) {
    setSelectedFields((previous) =>
      previous.includes(field) ? previous.filter((item) => item !== field) : [...previous, field]
    )
  }

  function validateNote(value: string) {
    if (value.trim().length < 10) {
      setNoteError('Tell the customer what needs confirming before cutting can start.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-measurement-confirmation',
        note: note.trim(),
        fields: selectedFields,
      },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Request unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(
              error,
              'Could not request measurement confirmation right now.'
            )
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
            <Text style={styles.modalTitle}>Measurement confirmation</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Pause cutting until this is answered</Text>
              <Text style={styles.supportWarningText}>
                Select exact fields when possible. Drapeon will show the customer a focused task
                before cutting can start.
              </Text>
            </View>

            {fieldOptions.length > 0 ? (
              <View style={styles.measurementFieldPicker}>
                <Text style={styles.modalSectionLabel}>Fields to confirm</Text>
                <View style={styles.choiceList}>
                  {fieldOptions.map((option) => {
                    const active = selectedFields.includes(option.key)
                    return (
                      <SelectableSettingRow
                        key={option.key}
                        label={option.label}
                        detail={`${String(option.value)} ${measurements?.unit ?? ''}`.trim()}
                        active={active}
                        onPress={() => toggleField(option.key)}
                      />
                    )
                  })}
                </View>
                <Text style={styles.modalHelpText}>
                  Leave unselected only if the question is general. Selected fields travel with the
                  order and Vision review.
                </Text>
              </View>
            ) : null}

            <Input
              label="What needs confirming?"
              placeholder="e.g. Please confirm the sleeve and shoulder measurements before I cut the fabric."
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
              required
            />

            <Button
              label="Send request"
              onPress={send}
              loading={sending}
              disabled={sending || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function FitReadinessModal({
  visible,
  orderId,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  function validateNote(value: string) {
    if (value.trim().length < 10) {
      setNoteError('Explain what you reviewed before clearing this blocker.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'confirm-fit-readiness', note: note.trim() },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Review unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not confirm fit readiness right now.')
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
            <Text style={styles.modalTitle}>Confirm fit readiness</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Clear this only after review</Text>
              <Text style={styles.supportWarningText}>
                Use this once you have reviewed the fit notes and are comfortable moving the order
                toward cutting.
              </Text>
            </View>

            <Input
              label="What did you verify?"
              placeholder="e.g. I reviewed the posture and symmetry notes against the garment plan, and I can cut with the current measurements."
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
              required
            />

            <Button
              label="Confirm fit readiness"
              onPress={send}
              loading={sending}
              disabled={sending || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function StyleAlignmentRequestModal({
  visible,
  orderId,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [proposalUri, setProposalUri] = useState<string | null>(null)

  async function pickProposal() {
    const picked = await launchImagePickerSafely(
      () => ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 }),
      { context: 'style-alignment-proposal', mediaLabel: 'sketch or design sheet' },
    )
    if (picked && !picked.canceled && picked.assets[0]?.uri) setProposalUri(picked.assets[0].uri)
  }

  function validateNote(value: string) {
    const trimmed = value.trim()
    if (trimmed.length < 10) {
      setNoteError('Explain the style interpretation before asking for approval.')
      return false
    }
    const placeholder = rejectPlaceholder(trimmed, 'Style note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(trimmed)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!validateNote(note)) return
    setSending(true)
    let photoUrl: string | undefined
    try {
      if (proposalUri) {
        const cleanUri = await stripExif(proposalUri)
        photoUrl = await uploadPublicStorageImage({
          bucket: 'order-photos',
          path: `progress/${orderId}/style-alignment-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
          uri: cleanUri,
          contentType: 'image/jpeg',
          maxBytes: MEDIA_LIMITS_BYTES.image,
          purpose: 'ORDER_REFERENCE',
        })
      }
    } catch (error) {
      setSending(false)
      Alert.alert('Design image unavailable', isLikelyConnectivityIssue(error) ? 'Connection looks weak. Your style plan stayed here; retry when the signal improves.' : 'The sketch or design sheet could not upload. Choose a smaller image and try again.')
      return
    }
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'request-style-alignment', note: note.trim(), ...(photoUrl ? { photoUrl } : {}) },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Style approval unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not request style approval right now.')
      )
      return
    }
    setProposalUri(null)
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
            <Text style={styles.modalTitle}>Style approval</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Do this before cutting</Text>
              <Text style={styles.supportWarningText}>
                Tell the customer what you can match from the references, what may differ because of
                fabric or budget, and what silhouette or finish you plan to cut.
              </Text>
            </View>

            <Input
              label="Interpretation for customer approval"
              placeholder="e.g. I will keep the same neckline and sleeve shape, use the closest available lace, and make the fit relaxed as requested."
              value={note}
              onChangeText={(value) => {
                setNote(value)
                if (noteError) validateNote(value)
              }}
              onBlur={() => validateNote(note)}
              error={noteError}
              multiline
              numberOfLines={5}
              maxLength={500}
              filterContact
              required
            />

            <Button
              label={proposalUri ? 'Change sketch or look sheet' : 'Add sketch or look sheet'}
              variant="secondary"
              onPress={() => void pickProposal()}
              disabled={sending}
            />
            {proposalUri ? (
              <View>
                <Image source={{ uri: proposalUri }} accessibilityLabel="Selected sketch or look sheet" style={{ width: '100%', height: 180, resizeMode: 'contain', borderRadius: 8 }} />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove selected design image" onPress={() => setProposalUri(null)} disabled={sending}>
                  <Text style={styles.supportWarningText}>Remove image</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <Button
              label="Send for approval"
              onPress={send}
              loading={sending}
              disabled={sending || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function MaterialIssueModal({
  visible,
  orderId,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  onClose: () => void
  onSent: () => void
}) {
  const [reason, setReason] = useState<MaterialIssueReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)

  function validateNote(value: string) {
    if (value.trim().length < 10) {
      setNoteError(
        'Describe the material issue clearly so the customer can choose what to do next.'
      )
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function send() {
    if (sending) return
    if (!reason) {
      Alert.alert('Choose a reason', 'Pick the fabric issue before sending this to the customer.')
      return
    }
    if (!validateNote(note)) return
    setSending(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId, action: 'open-material-issue', reason, note: note.trim() },
    })
    setSending(false)
    if (error) {
      Alert.alert(
        'Issue unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your note stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(error, 'Could not open this material issue right now.')
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
            <Text style={styles.modalTitle}>Open material issue</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Use this before cutting only</Text>
              <Text style={styles.supportWarningText}>
                Keep the reason specific so the customer can replace fabric, ask you to source it,
                revise the design, or request cancellation.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>
                Issue reason <Text style={styles.required}>*</Text>
              </Text>
              {MATERIAL_ISSUE_REASON_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.reasonRow, reason === option && styles.reasonRowActive]}
                  disabled={sending}
                  onPress={() => setReason(option)}
                >
                  <View
                    style={[styles.reasonRadio, reason === option && styles.reasonRadioActive]}
                  />
                  <Text style={[styles.reasonText, reason === option && styles.reasonTextActive]}>
                    {MATERIAL_ISSUE_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="What should the customer know?"
              placeholder="e.g. The supplied fabric is not enough for the agreed style, so I need a replacement or a design change before cutting."
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
              required
            />

            <Button
              label="Send issue to customer"
              onPress={send}
              loading={sending}
              disabled={sending || !reason || note.trim().length < 10 || !!noteError}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export {
  CancellationReviewRequestModal,
  DeliveryReviewRequestModal,
  MaterialAdvanceReceiptModal,
  MaterialAdvanceRequestModal,
} from './TailorOrderCommercialDialogs'
