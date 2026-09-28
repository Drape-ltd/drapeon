import {
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  Input,
  MoneyInput,
} from '@/components/ui'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { Colors } from '@/constants/theme'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import { capture } from '@/lib/analytics'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import {
  isLikelyConnectivityIssue,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import { invokeFunction } from '@/lib/supabase'
import {
  currencySymbol,
  formatMoneyInputValue,
  isMeaningfulTailorQuoteDraft,
  isFundedFabricPolicy,
  parseMoneyInputToMinorUnits,
  QUOTE_ORDER_REVIEW_COPY,
  QUOTE_ORDER_REVIEW_VERSION,
  TAILOR_QUOTE_DRAFT_VERSION,
  type AccountCurrencyCode,
  type TailorQuoteDraftFields,
} from '@drape/shared'
import { filterContactInfo } from '@drape/shared/contact-filter'
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
import { parseListInput } from './TailorOrderFormatting'

export function QuoteModal({
  visible,
  orderId,
  mode,
  quoteId,
  expectedQuoteVersion,
  revisionRequestId,
  initialAmount,
  initialTailoringAmount,
  initialFabricAllowanceAmount,
  initialFabricCoverage,
  initialFabricAssumptions,
  initialCompletionDate,
  defaultCurrency,
  deliveryMethod,
  fabricSource,
  fabricFundingPolicyVersion,
  customerDeadline,
  onClose,
  onSent,
}: {
  visible: boolean
  orderId: string
  mode: 'send' | 'revise'
  quoteId: string | null
  expectedQuoteVersion: number | null
  revisionRequestId: string | null
  initialAmount: number | null
  initialTailoringAmount: number | null
  initialFabricAllowanceAmount: number | null
  initialFabricCoverage: string[]
  initialFabricAssumptions: string
  initialCompletionDate: string | null
  defaultCurrency: CurrencyCode
  deliveryMethod: string
  fabricSource: string
  fabricFundingPolicyVersion: string | null
  customerDeadline: string | null
  onClose: () => void
  onSent: () => void
}) {
  const currencyLabel = `${currencySymbol(defaultCurrency)} ${defaultCurrency}`
  const [amount, setAmount] = useState(
    initialAmount != null ? formatMoneyInputValue(String(initialAmount / 100)) : ''
  )
  const [tailoringAmount, setTailoringAmount] = useState(
    (initialTailoringAmount ?? (fabricSource === 'CUSTOMER_SUPPLIES' ? initialAmount : null)) != null
      ? formatMoneyInputValue(String((initialTailoringAmount ?? initialAmount!) / 100))
      : ''
  )
  const [fabricAllowanceAmount, setFabricAllowanceAmount] = useState(
    initialFabricAllowanceAmount != null
      ? formatMoneyInputValue(String(initialFabricAllowanceAmount / 100))
      : ''
  )
  const [fabricCoverage, setFabricCoverage] = useState<string[]>(
    initialFabricCoverage.length > 0
      ? initialFabricCoverage
      : fabricSource === 'TAILOR_SOURCES'
        ? ['FABRIC']
        : []
  )
  const [fabricAssumptions, setFabricAssumptions] = useState(initialFabricAssumptions)
  const [completionDate, setCompletionDate] = useState(
    initialCompletionDate ? initialCompletionDate.slice(0, 10) : ''
  )
  const [completionDateValue, setCompletionDateValue] = useState<Date | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [laborAmount, setLaborAmount] = useState('')
  const [sourcingAmount, setSourcingAmount] = useState('')
  const [rushAmount, setRushAmount] = useState('')
  const [includedText, setIncludedText] = useState('')
  const [excludedText, setExcludedText] = useState('')
  const [breakdownSummary, setBreakdownSummary] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [orderReviewAcknowledged, setOrderReviewAcknowledged] = useState(false)
  const [sending, setSending] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftStatus, setDraftStatus] = useState('')
  const quoteDockScroll = useDrapeCapsuleNavScroll()
  const fundedFabricQuote = isFundedFabricPolicy(fabricFundingPolicyVersion)
  const tailorSourcesFabric = fabricSource === 'TAILOR_SOURCES'

  const draftFields: TailorQuoteDraftFields = {
    amount,
    tailoringAmount,
    fabricAllowanceAmount,
    fabricCoverage,
    fabricAssumptions,
    completionDate,
    laborAmount,
    sourcingAmount,
    rushAmount,
    includedText,
    excludedText,
    breakdownSummary,
    note,
    currency: defaultCurrency as AccountCurrencyCode,
  }

  useEffect(() => {
    if (!visible) {
      setDraftLoaded(false)
      setDraftStatus('')
      return
    }
    let active = true
    setDraftStatus('Loading saved draft...')
    void invokeFunction('tailor-quote-draft-action', {
      body: { action: 'load', orderId },
    }).then(({ data, error }) => {
      if (!active) return
      const draft =
        !error &&
        data?.draft &&
        data.draft.version === TAILOR_QUOTE_DRAFT_VERSION &&
        data.draft.mode === mode
          ? data.draft
          : null
      const fields = draft?.fields as Partial<TailorQuoteDraftFields> | undefined
      if (fields) {
        setAmount(formatMoneyInputValue(fields.amount ?? ''))
        setTailoringAmount(formatMoneyInputValue(fields.tailoringAmount ||
          (fabricSource === 'CUSTOMER_SUPPLIES' ? fields.amount ?? '' : '')))
        setFabricAllowanceAmount(formatMoneyInputValue(fields.fabricAllowanceAmount ?? ''))
        setFabricCoverage(Array.isArray(fields.fabricCoverage) ? fields.fabricCoverage : [])
        setFabricAssumptions(fields.fabricAssumptions ?? '')
        setCompletionDate(fields.completionDate ?? '')
        setLaborAmount(formatMoneyInputValue(fields.laborAmount ?? ''))
        setSourcingAmount(formatMoneyInputValue(fields.sourcingAmount ?? ''))
        setRushAmount(formatMoneyInputValue(fields.rushAmount ?? ''))
        setIncludedText(fields.includedText ?? '')
        setExcludedText(fields.excludedText ?? '')
        setBreakdownSummary(fields.breakdownSummary ?? '')
        setNote(fields.note ?? '')
        setOrderReviewAcknowledged(false)
        setDraftStatus('Draft restored')
      } else {
        setDraftStatus(error ? 'Draft sync unavailable' : '')
      }
      setDraftLoaded(true)
    })
    return () => {
      active = false
    }
  }, [mode, orderId, visible])

  async function persistDraft(fields: TailorQuoteDraftFields = draftFields) {
    if (!isMeaningfulTailorQuoteDraft(fields)) return true
    setDraftSaving(true)
    setDraftStatus('Saving draft...')
    const { data, error } = await invokeFunction('tailor-quote-draft-action', {
      body: {
        action: 'save',
        orderId,
        version: TAILOR_QUOTE_DRAFT_VERSION,
        mode,
        fields,
      },
    })
    setDraftSaving(false)
    if (error || !data?.ok) {
      setDraftStatus('Draft not synced')
      return false
    }
    setDraftStatus('Draft saved')
    return true
  }

  useEffect(() => {
    if (!visible || !draftLoaded || sending || !isMeaningfulTailorQuoteDraft(draftFields)) return
    setDraftStatus('Unsaved changes')
    const timer = setTimeout(() => {
      void persistDraft(draftFields)
    }, 900)
    return () => clearTimeout(timer)
  }, [
    visible,
    draftLoaded,
    sending,
    amount,
    tailoringAmount,
    fabricAllowanceAmount,
    fabricCoverage,
    fabricAssumptions,
    completionDate,
    laborAmount,
    sourcingAmount,
    rushAmount,
    includedText,
    excludedText,
    breakdownSummary,
    note,
  ])

  async function saveAndReturn() {
    const saved = await persistDraft()
    if (!saved) {
      Alert.alert(
        'Draft not synced',
        'Check your connection before leaving so this quote work is not lost.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Leave anyway', style: 'destructive', onPress: onClose },
        ]
      )
      return
    }
    onClose()
  }

  function defaultCompletionDateValue() {
    const next = new Date()
    next.setDate(next.getDate() + 14)
    if (customerDeadline) {
      const deadline = new Date(customerDeadline)
      if (!isNaN(deadline.getTime()) && deadline.getTime() < next.getTime()) {
        next.setTime(deadline.getTime())
      }
    }
    return next
  }

  function formatDateInput(date: Date) {
    return date.toISOString().slice(0, 10)
  }

  const effectiveCompletionDate = completionDate || formatDateInput(defaultCompletionDateValue())
  const fabricAllocationIncomplete =
    fundedFabricQuote &&
    tailorSourcesFabric &&
    (!fabricAllowanceAmount || fabricCoverage.length === 0 || fabricAssumptions.trim().length < 8)
  const quoteBlockedReason = sending
    ? null
    : !orderReviewAcknowledged
      ? 'Confirm that you reviewed the order before sending.'
      : (!fundedFabricQuote && !amount) || (fundedFabricQuote && !tailoringAmount)
        ? 'Add the required quote amount before sending.'
        : fabricAllocationIncomplete
          ? 'Complete the fabric allowance details before sending.'
          : !effectiveCompletionDate
            ? 'Choose an estimated completion date before sending.'
            : noteError
              ? 'Fix the note above before sending.'
              : null
  const quoteSubmitDisabled = sending || !!quoteBlockedReason

  function openCompletionDatePicker() {
    const next = completionDateValue ? new Date(completionDateValue) : defaultCompletionDateValue()
    setCompletionDateValue(next)
    setCompletionDate(formatDateInput(next))
    setShowDatePicker(true)
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
    if ((!fundedFabricQuote && !amount) || !effectiveCompletionDate) return
    if (!validateNote(note)) return
    if (!orderReviewAcknowledged) {
      Alert.alert(
        'Review the order first',
        'Confirm that you reviewed the complete order before sending this quote.'
      )
      return
    }
    if (mode === 'revise' && (!quoteId || !expectedQuoteVersion)) {
      Alert.alert('Quote changed', 'Refresh this order before sending a revised quote.')
      return
    }

    // Validate date — Hermes (iOS) rejects non-padded formats like "2026/04/1"
    const parsedDate = new Date(effectiveCompletionDate)
    if (isNaN(parsedDate.getTime())) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD format, e.g. 2026-04-01')
      return
    }
    const deadlineDate = customerDeadline ? new Date(customerDeadline) : null
    if (deadlineDate && parsedDate.getTime() > deadlineDate.getTime()) {
      Alert.alert(
        'Deadline exceeded',
        `This quote date goes past the customer deadline of ${deadlineDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Choose an earlier date.`
      )
      return
    }

    setSending(true)
    try {
      const tailoringMinor = parseMoneyInputToMinorUnits(tailoringAmount)
      const allowanceMinor = tailorSourcesFabric
        ? parseMoneyInputToMinorUnits(fabricAllowanceAmount)
        : 0
      if (fundedFabricQuote && (tailoringMinor == null || tailoringMinor <= 0)) {
        Alert.alert('Add tailoring amount', 'Enter the amount for tailoring and construction.')
        return
      }
      if (
        fundedFabricQuote &&
        tailorSourcesFabric &&
        (!allowanceMinor || fabricCoverage.length === 0 || fabricAssumptions.trim().length < 8)
      ) {
        Alert.alert(
          'Complete fabric allowance',
          'Add the fabric amount, what it covers, and clear sourcing assumptions.'
        )
        return
      }
      const amountPence = fundedFabricQuote
        ? (tailoringMinor ?? 0) + (allowanceMinor ?? 0)
        : parseMoneyInputToMinorUnits(amount)
      if (!amountPence) {
        Alert.alert(
          'Enter a valid quote amount',
          'Check the formatted amount and its written readback before sending.'
        )
        return
      }
      const parsedLaborAmount = parseMoneyInputToMinorUnits(laborAmount)
      const parsedSourcingAmount = parseMoneyInputToMinorUnits(sourcingAmount)
      const parsedRushAmount = parseMoneyInputToMinorUnits(rushAmount)
      const breakdown = {
        ...(parsedLaborAmount != null ? { laborAmount: parsedLaborAmount } : {}),
        ...(parsedSourcingAmount != null ? { sourcingAmount: parsedSourcingAmount } : {}),
        ...(parsedRushAmount != null ? { rushAmount: parsedRushAmount } : {}),
        included: parseListInput(includedText),
        excluded: parseListInput(excludedText),
        summary: breakdownSummary.trim() || undefined,
      }
      const hasBreakdown =
        parsedLaborAmount != null ||
        parsedSourcingAmount != null ||
        parsedRushAmount != null ||
        breakdown.included.length > 0 ||
        breakdown.excluded.length > 0 ||
        !!breakdown.summary

      const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
        body: {
          orderId,
          action: mode === 'revise' ? 'revise-quote' : 'send-quote',
          ...(mode === 'revise'
            ? {
                quoteId,
                expectedQuoteVersion,
                ...(revisionRequestId ? { revisionRequestId } : {}),
                changeKind: revisionRequestId
                  ? ('CUSTOMER_REVISION' as const)
                  : ('TAILOR_CORRECTION' as const),
              }
            : {}),
          amount: amountPence,
          currency: defaultCurrency,
          completionDate: parsedDate.toISOString(),
          breakdown: hasBreakdown ? breakdown : undefined,
          ...(fundedFabricQuote
            ? {
                fabricAllocation: {
                  tailoringAmount: tailoringMinor,
                  fabricAllowanceAmount: allowanceMinor,
                  coverage: fabricCoverage,
                  sourcingAssumptions: tailorSourcesFabric ? fabricAssumptions.trim() : '',
                },
              }
            : {}),
          orderReview: {
            acknowledged: true,
            version: QUOTE_ORDER_REVIEW_VERSION,
          },
          note: note.trim() || undefined,
        },
      })

      if (efError || !efData?.ok) {
        const errorPayload = efError ? await readFunctionErrorPayload(efError) : null
        const errorMessage =
          typeof errorPayload?.message === 'string' && errorPayload.message.length > 0
            ? errorPayload.message
            : typeof errorPayload?.error === 'string' && errorPayload.error.length > 0
              ? errorPayload.error
              : typeof efData?.message === 'string' && efData.message.length > 0
                ? efData.message
                : typeof efData?.error === 'string' && efData.error.length > 0
                  ? efData.error
                  : await readFunctionErrorMessage(
                      efError,
                      'We could not send this quote. Your draft is still saved.'
                    )
        const err = new Error(errorMessage)
        Sentry.captureException(err, { extra: { context: 'send_quote', orderId } })
        throw err
      }

      capture(mode === 'revise' ? 'quote_revised' : 'quote_sent', {
        amount_pence: amountPence,
        has_note: !!note.trim(),
      })
      await invokeFunction('tailor-quote-draft-action', {
        body: { action: 'delete', orderId },
      }).catch(() => null)
      Alert.alert(
        mode === 'revise' ? 'Revised quote sent' : 'Quote sent',
        mode === 'revise'
          ? 'The customer was notified. The updated quote is now the version awaiting their decision.'
          : 'The customer was notified. Regular scheduled calls are now available in the order chat.',
        [{ text: 'Done', onPress: onSent }],
        { cancelable: false }
      )
    } catch (e) {
      Sentry.captureException(e, { extra: { context: 'send_quote_submit', orderId } })
      Alert.alert(
        'Quote not sent',
        isLikelyConnectivityIssue(e)
          ? 'Connection looks weak. We could not send this quote yet. Your draft stayed here, so retry when the signal improves.'
          : e instanceof Error && e.message
            ? e.message
            : 'Could not send this quote right now. Please try again in a moment.'
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
      onRequestClose={() => {
        void saveAndReturn()
      }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                void saveAndReturn()
              }}
              disabled={sending || draftSaving}
              accessibilityRole="button"
              accessibilityLabel="Save quote draft and return to order"
            >
              <Text style={styles.modalClose}>{draftSaving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {mode === 'revise' ? 'Revise quote' : 'Send quote'}
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={[styles.modalContent, styles.quoteModalContent]}
            {...quoteDockScroll}
          >
            {draftStatus ? (
              <Text style={styles.quoteDraftStatus} accessibilityLiveRegion="polite">
                {draftStatus}
              </Text>
            ) : null}
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Quote currency</Text>
              <Text style={styles.supportHint}>
                This order is locked to {currencyLabel} so payment, escrow, and payout stay in the
                same currency. To use another currency, update your payout and pricing setup before
                accepting new orders.
              </Text>
            </View>
            {fundedFabricQuote ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Seller amount breakdown</Text>
                <Text style={styles.supportHint}>
                  Keep tailoring and fabric separate so the customer knows what is protected for
                  each purpose.
                </Text>
                <MoneyInput
                  label="Tailoring and construction"
                  value={tailoringAmount}
                  onChangeText={setTailoringAmount}
                  currency={defaultCurrency as AccountCurrencyCode}
                  required
                  testID="quote-tailoring-input"
                />
                {tailorSourcesFabric ? (
                  <>
                    <MoneyInput
                      label="Fabric allowance"
                      value={fabricAllowanceAmount}
                      onChangeText={setFabricAllowanceAmount}
                      currency={defaultCurrency as AccountCurrencyCode}
                      required
                      hint="Held for approved, evidenced fabric costs. Any unused amount returns to the customer."
                      testID="quote-fabric-allowance-input"
                    />
                    <Text style={styles.supportCardTitle}>Allowance covers</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {[
                        ['FABRIC', 'Fabric'],
                        ['LINING', 'Lining'],
                        ['EMBROIDERY', 'Embroidery'],
                        ['TRIMS', 'Trims'],
                        ['NOTIONS', 'Notions'],
                        ['OTHER_AGREED_MATERIAL', 'Other agreed material'],
                      ].map(([code, label]) => {
                        const selected = fabricCoverage.includes(code)
                        return (
                          <TouchableOpacity
                            key={code}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected }}
                            onPress={() =>
                              setFabricCoverage((current) =>
                                selected
                                  ? current.filter((item) => item !== code)
                                  : [...current, code]
                              )
                            }
                            style={[
                              styles.quoteCoverageChip,
                              selected && styles.quoteCoverageChipSelected,
                            ]}
                          >
                            <Text
                              style={[
                                styles.quoteCoverageText,
                                selected && styles.quoteCoverageTextSelected,
                              ]}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                    <Input
                      label="Sourcing assumptions"
                      placeholder="Quantity, quality, supplier estimate, lining or trim assumptions..."
                      value={fabricAssumptions}
                      onChangeText={setFabricAssumptions}
                      multiline
                      numberOfLines={4}
                      maxLength={1200}
                      required
                    />
                  </>
                ) : (
                  <Text style={styles.supportHint}>
                    Customer supplies fabric, so this quote reserves no fabric allowance.
                  </Text>
                )}
                <View style={styles.quoteTotalRow}>
                  <Text style={styles.supportCardTitle}>Seller subtotal</Text>
                  <Text style={styles.quoteTotalValue}>
                    {formatAmount(
                      (parseMoneyInputToMinorUnits(tailoringAmount) ?? 0) +
                        (tailorSourcesFabric
                          ? (parseMoneyInputToMinorUnits(fabricAllowanceAmount) ?? 0)
                          : 0),
                      defaultCurrency,
                      defaultCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  </Text>
                </View>
              </View>
            ) : (
              <MoneyInput
                label="Your price"
                value={amount}
                onChangeText={setAmount}
                currency={defaultCurrency as AccountCurrencyCode}
                required
                hint={
                  deliveryMethod === 'LOCAL_COLLECTION'
                    ? 'Enter the full quote the customer should pay.'
                    : 'Enter your base quote. Drapeon adds the standard dispatch fee automatically based on the customer address and your location.'
                }
                testID="quote-amount-input"
              />
            )}
            {deliveryMethod !== 'LOCAL_COLLECTION' ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Drapeon-managed dispatch</Text>
                <Text style={styles.supportHint}>
                  Standard {deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} is
                  collected at checkout as a Drapeon fee. If a carrier surcharge, customs charge, or
                  import duty appears later, Drapeon will handle approval with the customer before
                  dispatch.
                </Text>
              </View>
            ) : null}
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Quote breakdown</Text>
              <Text style={styles.supportHint}>
                Add a clean breakdown when you want the customer to understand what is driving this
                price before they pay.
              </Text>
              <MoneyInput
                label="Labour (optional)"
                value={laborAmount}
                onChangeText={setLaborAmount}
                currency={defaultCurrency as AccountCurrencyCode}
              />
              <MoneyInput
                label="Sourcing (optional)"
                value={sourcingAmount}
                onChangeText={setSourcingAmount}
                currency={defaultCurrency as AccountCurrencyCode}
                hint="Useful when the quote includes fabric, trims, or accessory sourcing."
              />
              <MoneyInput
                label="Rush fee (optional)"
                value={rushAmount}
                onChangeText={setRushAmount}
                currency={defaultCurrency as AccountCurrencyCode}
              />
              <Input
                label="What's included? (optional)"
                placeholder="One per line or comma separated. e.g. pattern drafting, lining, basic alterations"
                value={includedText}
                onChangeText={setIncludedText}
                multiline
                numberOfLines={3}
                maxLength={240}
              />
              <Input
                label="What's not included? (optional)"
                placeholder="One per line or comma separated. e.g. extra fabric changes, rush remake after approval"
                value={excludedText}
                onChangeText={setExcludedText}
                multiline
                numberOfLines={3}
                maxLength={240}
              />
              <Input
                label="Short pricing summary (optional)"
                placeholder="e.g. Includes sourcing and construction for one fitted two-piece set."
                value={breakdownSummary}
                onChangeText={setBreakdownSummary}
                multiline
                numberOfLines={3}
                maxLength={300}
                filterContact
              />
            </View>
            <Input
              label="Estimated completion date"
              placeholder="Select a date"
              value={effectiveCompletionDate}
              onPressIn={openCompletionDatePicker}
              showSoftInputOnFocus={false}
              required
              hint={
                customerDeadline
                  ? `Must be on or before ${new Date(customerDeadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                  : 'The date you expect to finish. Customer has 48h to accept.'
              }
              testID="quote-completion-date-input"
            />
            {showDatePicker && (
              <DateTimePicker
                value={completionDateValue ?? defaultCompletionDateValue()}
                mode="date"
                minimumDate={new Date()}
                maximumDate={customerDeadline ? new Date(customerDeadline) : undefined}
                onChange={(_, date) => {
                  setShowDatePicker(false)
                  if (!date) return
                  setCompletionDateValue(date)
                  setCompletionDate(formatDateInput(date))
                }}
              />
            )}
            <Input
              label="Note to customer (optional)"
              placeholder="Any context about your pricing or timeline..."
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
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{ checked: orderReviewAcknowledged }}
              accessibilityLabel={QUOTE_ORDER_REVIEW_COPY}
              onPress={() => setOrderReviewAcknowledged((current) => !current)}
              style={[
                styles.quoteReviewRow,
                orderReviewAcknowledged && styles.quoteReviewRowChecked,
              ]}
              testID="quote-order-review-checkbox"
            >
              <View
                style={[
                  styles.quoteReviewCheck,
                  orderReviewAcknowledged && styles.quoteReviewCheckChecked,
                ]}
              >
                {orderReviewAcknowledged ? (
                  <Feather name="check" size={15} color={Colors.textInverse} />
                ) : null}
              </View>
              <Text style={styles.quoteReviewCopy}>{QUOTE_ORDER_REVIEW_COPY}</Text>
            </TouchableOpacity>
            {quoteBlockedReason ? (
              <Text style={styles.modalFooterGuidance} accessibilityLiveRegion="polite">
                {quoteBlockedReason}
              </Text>
            ) : null}
          </ScrollView>
          <DrapeFloatingActionDock compactWidth={76} testID="tailor-quote-action-dock">
            {(compact) =>
              compact ? (
                <DrapeIconButton
                  icon="send"
                  accessibilityLabel={mode === 'revise' ? 'Send revised quote' : 'Send quote'}
                  tone="primary"
                  onPress={send}
                  disabled={quoteSubmitDisabled}
                  testID={
                    mode === 'revise'
                      ? 'tailor-send-revised-quote-btn'
                      : 'tailor-send-quote-submit-btn'
                  }
                />
              ) : (
                <DrapeCapsuleButton
                  label={mode === 'revise' ? 'Send revised quote' : 'Send quote'}
                  icon="send"
                  onPress={send}
                  loading={sending}
                  disabled={quoteSubmitDisabled}
                  style={styles.quoteActionDockPrimary}
                  testID={
                    mode === 'revise'
                      ? 'tailor-send-revised-quote-btn'
                      : 'tailor-send-quote-submit-btn'
                  }
                />
              )
            }
          </DrapeFloatingActionDock>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ─── Stage Update Modal ───────────────────────────────────────────────────────
