'use client'

import {
  CALL_SCHEDULING_POLICY,
  getCallLifecycleState,
  isCallSchedulingStartValid,
  MEDIA_LIMITS_BYTES,
  recommendedSchedulingStartDate,
  voiceRecordingErrorMessage,
} from '@drape/shared'
import { friendlyActionError } from '@drape/shared/action-errors'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { LoaderCircle, Mic, Paperclip, Phone, Send, Square, Video, X } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAccountContext } from '../../../components/account-context'
import { Button } from '../../../components/ui/button'
import { IconButton } from '../../../components/ui/icon-button'
import { Textarea } from '../../../components/ui/textarea'
import { createClient } from '../../../lib/supabase'
import type {
  AccountMessage,
  AccountOrder,
  ConsultationBookingSnapshot,
} from '../shared/account-data-contracts'
import { invokeAccountFunction, isTerminalOrder } from '../shared/account-data-queries'
import type { WebCallLifecycleEvent } from './message-foundation'
import {
  accountRoute,
  ActionNotice,
  assertNoContactLeak,
  CallLifecycleEventCard,
  canStartOrderCall,
  cleanLabel,
  datetimeLocalToIso,
  dateToDatetimeLocal,
  DisclosurePanel,
  extensionBackedMediaContentType,
  firstJoinedRow,
  formatDateTime,
  isVideoContentType,
  MediaViewerOverlay,
  MESSAGE_MEDIA_CONTENT_TYPES,
  ORDER_CALL_STAGES,
  prepareMessageMediaFile,
  recordedAudioDurationSeconds,
  supportMetaWithConsultationBooking,
  uploadPrivateFile,
  voicePlaybackMimeType,
} from './message-foundation'

