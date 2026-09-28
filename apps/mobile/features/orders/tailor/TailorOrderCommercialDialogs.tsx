import { Button, Input, MoneyInput } from '@/components/ui'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import type { MaterialAdvance } from '@/features/orders/tailor/TailorOrderTypes'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  CANCELLATION_REVIEW_REASON_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  type CancellationReviewReason,
  type DeliveryReviewReason,
} from '@/lib/order-support'
import { Sentry } from '@/lib/sentry'
import { uploadPrivateStorageImage } from '@/lib/storage-upload'
import { stripExif } from '@/lib/stripExif'
import { invokeFunction } from '@/lib/supabase'
import { parseMoneyInputToMinorUnits, type AccountCurrencyCode } from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import * as ImagePicker from 'expo-image-picker'
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

export function MaterialAdvanceRequestModal({
  visible,
  orderId,
  currency,
  fundedFabric,
  remainingAmount,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  currency: CurrencyCode
  fundedFabric: boolean
  remainingAmount: number | null
  onClose: () => void
  onSent: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [estimateUri, setEstimateUri] = useState<string | null>(null)
  const [titleError, setTitleError] = useState('')
  const [descriptionError, setDescriptionError] = useState('')
  const [amountError, setAmountError] = useState('')
  const [sending, setSending] = useState(false)

  function parseAmountMinor(value: string) {
    return parseMoneyInputToMinorUnits(value) ?? Number.NaN
  }

  function validateTitle(value: string) {
    if (value.trim().length < 3) {
      setTitleError('Name the material or service clearly.')
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Material')
    if (placeholder) {
      setTitleError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setTitleError("Contact details can't be included.")
      return false
    }
    setTitleError('')
    return true
  }

  function validateDescription(value: string) {
    if (value.trim().length < 10) {
      setDescriptionError(
        'Explain exactly why this advance is needed before asking the customer to approve it.'
      )
      return false
    }
    const placeholder = rejectPlaceholder(value, 'Description')
    if (placeholder) {
      setDescriptionError(placeholder)
      return false
    }
    const result = filterContactInfo(value)
    if (result.blocked) {
      setDescriptionError("Contact details can't be included.")
      return false
    }
    setDescriptionError('')
    return true
  }

  function validateAmount(value: string) {
    const minor = parseAmountMinor(value)
    if (!Number.isFinite(minor) || minor <= 0) {
      setAmountError('Enter a valid amount.')
      return false
    }
    setAmountError('')
    return true
  }

  async function send() {
    if (sending) return
    const titleOk = validateTitle(title)
    const descriptionOk = validateDescription(description)
    const amountOk = validateAmount(amount)
    if (!titleOk || !descriptionOk || !amountOk) return
    if (!estimateUri) {
      Alert.alert(
        'Supplier proof needed',
        'Add the supplier estimate or item photo before asking the customer to approve this amount.'
      )
      return
    }

    setSending(true)
    const estimateStoragePath = `material-advances/${orderId}/estimate-${Date.now()}.jpg`
    try {
      await uploadPrivateStorageImage({
        bucket: 'commercial-evidence',
        path: `${orderId}/${estimateStoragePath}`,
        uri: await stripExif(estimateUri),
        contentType: 'image/jpeg',
        maxBytes: 8 * 1024 * 1024,
        upsert: false,
        purpose: 'ORDER_REFERENCE',
      })
    } catch {
      setSending(false)
      Alert.alert(
        'Estimate not uploaded',
        'The supplier proof could not upload. Check your connection and try again.'
      )
      return
    }
    const requestedAmount = parseAmountMinor(amount)
    const needsAdjustment =
      fundedFabric && remainingAmount != null && requestedAmount > remainingAmount
    const { error } = await invokeFunction(
      needsAdjustment ? 'commercial-adjustment-action' : 'material-advance-action',
      {
        body: {
          action: needsAdjustment ? 'propose-fabric-funding-change' : 'request-advance',
          orderId,
          title: title.trim(),
          description: description.trim(),
          ...(needsAdjustment
            ? { requestedReleaseAmount: requestedAmount }
            : { amount: requestedAmount }),
          currency,
          estimateStorageBucket: 'commercial-evidence',
          estimateStoragePath: `${orderId}/${estimateStoragePath}`,
          ...(needsAdjustment
            ? {
                idempotencyKey: `mobile:fabric-adjustment:${orderId}:${estimateStoragePath}:${requestedAmount}`,
              }
            : {}),
        },
      }
    )
    setSending(false)
    if (error) {
      Alert.alert(
        'Advance unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your request stayed here, so retry when the signal improves.'
          : await readFunctionErrorMessage(
              error,
              'Could not request this material advance right now.'
            )
      )
      return
    }
    if (needsAdjustment) {
      Alert.alert(
        'Fabric change sent',
        'Only the amount above the protected allowance was sent for customer approval. No fabric funds move until the customer accepts and the additional payment is confirmed.'
      )
    }
    onSent()
  }

  async function chooseEstimate() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Choose a clear supplier estimate or item photo.')
      return
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    })
    if (!picked.canceled && picked.assets?.[0]?.uri) setEstimateUri(picked.assets[0].uri)
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
              {fundedFabric ? 'Fabric release' : 'Material advance'}
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>
                {fundedFabric ? 'Already funded at checkout' : 'This is not early order release'}
              </Text>
              <Text style={styles.supportWarningText}>
                {fundedFabric
                  ? `Request only the exact supported cost for the approved fabric. The customer reviews the supplier proof but is not charged again. Drapeon Money Desk releases it after approval.${remainingAmount != null ? ` Remaining allowance: ${formatAmount(remainingAmount, currency, currency, STATIC_FALLBACK_RATES)}.` : ''}`
                  : 'Request only the specific material cost the customer needs to approve. The customer pays this separately, ops reviews it, and you upload receipt proof after purchase.'}
              </Text>
            </View>

            <Input
              label="What is this for?"
              placeholder="e.g. Beaded embroidery deposit"
              value={title}
              onChangeText={(value) => {
                setTitle(value)
                if (titleError) validateTitle(value)
              }}
              onBlur={() => validateTitle(title)}
              error={titleError}
              maxLength={120}
              filterContact
              required
            />

            <Button
              label={estimateUri ? 'Supplier proof added' : 'Add supplier estimate or photo'}
              variant="secondary"
              onPress={() => {
                void chooseEstimate()
              }}
              disabled={sending}
            />

            <Input
              label="Why is it needed?"
              placeholder={
                fundedFabric
                  ? 'Explain the approved fabric purchase, supplier, and what final receipt proof you will upload.'
                  : 'Explain what you need to buy, why it is outside the accepted quote, and what receipt proof you will upload.'
              }
              value={description}
              onChangeText={(value) => {
                setDescription(value)
                if (descriptionError) validateDescription(value)
              }}
              onBlur={() => validateDescription(description)}
              error={descriptionError}
              multiline
              numberOfLines={5}
              maxLength={1000}
              filterContact
              required
            />

            <MoneyInput
              label="Amount"
              value={amount}
              onChangeText={(value) => {
                setAmount(value)
                if (amountError) validateAmount(value)
              }}
              onBlur={() => validateAmount(amount)}
              error={amountError}
              currency={currency as AccountCurrencyCode}
              required
            />

            {fundedFabric &&
            remainingAmount != null &&
            Number.isFinite(parseAmountMinor(amount)) &&
            parseAmountMinor(amount) > remainingAmount ? (
              <View style={styles.supportWarningCard} accessibilityRole="alert">
                <Text style={styles.supportWarningTitle}>Additional approval required</Text>
                <Text style={styles.supportWarningText}>
                  Requested:{' '}
                  {formatAmount(
                    parseAmountMinor(amount),
                    currency,
                    currency,
                    STATIC_FALLBACK_RATES
                  )}{' '}
                  · protected allowance left:{' '}
                  {formatAmount(remainingAmount, currency, currency, STATIC_FALLBACK_RATES)} ·
                  additional fabric funding:{' '}
                  {formatAmount(
                    parseAmountMinor(amount) - remainingAmount,
                    currency,
                    currency,
                    STATIC_FALLBACK_RATES
                  )}{' '}
                  before tax.
                </Text>
              </View>
            ) : null}

            <Button
              label={
                fundedFabric &&
                remainingAmount != null &&
                Number.isFinite(parseAmountMinor(amount)) &&
                parseAmountMinor(amount) > remainingAmount
                  ? 'Send fabric funding change'
                  : 'Send for customer approval'
              }
              onPress={send}
              loading={sending}
              disabled={
                sending ||
                title.trim().length < 3 ||
                description.trim().length < 10 ||
                !amount.trim() ||
                !estimateUri
              }
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function MaterialAdvanceReceiptModal({
  visible,
  orderId,
  advance,
  onClose,
  onSaved,
}: {
  visible: boolean
  orderId: string
  advance: MaterialAdvance
  onClose: () => void
  onSaved: () => void
}) {
  const [actualSpent, setActualSpent] = useState('')
  const [note, setNote] = useState('')
  const [receiptUri, setReceiptUri] = useState<string | null>(null)
  const [acquiredUri, setAcquiredUri] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const parsedAmount = parseMoneyInputToMinorUnits(actualSpent) ?? Number.NaN

  async function chooseReceipt(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Add a clear final supplier receipt to reconcile this advance.'
      )
      return
    }
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.85,
          })
    if (!picked.canceled && picked.assets?.[0]?.uri) setReceiptUri(picked.assets[0].uri)
  }

  async function chooseAcquiredProof() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Add a clear, separate photo of the exact fabric now in hand.'
      )
      return
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    })
    if (!picked.canceled && picked.assets?.[0]?.uri) setAcquiredUri(picked.assets[0].uri)
  }

  async function save() {
    if (sending || !receiptUri || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    if (advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE' && !acquiredUri) {
      Alert.alert(
        'Acquired-fabric proof needed',
        'Add a separate photo showing the exact approved fabric is now in hand.'
      )
      return
    }
    setSending(true)
    const receiptStoragePath = `material-advances/${orderId}/${advance.id}-receipt.jpg`
    try {
      await uploadPrivateStorageImage({
        bucket: 'commercial-evidence',
        path: `${orderId}/${receiptStoragePath}`,
        uri: await stripExif(receiptUri),
        contentType: 'image/jpeg',
        maxBytes: 8 * 1024 * 1024,
        upsert: true,
        purpose: 'ORDER_REFERENCE',
      })
      const acquiredStoragePath = `material-advances/${orderId}/${advance.id}-acquired.jpg`
      if (acquiredUri) {
        await uploadPrivateStorageImage({
          bucket: 'commercial-evidence',
          path: `${orderId}/${acquiredStoragePath}`,
          uri: await stripExif(acquiredUri),
          contentType: 'image/jpeg',
          maxBytes: 8 * 1024 * 1024,
          upsert: true,
          purpose: 'ORDER_REFERENCE',
        })
      }
      const { error } = await invokeFunction('material-advance-action', {
        body: {
          action: 'upload-receipt',
          advanceId: advance.id,
          receiptStorageBucket: 'commercial-evidence',
          receiptStoragePath: `${orderId}/${receiptStoragePath}`,
          ...(acquiredUri
            ? {
                acquiredStorageBucket: 'commercial-evidence',
                acquiredStoragePath: `${orderId}/${acquiredStoragePath}`,
              }
            : {}),
          actualSpentAmount: parsedAmount,
          note: note.trim() || undefined,
        },
      })
      if (error)
        throw new Error(
          await readFunctionErrorMessage(error, 'The receipt could not be reconciled.')
        )
      Alert.alert(
        'Advance reconciled',
        parsedAmount === advance.amount
          ? 'The final receipt matches the approved advance.'
          : 'The amount differs from the approved advance, so Drapeon Ops has been asked to review the balance.'
      )
      onSaved()
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'reconcile_material_advance', orderId, advanceId: advance.id },
      })
      Alert.alert(
        'Receipt not saved',
        error instanceof Error ? error.message : 'Try again in a moment.'
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
            <Text style={styles.modalTitle}>Reconcile materials</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Final receipt required</Text>
              <Text style={styles.supportWarningText}>
                Approved:{' '}
                {formatAmount(
                  advance.amount,
                  advance.currency,
                  advance.currency,
                  STATIC_FALLBACK_RATES
                )}
                . Add the supplier receipt and a separate photo of the fabric now in hand. Unused
                value or an overage goes to Drapeon Ops for a recorded outcome.
              </Text>
            </View>
            <MoneyInput
              label="Actual spent"
              value={actualSpent}
              onChangeText={setActualSpent}
              currency={advance.currency as AccountCurrencyCode}
              required
            />
            <Input
              label="Receipt note (optional)"
              placeholder="Supplier, items, or useful context"
              value={note}
              onChangeText={setNote}
              maxLength={500}
              filterContact
            />
            <View style={{ gap: 10 }}>
              <Button
                label={receiptUri ? 'Receipt photo added' : 'Take receipt photo'}
                variant="secondary"
                onPress={() => {
                  void chooseReceipt('camera')
                }}
                disabled={sending}
              />
              <Button
                label="Choose from library"
                variant="secondary"
                onPress={() => {
                  void chooseReceipt('library')
                }}
                disabled={sending}
              />
            </View>
            {advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE' ? (
              <View style={{ gap: 10 }}>
                <Text style={styles.fieldLabel}>Acquired fabric *</Text>
                <Text style={styles.supportHint}>
                  Show the exact approved fabric clearly. This is different from the supplier
                  receipt.
                </Text>
                <Button
                  label={acquiredUri ? 'Acquired-fabric photo added' : 'Add acquired-fabric photo'}
                  variant="secondary"
                  onPress={() => {
                    void chooseAcquiredProof()
                  }}
                  disabled={sending}
                />
              </View>
            ) : null}
            <Button
              label="Submit final receipt"
              onPress={() => {
                void save()
              }}
              loading={sending}
              disabled={
                sending ||
                !receiptUri ||
                (advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE' && !acquiredUri) ||
                !Number.isFinite(parsedAmount) ||
                parsedAmount <= 0
              }
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const TAILOR_CANCELLATION_REVIEW_OPTIONS: CancellationReviewReason[] = [
  'ITEM_UNAVAILABLE',
  'ITEM_DAMAGED_BEFORE_DISPATCH',
  'TAILOR_CANNOT_FULFIL',
  'DISPATCH_DELAY',
  'OTHER',
]

const TAILOR_DELIVERY_REVIEW_OPTIONS: DeliveryReviewReason[] = [
  'DRAPEON_COLLECTION_MISSED',
  'CUSTODY_SCAN_MISMATCH',
  'PARCEL_RETURNED_TO_TAILOR',
  'HANDOFF_DAMAGE',
  'OTHER',
]

export function CancellationReviewRequestModal({
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
  const [reason, setReason] = useState<CancellationReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
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
      Alert.alert(
        'Choose a reason',
        'Tell Drapeon why this order needs cancellation review before handoff.'
      )
      return
    }
    if (!validateNote(note)) return

    setSending(true)
    setSubmitError('')

    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-cancellation-review',
        reason,
        note: note.trim() || undefined,
      },
    })

    setSending(false)
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not open cancellation review right now.')
      setSubmitError(message)
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
            <Text style={styles.modalTitle}>Cancellation review</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Pause handoff until reviewed</Text>
              <Text style={styles.supportWarningText}>
                Use this when the order cannot move forward cleanly before pickup or dispatch
                starts. Drapeon will review the remedy with you and the customer.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>
                Reason <Text style={styles.required}>*</Text>
              </Text>
              {TAILOR_CANCELLATION_REVIEW_OPTIONS.map((option) => (
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
                    {CANCELLATION_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. The item was damaged during final checks before dispatch."
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

            {submitError ? (
              <View style={styles.supportWarningCard}>
                <Text style={styles.supportWarningText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Request review"
              onPress={send}
              loading={sending}
              disabled={sending || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export function DeliveryReviewRequestModal({
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
  const [reason, setReason] = useState<DeliveryReviewReason | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function validateNote(value: string) {
    if (!value.trim()) {
      setNoteError('')
      return true
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
      Alert.alert('Choose a reason', 'Tell Drapeon what went wrong with dispatch or delivery.')
      return
    }
    if (!validateNote(note)) return

    setSending(true)
    setSubmitError('')

    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId,
        action: 'request-delivery-review',
        reason,
        note: note.trim() || undefined,
      },
    })

    setSending(false)
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your review request stayed here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not open delivery review right now.')
      setSubmitError(message)
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
            <Text style={styles.modalTitle}>Shipping &amp; delivery help</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            <View style={styles.supportWarningCard}>
              <Text style={styles.supportWarningTitle}>Pause dispatch until reviewed</Text>
              <Text style={styles.supportWarningText}>
                Use this when Drapeon dispatch is slipping, the recipient could not be reached, or
                the parcel is not reaching the customer cleanly.
              </Text>
            </View>

            <View style={styles.reasonList}>
              <Text style={styles.fieldLabel}>
                Reason <Text style={styles.required}>*</Text>
              </Text>
              {TAILOR_DELIVERY_REVIEW_OPTIONS.map((option) => (
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
                    {DELIVERY_REVIEW_REASON_LABELS[option]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Note (optional)"
              placeholder="Add context for Drapeon. e.g. The rider could not reach the recipient after multiple attempts."
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

            {submitError ? (
              <View style={styles.supportWarningCard}>
                <Text style={styles.supportWarningText}>{submitError}</Text>
              </View>
            ) : null}

            <Button
              label="Request review"
              onPress={send}
              loading={sending}
              disabled={sending || !reason}
            />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Quote Modal ──────────────────────────────────────────────────────────────