export function MessageComposer({
  order,
  consultationBooking,
  onRefresh,
  channelRef,
  replyingTo,
  onClearReply,
  editingMessage,
  onClearEdit,
}: {
  order: AccountOrder
  consultationBooking?: ConsultationBookingSnapshot | null
  onRefresh: () => void
  channelRef?: React.RefObject<RealtimeChannel | null>
  replyingTo?: AccountMessage | null
  onClearReply?: () => void
  editingMessage?: AccountMessage | null
  onClearEdit?: () => void
}) {
  const account = useAccountContext()
  const [body, setBody] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [callBusy, setCallBusy] = useState<string | null>(null)
  const [callTime, setCallTime] = useState('')
  const [callReason, setCallReason] = useState('OTHER')
  const [consultationTime, setConsultationTime] = useState('')
  const [consultationNote, setConsultationNote] = useState('')
  const [scheduleSuggestion, setScheduleSuggestion] = useState<{
    kind: 'call' | 'consultation'
    value: string
    label: string
  } | null>(null)
  const publishedConsultationCallType =
    firstJoinedRow(order.tailor_profiles)?.consultation_call_type ?? 'VIDEO'
  const [consultationCallType, setConsultationCallType] = useState<'AUDIO' | 'VIDEO'>(
    publishedConsultationCallType === 'AUDIO' ? 'AUDIO' : 'VIDEO'
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const readyMadeCallTimeInputRef = useRef<HTMLInputElement | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [webRecording, setWebRecording] = useState(false)
  const [webRecordingSeconds, setWebRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const webRecordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const webStreamRef = useRef<MediaStream | null>(null)
  const webRecordingStartingRef = useRef(false)
  const webRecordingStoppingRef = useRef(false)
  const webRecordingFinalizingRef = useRef(false)
  const webRecordingCancelledRef = useRef(false)
  const webRecordingSecondsRef = useRef(0)
  const canMessage = !isTerminalOrder(order)
  const isReadyMade = order.order_kind === 'READY_MADE'

  // Pre-populate body when entering edit mode
  const prevEditingIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (editingMessage && editingMessage.id !== prevEditingIdRef.current) {
      setBody(editingMessage.body ?? '')
    }
    prevEditingIdRef.current = editingMessage?.id ?? null
  }, [editingMessage])

  useEffect(
    () => () => {
      if (webRecordTimerRef.current) clearInterval(webRecordTimerRef.current)
      const recorder = mediaRecorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // The browser already released this recorder.
          }
        }
      }
      webStreamRef.current?.getTracks().forEach((track) => track.stop())
    },
    []
  )

  const photoPreviewUrl = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : null),
    [photoFile]
  )
  useEffect(
    () => () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl)
    },
    [photoPreviewUrl]
  )

  function broadcastTyping(isTyping: boolean) {
    const channel = channelRef?.current ?? null
    if (!channel || !account.userId) return
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: account.userId, isTyping },
    })
  }
  const isCustomOrder = order.order_kind === 'CUSTOM' || !order.order_kind
  const supportMeta = useMemo(
    () => supportMetaWithConsultationBooking(order.special_note, consultationBooking),
    [consultationBooking, order.special_note]
  )
  const consultationMeta = supportMeta.consultation ?? null
  const orderCallMeta = supportMeta.orderCall ?? null
  const viewerIsCustomer = order.customer_id === account.userId
  const hasConfirmedConsultationBooking = Boolean(
    consultationBooking?.status === 'CONFIRMED' && consultationBooking.scheduled_start_at
  )
  const consultationPaymentRequired =
    !!consultationMeta?.feeAmount &&
    consultationMeta.status !== 'REQUESTED' &&
    consultationMeta.status !== 'DECLINED' &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS'
  const consultationPaymentPaid = consultationPaymentRequired && !!consultationMeta?.paidAt
  const consultationPaymentBlocked = consultationPaymentRequired && !consultationPaymentPaid
  const consultationRescheduleRequired = false
  const canRequestConsultation =
    isCustomOrder &&
    viewerIsCustomer &&
    order.stage === 'PENDING_QUOTE' &&
    !hasConfirmedConsultationBooking
  const canScheduleOrderCall = ORDER_CALL_STAGES.has(order.stage ?? '')
  const consultationLifecycle = getCallLifecycleState(consultationMeta?.scheduledStartAt)
  const orderCallLifecycle = getCallLifecycleState(orderCallMeta?.scheduledStartAt)
  const canShowCallButtons =
    canStartOrderCall(order) &&
    (consultationLifecycle.status === 'active' || orderCallLifecycle.status === 'active')
  const consultationLabel =
    consultationLifecycle.status === 'expired'
      ? null
      : formatDateTime(
          consultationMeta?.scheduledStartAt ?? consultationMeta?.proposedStartAt,
          consultationMeta?.timezone
        )
  const readyMadeCallLabel =
    orderCallLifecycle.status === 'expired'
      ? null
      : formatDateTime(orderCallMeta?.scheduledStartAt, orderCallMeta?.timezone)

  const callLifecycleEvent: WebCallLifecycleEvent | null =
    (order.stage === 'CONSULTATION' || hasConfirmedConsultationBooking) &&
    !consultationRescheduleRequired &&
    consultationMeta?.status === 'SCHEDULED' &&
    consultationMeta.scheduledStartAt &&
    getCallLifecycleState(consultationMeta.scheduledStartAt).status !== 'expired'
      ? {
          kind: 'consultation',
          scheduledStartAt: consultationMeta.scheduledStartAt,
          timezone: consultationMeta.timezone,
          status: consultationMeta.status,
          paymentRequired: consultationPaymentRequired,
          paymentPaid: consultationPaymentPaid,
          actionLoading: !!callBusy,
          callType: consultationMeta.callType === 'AUDIO' ? 'audio' : 'video',
          joinHref: accountRoute(
            `/account/call-join?orderId=${encodeURIComponent(order.id)}&callKind=consultation&callType=${consultationMeta.callType === 'AUDIO' ? 'audio' : 'video'}`
          ),
          onJoinVideo: () => {
            void startCall(consultationMeta.callType === 'AUDIO' ? 'audio' : 'video')
          },
          rescheduleHref: accountRoute(`/account/messages?orderId=${encodeURIComponent(order.id)}`),
          rescheduleLabel: viewerIsCustomer ? 'Message tailor' : 'Message customer',
          paymentHref: viewerIsCustomer
            ? accountRoute(`/account/checkout/${order.id}`)
            : accountRoute(`/account/orders/${order.id}`),
          paymentActionLabel: viewerIsCustomer ? 'Pay now' : 'View order',
        }
      : isReadyMade &&
          orderCallMeta?.status === 'SCHEDULED' &&
          orderCallMeta.scheduledStartAt &&
          orderCallLifecycle.status !== 'expired'
        ? {
            kind: 'ready-made',
            scheduledStartAt: orderCallMeta.scheduledStartAt,
            timezone: orderCallMeta.timezone,
            status: orderCallMeta.status,
            reason: orderCallMeta.reason,
            actionLoading: !!callBusy,
            onJoinVideo: () => {
              void startCall('video')
            },
            onReschedule: () => {
              setError('Choose a new time below and tap Schedule.')
              readyMadeCallTimeInputRef.current?.focus()
              const picker = readyMadeCallTimeInputRef.current as
                | (HTMLInputElement & { showPicker?: () => void })
                | null
              picker?.showPicker?.()
            },
            rescheduleLabel: 'Reschedule',
          }
        : null

  async function sendMessage() {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    broadcastTyping(false)
    const trimmed = body.trim()
    setError(null)
    setSuccess(null)
    setUploadStatus(null)

    // Edit mode: update existing message body
    if (editingMessage) {
      if (!trimmed) {
        setError('Message cannot be empty.')
        return
      }
      const leak = assertNoContactLeak(trimmed)
      if (leak) {
        setError(leak)
        return
      }
      setBusy(true)
      try {
        await invokeAccountFunction('message-action', {
          action: 'edit',
          messageId: editingMessage.id,
          body: trimmed,
        })
        setBody('')
        onClearEdit?.()
        onRefresh()
      } catch (editError) {
        setError(friendlyActionError(editError, 'Could not edit this message. Please try again.'))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!trimmed && !photoFile) {
      setError('Write a message or attach media before sending.')
      return
    }
    if (trimmed) {
      const leak = assertNoContactLeak(trimmed)
      if (leak) {
        setError(leak)
        return
      }
    }
    setBusy(true)
    try {
      if (photoFile) {
        setUploadStatus('Preparing media...')
        const preparedPhoto = await prepareMessageMediaFile(photoFile)
        setUploadStatus('Uploading...')
        const storagePath = await uploadPrivateFile(
          'message-media',
          `messages/${order.id}`,
          preparedPhoto
        )
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'PHOTO',
          photoUrl: storagePath,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
      }
      if (trimmed) {
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'TEXT',
          body: trimmed,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        })
      }
      setBody('')
      setPhotoFile(null)
      setPhotoPreviewOpen(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
      onClearReply?.()
      setSuccess(
        photoFile && trimmed
          ? 'Media and message sent inside the protected order thread.'
          : photoFile
            ? 'Media sent inside the protected order thread.'
            : 'Message sent inside the protected order thread.'
      )
      onRefresh()
    } catch (messageError) {
      setError(
        friendlyActionError(
          messageError,
          'Message could not send. Please try again with smaller media or text only.'
        )
      )
    } finally {
      setBusy(false)
      setUploadStatus(null)
    }
  }

  async function scheduleReadyMadeCall() {
    const scheduledStartAt = datetimeLocalToIso(callTime)
    setError(null)
    setSuccess(null)
    if (!canScheduleOrderCall) {
      setError(
        order.stage === 'PENDING_QUOTE'
          ? 'Keep using Messages while the tailor reviews the brief. Scheduled calls unlock after the quote is sent.'
          : 'Scheduled calls are unavailable for this order right now.'
      )
      return
    }
    if (!scheduledStartAt) {
      setError('Choose a valid call time.')
      return
    }
    if (!isCallSchedulingStartValid(scheduledStartAt)) {
      const suggestion = recommendedSchedulingStartDate()
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setScheduleSuggestion({ kind: 'call', value: dateToDatetimeLocal(suggestion), label })
      setError(`That call time is too soon. The nearest valid option is ${label}.`)
      return
    }
    setScheduleSuggestion(null)
    setCallBusy('schedule')
    try {
      await invokeAccountFunction('order-call-action', {
        action: isReadyMade ? 'schedule-ready-made-call' : 'schedule-order-call',
        orderId: order.id,
        scheduledStartAt,
        callType: consultationCallType,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reason: callReason,
      })
      setSuccess(
        'Order call scheduled. Both people were notified, and the call will open near the selected time.'
      )
      onRefresh()
    } catch (callError) {
      setError(friendlyActionError(callError, 'Call could not be scheduled. Please try again.'))
    } finally {
      setCallBusy(null)
    }
  }

  async function requestConsultation() {
    const scheduledStartAt = datetimeLocalToIso(consultationTime)
    const note = consultationNote.trim()
    const leak = assertNoContactLeak(note, "Consultation notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!scheduledStartAt) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setScheduleSuggestion({
        kind: 'consultation',
        value: dateToDatetimeLocal(suggestion),
        label,
      })
      setError('Choose a valid consultation time, or use the nearest available option below.')
      return
    }
    if (new Date(scheduledStartAt).getTime() < Date.now() + 120 * 60_000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setScheduleSuggestion({ kind: 'consultation', value: dateToDatetimeLocal(suggestion), label })
      setError(`That consultation time is too soon. The nearest valid option is ${label}.`)
      return
    }
    setScheduleSuggestion(null)
    if (leak) {
      setError(leak)
      return
    }
    setCallBusy('consultation')
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'request-consultation',
        orderId: order.id,
        scheduledStartAt,
        callType: consultationCallType,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        note: note || undefined,
      })
      setConsultationTime('')
      setConsultationNote('')
      setSuccess(
        'Consultation request sent. The tailor can approve, reschedule, price, or decline it from their order view.'
      )
      onRefresh()
    } catch (consultationError) {
      setError(
        friendlyActionError(
          consultationError,
          'Consultation could not be requested. Choose another time and try again.'
        )
      )
    } finally {
      setCallBusy(null)
    }
  }

  async function startCall(callType: 'audio' | 'video') {
    setError(null)
    setSuccess(null)
    if (!canStartOrderCall(order)) {
      setError(
        order.stage === 'PENDING_QUOTE'
          ? 'Request a consultation before starting a call on this custom order.'
          : 'Calls open after payment is confirmed while the order is active.'
      )
      return
    }
    if (isReadyMade && orderCallMeta?.status !== 'SCHEDULED') {
      setError('Schedule this ready-made call first so both sides know when to join.')
      return
    }
    if (consultationPaymentBlocked) {
      setError('Consultation fee required before the room can open')
      return
    }
    setCallBusy(callType)
    try {
      const functionName =
        order.stage === 'CONSULTATION' ? 'create-consultation-room' : 'create-order-call-room'
      const enforcedCallType =
        order.stage === 'CONSULTATION'
          ? consultationMeta?.callType === 'AUDIO'
            ? 'audio'
            : 'video'
          : callType
      const result = await invokeAccountFunction<{
        url?: string | null
        fallback?: string
        message?: string
      }>(functionName, {
        orderId: order.id,
        callType: enforcedCallType,
      })
      onRefresh()
      if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer')
        setSuccess(
          order.stage === 'CONSULTATION'
            ? `Consultation ${enforcedCallType} opened in a new tab.`
            : `Drapeon ${enforcedCallType} call opened in a new tab.`
        )
        return
      }
      setError(
        result.message ??
          'Calling is unavailable right now. Continue in Messages so the order record stays protected.'
      )
    } catch (callError) {
      setError(
        friendlyActionError(
          callError,
          'Call could not start right now. Keep the conversation in Messages.'
        )
      )
    } finally {
      setCallBusy(null)
    }
  }

  function stopWebRecordingTimer() {
    if (webRecordTimerRef.current) {
      clearInterval(webRecordTimerRef.current)
      webRecordTimerRef.current = null
    }
  }

  function cancelWebRecording() {
    webRecordingCancelledRef.current = true
    stopWebRecordingTimer()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive' && !webRecordingStoppingRef.current) {
      webRecordingStoppingRef.current = true
      recorder.stop()
      return
    }

    audioChunksRef.current = []
    webStreamRef.current?.getTracks().forEach((track) => track.stop())
    webStreamRef.current = null
    mediaRecorderRef.current = null
    webRecordingStoppingRef.current = false
    webRecordingCancelledRef.current = false
    webRecordingSecondsRef.current = 0
    setWebRecording(false)
    setWebRecordingSeconds(0)
  }

  async function startWebRecording() {
    if (
      busy ||
      webRecordingStartingRef.current ||
      webRecordingStoppingRef.current ||
      webRecordingFinalizingRef.current ||
      mediaRecorderRef.current
    )
      return

    setError(null)
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError('Voice recording requires a secure browser connection with microphone support.')
      return
    }

    webRecordingStartingRef.current = true
    webRecordingCancelledRef.current = false
    webRecordingSecondsRef.current = 0
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      webStreamRef.current = stream
      audioChunksRef.current = []
      const mimeType =
        ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'].find((candidate) =>
          MediaRecorder.isTypeSupported(candidate)
        ) ?? null
      if (!mimeType) throw new Error('CROSS_PLATFORM_VOICE_UNSUPPORTED')

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onerror = () => {
        webRecordingCancelledRef.current = true
        setError('Voice recording stopped unexpectedly. Please try again.')
      }
      recorder.onstop = () => {
        const wasCancelled = webRecordingCancelledRef.current
        const durationSeconds = webRecordingSecondsRef.current
        stopWebRecordingTimer()
        webStreamRef.current?.getTracks().forEach((track) => track.stop())
        webStreamRef.current = null
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null
        setWebRecording(false)
        setWebRecordingSeconds(0)

        if (wasCancelled) {
          audioChunksRef.current = []
          webRecordingStoppingRef.current = false
          webRecordingCancelledRef.current = false
          webRecordingSecondsRef.current = 0
          return
        }

        void finaliseWebRecording(recorder.mimeType, durationSeconds)
      }
      recorder.start()
      setWebRecording(true)
      setWebRecordingSeconds(0)
      webRecordTimerRef.current = setInterval(() => {
        webRecordingSecondsRef.current += 1
        setWebRecordingSeconds(webRecordingSecondsRef.current)
        if (webRecordingSecondsRef.current >= 60) {
          stopWebRecording()
        }
      }, 1000)
    } catch (recordingError) {
      stopWebRecordingTimer()
      stream?.getTracks().forEach((track) => track.stop())
      webStreamRef.current = null
      mediaRecorderRef.current = null
      audioChunksRef.current = []
      setWebRecording(false)
      setWebRecordingSeconds(0)

      setError(voiceRecordingErrorMessage(recordingError))
    } finally {
      webRecordingStartingRef.current = false
    }
  }

  async function finaliseWebRecording(mimeType: string, recordedSeconds: number) {
    if (webRecordingFinalizingRef.current) return
    webRecordingFinalizingRef.current = true
    try {
      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      if (chunks.length === 0) return

      const storageContentType = voicePlaybackMimeType(null, mimeType)
      const blob = new Blob(chunks, { type: storageContentType })
      if (blob.size > MEDIA_LIMITS_BYTES.voiceNote) {
        setError('Voice note too large. Keep recordings under 25 MB.')
        return
      }

      const ext = storageContentType === 'audio/mp4' ? 'm4a' : 'aac'
      const filename = `messages/${order.id}/${Date.now()}.${ext}`
      const durationSeconds = await recordedAudioDurationSeconds(blob, recordedSeconds)
      setBusy(true)
      setUploadStatus('Uploading voice note...')
      try {
        const supabase = createClient()
        const { error: uploadError } = await supabase.storage
          .from('message-media')
          .upload(filename, blob, { contentType: storageContentType, upsert: false })
        if (uploadError) throw uploadError
        await invokeAccountFunction('message-action', {
          action: 'send-message',
          orderId: order.id,
          type: 'VOICE',
          voiceUrl: filename,
          voiceDuration: durationSeconds,
        })
        setSuccess('Voice note sent inside the protected order thread.')
        onRefresh()
      } catch (voiceError) {
        setError(friendlyActionError(voiceError, 'Voice note could not send. Please try again.'))
      } finally {
        setBusy(false)
        setUploadStatus(null)
      }
    } finally {
      webRecordingFinalizingRef.current = false
      webRecordingStoppingRef.current = false
      webRecordingCancelledRef.current = false
      webRecordingSecondsRef.current = 0
    }
  }

  function stopWebRecording() {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive' || webRecordingStoppingRef.current) return
    webRecordingStoppingRef.current = true
    try {
      recorder.stop()
    } catch {
      webRecordingStoppingRef.current = false
      setError('Voice recording could not stop cleanly. Please try again.')
    }
  }

  function formatWebDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (!canMessage) {
    return (
      <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is closed, so the web thread is read-only.
      </p>
    )
  }

  return (
    <div className="grid min-w-0 gap-0 overflow-hidden">
      <ActionNotice error={error} success={success} />
      {callLifecycleEvent ? <CallLifecycleEventCard event={callLifecycleEvent} compact /> : null}

      {/* Toolbar — always visible */}
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 pb-2">
        {/* Hidden file input */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="hidden"
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null
            setError(null)
            setPhotoFile(nextFile)
            if (!nextFile) setPhotoPreviewOpen(false)
          }}
          disabled={busy}
        />
        <IconButton
          title="Attach media"
          label="Attach media"
          onClick={() => photoInputRef.current?.click()}
          disabled={busy || webRecording}
          variant={photoFile ? 'secondary' : 'ghost'}
          size="icon-sm"
        >
          <Paperclip className="size-4.5" />
        </IconButton>
        {/* Voice note */}
        {webRecording ? (
          <>
            <span className="ml-1 min-w-[2.5rem] text-xs font-semibold tabular-nums text-needle">
              {formatWebDuration(webRecordingSeconds)}
            </span>
            <IconButton
              title="Send voice note"
              label="Send voice note"
              onClick={() => {
                void stopWebRecording()
              }}
              variant="secondary"
              size="icon-sm"
            >
              <Square className="size-4 fill-current" />
            </IconButton>
            <IconButton
              title="Cancel recording"
              label="Cancel recording"
              onClick={cancelWebRecording}
              variant="destructive"
              size="icon-sm"
            >
              <X className="size-4" />
            </IconButton>
          </>
        ) : (
          <IconButton
            title="Record voice note"
            label="Record voice note"
            onClick={() => {
              void startWebRecording()
            }}
            disabled={busy}
            variant="ghost"
            size="icon-sm"
          >
            <Mic className="size-4.5" />
          </IconButton>
        )}
        {canShowCallButtons && order.stage !== 'CONSULTATION' ? (
          <>
            <IconButton
              title="Audio call"
              label="Start audio call"
              onClick={() => {
                void startCall('audio')
              }}
              disabled={!!callBusy || consultationPaymentBlocked}
              variant="ghost"
              size="icon-sm"
            >
              {callBusy === 'audio' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Phone className="size-4.5" />
              )}
            </IconButton>
            <IconButton
              title="Video call"
              label="Start video call"
              onClick={() => {
                void startCall('video')
              }}
              disabled={!!callBusy || consultationPaymentBlocked}
              variant="ghost"
              size="icon-sm"
            >
              {callBusy === 'video' ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Video className="size-4.5" />
              )}
            </IconButton>
          </>
        ) : null}
        {uploadStatus ? (
          <span className="ml-1 text-xs font-semibold text-needle">{uploadStatus}</span>
        ) : null}
        {consultationLabel && !callLifecycleEvent ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">
            Consultation: {consultationLabel}
          </span>
        ) : readyMadeCallLabel ? (
          <span className="ml-auto hidden text-xs text-ink/44 sm:inline">
            Call: {readyMadeCallLabel}
          </span>
        ) : null}
      </div>

      {consultationPaymentBlocked && !callLifecycleEvent ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-rust/16 bg-rust/8 px-3 py-2 text-xs leading-5 text-rust">
          <span className="font-semibold">Consultation fee required before the room can open</span>
          <Link
            href={
              viewerIsCustomer
                ? accountRoute(`/account/checkout/${order.id}`)
                : accountRoute(`/account/orders/${order.id}`)
            }
            className="font-semibold text-needle"
          >
            {viewerIsCustomer ? 'Pay now' : 'View order'}
          </Link>
        </div>
      ) : null}

      {/* Media preview */}
      {photoFile ? (
        <div className="mb-2 flex min-w-0 items-center gap-3 rounded-lg border border-needle/15 bg-needle/6 p-2 text-xs text-needle">
          <button
            type="button"
            onClick={() => setPhotoPreviewOpen(true)}
            className="relative block h-20 w-24 shrink-0 overflow-hidden rounded-[8px] bg-ink/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
            aria-label={`Expand ${photoFile.name}`}
          >
            {photoPreviewUrl ? (
              isVideoContentType(
                extensionBackedMediaContentType(photoFile, MESSAGE_MEDIA_CONTENT_TYPES)
              ) ? (
                <video
                  src={photoPreviewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={photoPreviewUrl}
                  alt="Selected message attachment"
                  className="h-full w-full object-cover"
                />
              )
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{photoFile.name}</p>
            <button
              type="button"
              onClick={() => setPhotoPreviewOpen(true)}
              className="mt-1 font-semibold text-needle underline decoration-needle/30 underline-offset-2"
            >
              Preview
            </button>
          </div>
          <Button
            type="button"
            onClick={() => {
              setPhotoFile(null)
              setPhotoPreviewOpen(false)
              if (photoInputRef.current) photoInputRef.current.value = ''
            }}
            variant="ghost"
            size="sm"
            className="shrink-0 text-rust hover:text-rust"
          >
            Remove
          </Button>
        </div>
      ) : null}
      {photoFile && photoPreviewUrl && photoPreviewOpen ? (
        <MediaViewerOverlay
          src={photoPreviewUrl}
          label={photoFile.name}
          video={isVideoContentType(
            extensionBackedMediaContentType(photoFile, MESSAGE_MEDIA_CONTENT_TYPES)
          )}
          onClose={() => setPhotoPreviewOpen(false)}
        />
      ) : null}

      {/* Textarea + send */}
      <div className="flex items-end gap-2 rounded-lg border border-ui-border bg-white p-2 shadow-sm focus-within:border-needle/45 focus-within:ring-2 focus-within:ring-needle/10">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Reply</span>
          <Textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              broadcastTyping(true)
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
              typingTimerRef.current = setTimeout(() => broadcastTyping(false), 2000)
            }}
            rows={2}
            maxLength={2000}
            className="max-h-36 min-h-11 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
            placeholder="Message..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />
        </label>
        <Button
          type="button"
          onClick={() => {
            void sendMessage()
          }}
          disabled={busy || webRecording}
          size="icon"
          className="mb-0.5 shrink-0 rounded-lg"
          aria-label={busy ? 'Sending message' : 'Send message'}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4.5" />}
        </Button>
      </div>

      {canRequestConsultation ? (
        <DisclosurePanel
          title="Request consultation"
          summary={
            consultationTime ? 'Consultation time set' : 'Ask the tailor to meet before quoting.'
          }
        >
          <div className="grid gap-3">
            {publishedConsultationCallType === 'AUDIO_OR_VIDEO' ? (
              <fieldset className="grid gap-2">
                <legend className="text-xs font-semibold text-ink">Call type</legend>
                <div className="flex gap-2">
                  {(['AUDIO', 'VIDEO'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={consultationCallType === value}
                      onClick={() => setConsultationCallType(value)}
                      className={`rounded-[8px] border px-4 py-2 text-sm font-semibold ${consultationCallType === value ? 'border-needle bg-needle/8 text-needle' : 'border-ink/10 bg-white text-ink'}`}
                    >
                      {value === 'AUDIO' ? 'Audio' : 'Video'}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="text-sm font-semibold text-ink">
                {consultationCallType === 'AUDIO' ? 'Audio consultation' : 'Video consultation'}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-ink">Preferred date &amp; time</span>
                <input
                  type="datetime-local"
                  value={consultationTime}
                  min={dateToDatetimeLocal(
                    recommendedSchedulingStartDate({ minLookaheadMinutes: 120 })
                  )}
                  onChange={(event) => {
                    setConsultationTime(event.target.value)
                    setScheduleSuggestion(null)
                  }}
                  className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  void requestConsultation()
                }}
                disabled={!!callBusy}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {callBusy === 'consultation' ? 'Sending...' : 'Request'}
              </button>
            </div>
            {scheduleSuggestion?.kind === 'consultation' ? (
              <button
                type="button"
                onClick={() => {
                  setConsultationTime(scheduleSuggestion.value)
                  setScheduleSuggestion(null)
                  setError(null)
                }}
                className="w-fit rounded-[8px] border border-needle/20 bg-needle/8 px-3 py-2 text-sm font-semibold text-needle"
              >
                Use {scheduleSuggestion.label}
              </button>
            ) : null}
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="Optional note about fit, fabric, event timing, or questions."
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
            />
            <p className="text-xs leading-5 text-ink/48">
              The tailor has 48 hours to approve, reschedule, or decline. Any fee is shown before
              payment.
            </p>
          </div>
        </DisclosurePanel>
      ) : consultationMeta && !callLifecycleEvent && consultationLifecycle.status !== 'expired' ? (
        <div className="mt-3 rounded-[8px] border border-needle/12 bg-needle/6 px-3 py-2 text-xs leading-5 text-needle">
          {consultationMeta.status === 'REQUESTED'
            ? `Consultation requested${consultationLabel ? ` for ${consultationLabel}` : ''}.${consultationMeta.requestExpiresAt ? ` Respond by ${formatDateTime(consultationMeta.requestExpiresAt, consultationMeta.timezone)}.` : ' The tailor has 48 hours to respond.'}`
            : consultationMeta.status === 'SCHEDULED'
              ? `Consultation scheduled${consultationLabel ? ` for ${consultationLabel}` : ''}. Use the call buttons near the scheduled time.`
              : `Consultation ${cleanLabel(consultationMeta.status, 'requested').toLowerCase()}${consultationLabel ? ` for ${consultationLabel}` : ''}.`}
        </div>
      ) : null}

      {/* Ready-made call schedule */}
      {canScheduleOrderCall ? (
        <DisclosurePanel
          title="Schedule call"
          summary={
            readyMadeCallLabel
              ? `Scheduled ${readyMadeCallLabel}`
              : callTime
                ? 'Call time set'
                : 'Use a call for active-order pickup, delivery, sizing, or item-condition clarity.'
          }
        >
          <div className="grid gap-3 md:grid-cols-[1fr_0.8fr_auto] md:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Date &amp; time</span>
              <input
                ref={readyMadeCallTimeInputRef}
                type="datetime-local"
                value={callTime}
                min={dateToDatetimeLocal(recommendedSchedulingStartDate())}
                onChange={(event) => {
                  setCallTime(event.target.value)
                  setScheduleSuggestion(null)
                }}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-needle/50"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink">Reason</span>
              <select
                value={callReason}
                onChange={(event) => setCallReason(event.target.value)}
                className="w-full rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {CALL_SCHEDULING_POLICY.reasons.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void scheduleReadyMadeCall()
              }}
              disabled={!!callBusy}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20 md:col-auto"
            >
              {callBusy === 'schedule' ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
          {scheduleSuggestion?.kind === 'call' ? (
            <button
              type="button"
              onClick={() => {
                setCallTime(scheduleSuggestion.value)
                setScheduleSuggestion(null)
                setError(null)
              }}
              className="mt-3 w-fit rounded-[8px] border border-needle/20 bg-needle/8 px-3 py-2 text-sm font-semibold text-needle"
            >
              Use {scheduleSuggestion.label}
            </button>
          ) : null}
        </DisclosurePanel>
      ) : isReadyMade ? (
        <p className="mt-3 rounded-[8px] border border-ink/8 bg-bone/55 px-3 py-2 text-xs leading-5 text-ink/54">
          Use Messages for item questions before checkout. Ready-made calls open after checkout when
          the order is active.
        </p>
      ) : null}
    </div>
  )
}
