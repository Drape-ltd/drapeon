import { GuidePicker, GuideMessageCards } from '@/features/user-education/GuideMessages'
import {
  guideDraftText,
  parseGuideReferences,
  removeGuideDraftReference,
  updateGuideDraftText,
} from '@drape/shared/guide-library'
/**
 * Shared messaging thread component.
 * Used by both customer and tailor — pass senderId and the orderId.
 * Supports text, camera/library photo, and voice note messages.
 * Contact filter applied inline before send.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { styles } from '@/features/messages/message-thread-styles'
import {
  View, Text, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Keyboard,
  PanResponder, Animated, Vibration, AppState, Linking, Platform,
} from 'react-native'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { Audio } from 'expo-av'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase, invokeFunction } from '@/lib/supabase'
import { stripExif } from '@/lib/stripExif'
import { createValidatedUploadPayload } from '@/lib/storage-upload'
import { readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import { hapticLight } from '@/lib/haptics'
import * as FileSystem from 'expo-file-system/legacy'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import {
  conversationClusterPositionForMessage,
  groupMessageMediaClusters,
  type ClusterPosition,
} from '@drape/shared/message-thread-clusters'
import {
  callSchedulingReasonFor,
  formatCallCountdown,
  getCallLifecycleState,
} from '@drape/shared/call-scheduling-policy'
import { buildGoogleCalendarEventUrl } from '@drape/shared/order-appointments'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import {
  languageName,
  type ConversationTranslationPreference,
  type MessageTranslation,
} from '@drape/shared/message-translation'
import {
  deriveConversationEventPresentation,
  parseScheduledOrderCallMessage,
} from '@drape/shared/conversation-event-presentation'
import {
  ORDER_EVENT_LABELS,
  type OrderConversationAction,
  type OrderEvent,
  type QuoteRevisionRequest,
} from '@drape/shared/order-negotiation'
import type { OrderStage } from '@drape/shared/order-machine'
import { Colors, Spacing } from '@/constants/theme'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { RemoteImage } from '@/components/ui/RemoteImage'
import { PortfolioVideoPreview } from '@/components/ui/PortfolioVideoPreview'
import { BottomSheetScaffold } from './BottomSheetScaffold'
import UILibView from 'react-native-ui-lib/src/components/view'
import type { MediaLightboxItem } from './MediaLightboxModal'
import { DrapeMediaViewer } from './DrapeMediaViewer'
import { DrapeMediaMosaic, type DrapeMediaMosaicItem } from './DrapeMediaMosaic'
import { DrapeVoicePlayer } from './DrapeVoicePlayer'
import {
  DrapeCapsuleButton,
  DrapeInlineActionCard,
  DrapeSheet,
  DrapeStatusChip,
} from './DrapePrimitives'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE,
  isVideoMediaUrl,
} from '@drape/shared/media-policy'

type MessageType = 'TEXT' | 'PHOTO' | 'VOICE'
type MessageMediaSource = 'camera-photo' | 'camera-video' | 'library'
type ThreadNotice = { tone: 'warning' | 'error'; text: string }
type EmptyConversationPrompt = {
  eyebrow?: string
  title: string
  body: string
  starters?: string[]
}
type CallLifecycleEvent = {
  kind: 'consultation' | 'order'
  createdAt: string | null | undefined
  scheduledStartAt: string | null | undefined
  timezone?: string | null
  reason?: string | null
  status?: string | null
  paymentRequired?: boolean
  paymentPaid?: boolean
  actionLoading?: boolean
  onJoinVideo?: () => void
  onReschedule?: () => void
  rescheduleLabel?: string
  paymentActionLabel?: string | null
  onPressPayment?: () => void
}

type Message = {
  id: string
  order_id: string
  sender_id: string
  sender_role: 'CUSTOMER' | 'TAILOR'
  sender_name: string
  type: MessageType
  body: string | null
  photo_url: string | null
  voice_url: string | null
  created_at: string
  read_at: string | null
  is_deleted: boolean
  edited_at: string | null
  reply_to_id: string | null
}

type MessageReaction = {
  id: string
  message_id: string
  order_id: string
  user_id: string
  emoji: string
  created_at: string | null
}

type MessageMediaPreview = {
  items: MediaLightboxItem[]
  index: number
}

type ThreadEntry =
  | { kind: 'messages'; key: string; createdAt: string; messages: Message[] }
  | { kind: 'event'; key: string; createdAt: string; event: OrderEvent }
  | { kind: 'call'; key: string; createdAt: string; event: CallLifecycleEvent }

type NegotiationState = {
  stage: OrderStage | null
  activeQuote: { id: string; version: number; status: 'ACTIVE' } | null
  openRevision: Pick<QuoteRevisionRequest, 'id' | 'status' | 'roundNumber'> | null
  roundsUsed: number
  roundLimit: number
}

interface Props {
  orderId: string
  currentUserId: string
  currentUserRole: 'CUSTOMER' | 'TAILOR'
  tailorName: string
  tailorAvatarUrl?: string | null
  customerName: string
  customerAvatarUrl?: string | null
  locked?: boolean
  lockedMessage?: string
  callGateMessage?: string | null
  callGateActionLabel?: string | null
  onPressCallGateAction?: () => void
  callLifecycleEvent?: CallLifecycleEvent | null
  orderKind?: 'CUSTOM' | 'READY_MADE'
  orderStage?: OrderStage
  focusedEventId?: string | null
  focusedMessageId?: string | null
  onConversationAction?: (action: OrderConversationAction) => void
  onReportMessage?: (messageId: string) => void
  onCounterpartyOnlineChange?: (online: boolean) => void
  translationPreference?: ConversationTranslationPreference
  onTranslateMessage?: (messageId: string) => Promise<MessageTranslation>
  emptyConversationPrompt?: EmptyConversationPrompt
}

// Rate limit: max 8 sends in 30 seconds
const RATE_LIMIT_COUNT = 8
const RATE_LIMIT_WINDOW_MS = 30_000
const MESSAGE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.messageVideo
const MESSAGE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.messageVideo
const CHAT_ORDER_ACTIONS_ENABLED = MOBILE_FEATURE_FLAGS.chatOrderActionsV1
const MESSAGE_SIGNED_URL_CACHE_WINDOW_MS = 50 * 60 * 1000
const messageSignedUrlCache = new Map<string, { url: string; expiresAt: number }>()

function cachedMessageSignedUrl(path: string) {
  const cached = messageSignedUrlCache.get(path)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    messageSignedUrlCache.delete(path)
    return null
  }
  return cached.url
}

function cacheMessageSignedUrl(path: string, url: string) {
  messageSignedUrlCache.set(path, {
    url,
    expiresAt: Date.now() + MESSAGE_SIGNED_URL_CACHE_WINDOW_MS,
  })
}

const MSG_PAGE_SIZE = 50
const MESSAGE_REACTION_OPTIONS = ['👍', '❤️', '😂', '😮', '🙏'] as const
const CONNECTIVITY_PATTERNS = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'timed out',
  'connection lost',
  'offline',
  'internet connection appears to be offline',
]

function isWithin15Minutes(isoString: string) {
  const raw = /\dT\d/.test(isoString) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(isoString) ? `${isoString}Z` : isoString
  const date = new Date(raw)
  return !Number.isNaN(date.getTime()) && Date.now() - date.getTime() < 15 * 60 * 1000
}

function isAbsoluteMediaUrl(value: string) {
  return /^(https?:|file:|blob:|data:)/i.test(value)
}

function messageMediaPath(value: string) {
  return value.trim().replace(/^\/+/, '').replace(/^message-media\//, '')
}

function extensionFromAsset(asset: ImagePicker.ImagePickerAsset) {
  const raw = asset.fileName || asset.uri.split('?')[0]?.split('/').pop() || ''
  return raw.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
}

function isMessageVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  const mimeType = asset.mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return asset.type === 'video' || mimeType.startsWith('video/') || /\.(mp4|mov|m4v)(?:$|\?)/iu.test(asset.uri)
}

function messageVideoContentType(asset: ImagePicker.ImagePickerAsset) {
  const normalizedMime = asset.mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalizedMime && ALLOWED_VIDEO_CONTENT_TYPES.includes(normalizedMime as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number])) {
    return normalizedMime
  }
  const extension = extensionFromAsset(asset)
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime'
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4'
  return normalizedMime ?? 'video/mp4'
}

function messageVideoExtension(asset: ImagePicker.ImagePickerAsset) {
  const extension = extensionFromAsset(asset)
  if (extension === 'mov' || extension === 'qt') return 'mov'
  return 'mp4'
}

function messageVideoDurationSeconds(asset: ImagePicker.ImagePickerAsset) {
  if (typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0) return null
  return asset.duration > 1000 ? asset.duration / 1000 : asset.duration
}

function validateMessageVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  const contentType = messageVideoContentType(asset)
  if (!ALLOWED_VIDEO_CONTENT_TYPES.includes(contentType as (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number])) {
    return 'Choose an MP4 or MOV video.'
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > MESSAGE_VIDEO_MAX_BYTES) {
    return `Choose videos under ${Math.round(MESSAGE_VIDEO_MAX_BYTES / (1024 * 1024))} MB.`
  }
  const durationSeconds = messageVideoDurationSeconds(asset)
  if (durationSeconds != null && durationSeconds > MESSAGE_VIDEO_MAX_SECONDS) {
    return OPERATIONAL_VIDEO_DURATION_LIMIT_MESSAGE
  }
  return null
}

function useMessageMediaUrl(value: string | null | undefined) {
  const immediateUrl = useMemo(() => {
    const raw = value?.trim()
    return raw && isAbsoluteMediaUrl(raw) ? raw : null
  }, [value])
  const storagePath = useMemo(() => {
    const raw = value?.trim()
    if (!raw || immediateUrl) return null
    return messageMediaPath(raw)
  }, [immediateUrl, value])
  const [signedUrl, setSignedUrl] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!storagePath) return undefined
    if (cachedMessageSignedUrl(storagePath)) return undefined
    let cancelled = false
    supabase.storage
      .from('message-media')
      .createSignedUrl(storagePath, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return
        const url = error ? null : data?.signedUrl ?? null
        if (url) cacheMessageSignedUrl(storagePath, url)
        setSignedUrl({ path: storagePath, url })
      })

    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (immediateUrl) return immediateUrl
  if (!storagePath) return null
  const cachedUrl = cachedMessageSignedUrl(storagePath)
  if (cachedUrl) return cachedUrl
  return signedUrl?.path === storagePath ? signedUrl.url : null
}

function useMessageMediaUrls(messages: Message[]) {
  const signature = messages.map((message) => `${message.id}:${message.photo_url ?? ''}`).join('|')
  const [resolvedBatch, setResolvedBatch] = useState<{ signature: string; urls: Map<string, string> } | null>(null)

  useEffect(() => {
    const immediateUrls = new Map<string, string>()
    const unresolvedPaths: string[] = []
    const messageIdByPath = new Map<string, string>()

    for (const message of messages) {
      const raw = message.photo_url?.trim()
      if (!raw) continue
      if (isAbsoluteMediaUrl(raw)) {
        immediateUrls.set(message.id, raw)
        continue
      }
      const path = messageMediaPath(raw)
      const cachedUrl = cachedMessageSignedUrl(path)
      if (cachedUrl) {
        immediateUrls.set(message.id, cachedUrl)
      } else {
        unresolvedPaths.push(path)
        messageIdByPath.set(path, message.id)
      }
    }

    if (unresolvedPaths.length === 0) {
      setResolvedBatch({ signature, urls: immediateUrls })
      return undefined
    }

    let cancelled = false
    setResolvedBatch({ signature, urls: immediateUrls })
    supabase.storage
      .from('message-media')
      .createSignedUrls(unresolvedPaths, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const urls = new Map(immediateUrls)
        for (const result of data) {
          if (!result.path || !result.signedUrl) continue
          cacheMessageSignedUrl(result.path, result.signedUrl)
          const messageId = messageIdByPath.get(result.path)
          if (messageId) urls.set(messageId, result.signedUrl)
        }
        setResolvedBatch({ signature, urls })
      })

    return () => {
      cancelled = true
    }
  }, [messages, signature])

  return resolvedBatch?.signature === signature ? resolvedBatch.urls : new Map<string, string>()
}

function messageMediaPreviewItems(
  messages: Message[],
  resolvedMessageId?: string,
  resolvedUri?: string | null,
) {
  const mediaMessages = messages.filter((message) => !!message.photo_url)

  return mediaMessages
    .map((message, index) => {
      const uri = message.photo_url!
      const isVideo = isVideoMediaUrl(uri)
      return {
        uri,
        resolvedUri: message.id === resolvedMessageId ? resolvedUri ?? undefined : undefined,
        label: `${isVideo ? 'Video' : 'Photo'} ${index + 1} of ${mediaMessages.length}`,
        contextId: message.id,
        kind: isVideo ? 'video' : 'photo',
        bucket: 'message-media',
        requiresSignedUrl: !isAbsoluteMediaUrl(uri),
      } satisfies MediaLightboxItem
    })
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null
  const normalized = /\dT\d/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage.trim()
    }
  }
  return null
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isLikelyConnectivityIssue(error: unknown) {
  const message = readErrorMessage(error)?.toLowerCase() ?? ''
  return CONNECTIVITY_PATTERNS.some((pattern) => message.includes(pattern))
}

async function resolveMessageSendFailure(error: Error | null, fallback: string) {
  const payload = error ? await readFunctionErrorPayload(error) : null
  const code = readPayloadString(payload, 'code')
  const payloadMessage = readPayloadString(payload, 'error')
  const rawMessage = payloadMessage ?? readErrorMessage(error) ?? fallback

  if (code === 'UNAUTHORIZED' || /session expired/i.test(rawMessage)) {
    return {
      title: 'Session expired',
      message: 'Please sign in again before sending messages.',
    }
  }

  if (code === 'BLOCKED_CONTACT') {
    return {
      title: 'Keep it on Drapeon',
      message: payloadMessage ?? "Contact details can't be shared in messages.",
      inlineMessage: payloadMessage ?? "Contact details can't be shared in messages.",
      showAlert: false,
    }
  }

  if (code === 'THREATENING_LANGUAGE') {
    return {
      title: 'Message blocked',
      message: payloadMessage ?? "That message can't be sent. Keep communication respectful.",
      inlineMessage: payloadMessage ?? "That message can't be sent. Keep communication respectful.",
      showAlert: false,
    }
  }

  if (code === 'CONVERSATION_BLOCKED') {
    return {
      title: 'Conversation paused',
      message: payloadMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.',
      inlineMessage: payloadMessage ?? 'This conversation is paused while Drapeon reviews a safety concern.',
      showAlert: false,
    }
  }

  if (code === 'RATE_LIMITED') {
    return {
      title: 'Too many attempts',
      message: payloadMessage ?? 'You are sending messages too quickly. Please wait a moment before trying again.',
      rateLimited: true,
    }
  }

  if (code === 'ORDER_NOT_FOUND' || code === 'FORBIDDEN') {
    return {
      title: 'Thread unavailable',
      message: payloadMessage ?? 'This conversation is not available right now. Refresh the order and try again.',
    }
  }

  if (isLikelyConnectivityIssue(error)) {
    return {
      title: 'Message not sent',
      message: 'Your connection looks weak. We kept your draft here so you can retry when the signal stabilizes.',
      connectivity: true,
    }
  }

  return {
    title: 'Message not sent',
    message: await readFunctionErrorMessage(error, fallback),
  }
}

function resolveThreadLoadError(error: unknown, hasCachedMessages: boolean) {
  if (isLikelyConnectivityIssue(error)) {
    return hasCachedMessages
      ? 'Connection is weak. Existing messages stay visible. Refresh this thread when the signal improves.'
      : 'Connection is weak. We could not load this thread yet. Retry when the signal improves.'
  }

  if (hasCachedMessages) {
    return 'We could not refresh this conversation just now. Existing messages stay visible while you retry.'
  }

  return 'Could not load this conversation right now. Refresh the thread or reopen the order.'
}

function formatPresenceTime(isoString: string): string {
  const date = parseDateValue(isoString)
  if (!date) return 'recently'
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function resolveMediaFailure(kind: 'photo' | 'video' | 'voice', error: unknown) {
  const label = kind === 'voice' ? 'Voice note' : kind === 'video' ? 'Video' : 'Photo'
  if (isLikelyConnectivityIssue(error)) {
    const message =
      kind === 'voice'
        ? 'Your connection looks weak. Retry this voice note when the signal improves.'
        : kind === 'video'
          ? 'Your connection looks weak. Retry this video when the signal improves.'
          : 'Your connection looks weak. Retry this upload when the signal improves.'
    return {
      title: `${label} not sent`,
      message,
      connectivity: true,
    }
  }

  return {
    title: `${label} not sent`,
    message:
      kind === 'voice'
        ? 'Could not send this voice note right now. Please try again in a moment.'
        : kind === 'video'
          ? 'Could not send this video right now. Please try again in a moment.'
          : 'Could not send this photo right now. Please try again in a moment.',
    connectivity: false,
  }
}

export function MessageThread({
  orderId,
  currentUserId,
  currentUserRole,
  tailorName,
  tailorAvatarUrl,
  customerName,
  customerAvatarUrl,
  locked = false,
  lockedMessage,
  callGateMessage,
  callGateActionLabel,
  onPressCallGateAction,
  callLifecycleEvent,
  orderKind = 'CUSTOM',
  orderStage,
  focusedEventId,
  focusedMessageId,
  onConversationAction,
  onReportMessage,
  onCounterpartyOnlineChange,
  translationPreference = { autoTranslate: false, targetLanguage: 'en', sourceLanguage: null },
  onTranslateMessage = async () => { throw new Error('Translation is unavailable right now.') },
  emptyConversationPrompt,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const [contextMenuMessage, setContextMenuMessage] = useState<Message | null>(null)
  const [mediaPreview, setMediaPreview] = useState<MessageMediaPreview | null>(null)
  const [mediaSourceSheetVisible, setMediaSourceSheetVisible] = useState(false)
  const [orderEvents, setOrderEvents] = useState<OrderEvent[]>([])
  const [negotiationState, setNegotiationState] = useState<NegotiationState>({
    stage: orderStage ?? null,
    activeQuote: null,
    openRevision: null,
    roundsUsed: 0,
    roundLimit: 3,
  })
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [reactions, setReactions] = useState<MessageReaction[]>([])
  const [reactionsAvailable, setReactionsAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshingThread, setRefreshingThread] = useState(false)
  const [hasEarlier, setHasEarlier] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const loadingEarlierRef = useRef(false)
  const optimisticReactionIdRef = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [threadNotice, setThreadNotice] = useState<ThreadNotice | null>(null)
  const [text, setText] = useState('')
  const [textError, setTextError] = useState('')
  const [sending, setSending] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showCancelHint, setShowCancelHint] = useState(false)
  const [recordingLocked, setRecordingLocked] = useState(false)
  const [recordingHolding, setRecordingHolding] = useState(false)
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0)
  const recordingRef = useRef<Audio.Recording | null>(null)
  const recordingStartingRef = useRef(false)
  const recordingStoppingRef = useRef(false)
  const recordingGestureActiveRef = useRef(false)
  const recordingStopRequestedRef = useRef(false)
  const recordingSessionRef = useRef(0)
  const recordingLockedRef = useRef(false)
  const recordingStartedAtRef = useRef(0)
  const isCancelledRef = useRef(false)
  const sendingRef = useRef(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appStateRef = useRef(AppState.currentState)
  const [counterpartyIsTyping, setCounterpartyIsTyping] = useState(false)
  const [counterpartyPresence, setCounterpartyPresence] = useState<{ online: boolean; lastSeen: string | null }>({ online: false, lastSeen: null })
  const [translations, setTranslations] = useState<Record<string, MessageTranslation>>({})
  const [translationLoadingIds, setTranslationLoadingIds] = useState<Set<string>>(new Set())
  const [translationFailedIds, setTranslationFailedIds] = useState<Set<string>>(new Set())
  const [showOriginalIds, setShowOriginalIds] = useState<Set<string>>(new Set())
  const [activeVoiceMessageId, setActiveVoiceMessageId] = useState<string | null>(null)

  useEffect(() => {
    setTranslations({})
    setShowOriginalIds(new Set())
    setTranslationFailedIds(new Set())
  }, [translationPreference.sourceLanguage, translationPreference.targetLanguage])

  useEffect(() => {
    onCounterpartyOnlineChange?.(counterpartyPresence.online)
  }, [counterpartyPresence.online, onCounterpartyOnlineChange])

  const requestTranslation = useCallback(async (message: Message, announceError: boolean) => {
    if (message.type !== 'TEXT' || message.is_deleted || !message.body || parseScheduledOrderCallMessage(message.body)) return
    if (translations[message.id] || translationLoadingIds.has(message.id)) return
    if (announceError) {
      setTranslationFailedIds((current) => {
        const next = new Set(current)
        next.delete(message.id)
        return next
      })
    } else if (translationFailedIds.has(message.id)) {
      return
    }
    setTranslationLoadingIds((current) => new Set(current).add(message.id))
    try {
      const translation = await Promise.race([
        onTranslateMessage(message.id),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Translation took too long. Please try again.')), 20_000)
        }),
      ])
      setTranslations((current) => ({ ...current, [message.id]: translation }))
      setShowOriginalIds((current) => {
        const next = new Set(current)
        next.delete(message.id)
        return next
      })
    } catch (error) {
      setTranslationFailedIds((current) => new Set(current).add(message.id))
      if (announceError) {
        Alert.alert('Translation unavailable', error instanceof Error ? error.message : 'This message could not be translated right now.')
      }
    } finally {
      setTranslationLoadingIds((current) => {
        const next = new Set(current)
        next.delete(message.id)
        return next
      })
    }
  }, [onTranslateMessage, translationFailedIds, translationLoadingIds, translations])

  useEffect(() => {
    if (!translationPreference.autoTranslate || loading) return
    const candidates = messages
      .filter((message) =>
        message.sender_id !== currentUserId &&
        message.type === 'TEXT' &&
        !message.is_deleted &&
        !!message.body &&
        !parseScheduledOrderCallMessage(message.body) &&
        !translations[message.id] &&
        !translationFailedIds.has(message.id) &&
        !translationLoadingIds.has(message.id)
      )
      .slice(-30)
    candidates.forEach((message) => { void requestTranslation(message, false) })
  }, [currentUserId, loading, messages, requestTranslation, translationFailedIds, translationLoadingIds, translationPreference.autoTranslate, translations])

  // PanResponder is created once; callbacks read only from refs so stale closures are safe
  const micPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sendingRef.current,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        recordingGestureActiveRef.current = true
        recordingStopRequestedRef.current = false
        setRecordingHolding(true)
        void startRecording()
      },
      onPanResponderMove: (_, g) => {
        if (g.dx < -60 && !isCancelledRef.current) {
          isCancelledRef.current = true
          setShowCancelHint(true)
          Vibration.vibrate(40)
          return
        }
        if (g.dy < -60 && !recordingLockedRef.current && !isCancelledRef.current) {
          recordingLockedRef.current = true
          setRecordingLocked(true)
          setShowCancelHint(false)
          Vibration.vibrate(40)
        }
      },
      onPanResponderRelease: () => {
        recordingGestureActiveRef.current = false
        setRecordingHolding(false)
        if (isCancelledRef.current) {
          recordingStopRequestedRef.current = true
          void stopRecording()
          return
        }
        // Releasing exposes explicit send/discard controls. This also closes the
        // Android race where the finger could lift before the recorder existed.
        recordingLockedRef.current = true
        recordingStopRequestedRef.current = false
        setRecordingLocked(true)
      },
      onPanResponderTerminate: () => {
        recordingGestureActiveRef.current = false
        setRecordingHolding(false)
        if (isCancelledRef.current) {
          recordingStopRequestedRef.current = true
          void stopRecording()
          return
        }
        recordingLockedRef.current = true
        recordingStopRequestedRef.current = false
        setRecordingLocked(true)
      },
    })
  ).current
  const flatListRef = useRef<FlashListRef<ThreadEntry>>(null)
  const composerInputRef = useRef<TextInput>(null)
  const sendTimestamps = useRef<number[]>([])
  const insets = useSafeAreaInsets()
  const composerBottomPadding = Math.max(insets.bottom + Spacing.sm, Spacing.md)
  const draftGuideReferences = parseGuideReferences(text)

  useEffect(() => {
    if (!isRecording) {
      setRecordingElapsedSeconds(0)
      return
    }
    const updateElapsed = () => {
      setRecordingElapsedSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)))
    }
    updateElapsed()
    const interval = setInterval(updateElapsed, 250)
    return () => clearInterval(interval)
  }, [isRecording])

  useEffect(() => () => {
    // Fast Refresh, navigation, and role switches must not strand Expo AV's
    // singleton recorder. A stranded instance blocks the next Android note.
    recordingSessionRef.current += 1
    const activeRecording = recordingRef.current
    recordingRef.current = null
    if (activeRecording) {
      void activeRecording.stopAndUnloadAsync()
        .catch(() => undefined)
        .finally(() => Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined))
    }
  }, [])
  const replyingToMediaUrl = useMessageMediaUrl(
    replyingTo?.photo_url,
  )
  const replyingToMediaIsVideo = isVideoMediaUrl(replyingTo?.photo_url)

  // Keep sending ref in sync so PanResponder can gate on it without stale closure
  sendingRef.current = sending

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const conversationPositions = useMemo(
    () => new Map(messages.map((message, index) => [
      message.id,
      conversationClusterPositionForMessage(messages, index),
    ])),
    [messages],
  )
  const messageGroups = useMemo(() => groupMessageMediaClusters(messages), [messages])
  const timelineEntries = useMemo<ThreadEntry[]>(() => {
    const messageEntries: ThreadEntry[] = messageGroups
      .filter((group) => group.length > 0)
      .map((group) => ({
        kind: 'messages',
        key: `messages:${group.map((message) => message.id).join(':')}`,
        createdAt: group[0]?.created_at ?? '',
        messages: group,
      }))
    const eventEntries: ThreadEntry[] = orderEvents.map((event) => ({
      kind: 'event',
      key: `event:${event.id}`,
      createdAt: event.createdAt,
      event,
    }))
    const callAnchorMessage = callLifecycleEvent?.kind === 'order'
      ? messages
          .filter((message) => message.body?.startsWith('Drapeon order call scheduled for '))
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
      : null
    const callTimelineAt = callAnchorMessage?.created_at ?? callLifecycleEvent?.createdAt
    const callEntries: ThreadEntry[] = callLifecycleEvent && callTimelineAt
      ? [{
          kind: 'call',
          key: `call:${callLifecycleEvent.kind}:${callTimelineAt}`,
          createdAt: callTimelineAt,
          event: callLifecycleEvent,
        }]
      : []
    return [...messageEntries, ...eventEntries, ...callEntries].sort((left, right) => {
      const timestampOrder = left.createdAt.localeCompare(right.createdAt)
      if (timestampOrder !== 0) return timestampOrder
      if (left.kind === 'call') return 1
      if (right.kind === 'call') return -1
      return 0
    })
  }, [callLifecycleEvent, messageGroups, messages, orderEvents])

  const nextVoiceMessageIdById = useMemo(() => {
    const nextById = new Map<string, string>()
    for (let index = 0; index < timelineEntries.length - 1; index += 1) {
      const current = timelineEntries[index]
      const next = timelineEntries[index + 1]
      if (current?.kind !== 'messages' || next?.kind !== 'messages') continue
      const currentMessage = current.messages.length === 1 ? current.messages[0] : null
      const nextMessage = next.messages.length === 1 ? next.messages[0] : null
      if (
        currentMessage?.type === 'VOICE' &&
        nextMessage?.type === 'VOICE' &&
        !currentMessage.is_deleted &&
        !nextMessage.is_deleted &&
        currentMessage.sender_id === nextMessage.sender_id
      ) {
        nextById.set(currentMessage.id, nextMessage.id)
      }
    }
    return nextById
  }, [timelineEntries])

  const voiceSequenceCountByStartId = useMemo(() => {
    const counts = new Map<string, number>()
    let index = 0
    while (index < timelineEntries.length) {
      const entry = timelineEntries[index]
      const first = entry?.kind === 'messages' && entry.messages.length === 1 ? entry.messages[0] : null
      if (first?.type !== 'VOICE' || first.is_deleted) {
        index += 1
        continue
      }
      let end = index + 1
      while (end < timelineEntries.length) {
        const candidateEntry = timelineEntries[end]
        const candidate = candidateEntry?.kind === 'messages' && candidateEntry.messages.length === 1
          ? candidateEntry.messages[0]
          : null
        if (candidate?.type !== 'VOICE' || candidate.is_deleted || candidate.sender_id !== first.sender_id) break
        end += 1
      }
      const count = end - index
      if (count > 1) counts.set(first.id, count)
      index = end
    }
    return counts
  }, [timelineEntries])

  const reactionsByMessageId = useMemo(() => {
    const grouped = new Map<string, MessageReaction[]>()
    for (const reaction of reactions) {
      const current = grouped.get(reaction.message_id) ?? []
      current.push(reaction)
      grouped.set(reaction.message_id, current)
    }
    return grouped
  }, [reactions])

  const fetchReactionsForMessageIds = useCallback(async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      setReactions([])
      return
    }
    if (!reactionsAvailable) return

    const { data, error } = await supabase
      .from('message_reactions')
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .eq('order_id', orderId)
      .in('message_id', messageIds)

    if (error) {
      setReactionsAvailable(false)
      setReactions([])
      return
    }

    setReactionsAvailable(true)
    setReactions((data ?? []) as MessageReaction[])
  }, [orderId, reactionsAvailable])

  const fetchMessages = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (silent) setRefreshingThread(true)
    else setLoading(true)
    setLoadError('')

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(MSG_PAGE_SIZE)

      if (error) throw error

      const nextMessages = data ? ([...data].reverse() as Message[]) : []
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      await fetchReactionsForMessageIds(nextMessages.map((message) => message.id))
      setHasEarlier((data?.length ?? 0) === MSG_PAGE_SIZE)
      setThreadNotice(null)
    } catch (error) {
      const hasCachedMessages = messagesRef.current.length > 0
      const message = resolveThreadLoadError(error, hasCachedMessages)
      if (hasCachedMessages) {
        setThreadNotice({ tone: 'warning', text: message })
      } else {
        setLoadError(message)
      }
    } finally {
      setRefreshingThread(false)
      setLoading(false)
    }
  }, [fetchReactionsForMessageIds, orderId])

  const fetchOrderConversationState = useCallback(async () => {
    if (!CHAT_ORDER_ACTIONS_ENABLED || orderKind !== 'CUSTOM') {
      setOrderEvents([])
      setNegotiationState({
        stage: orderStage ?? null,
        activeQuote: null,
        openRevision: null,
        roundsUsed: 0,
        roundLimit: 3,
      })
      return
    }

    const [orderResult, revisionResult, eventResult] = await Promise.all([
      supabase
        .from('orders')
        .select('stage, active_quote_id, active_quote_version, negotiation_rounds_used, negotiation_round_limit')
        .eq('id', orderId)
        .maybeSingle(),
      supabase
        .from('quote_revision_requests')
        .select('id, status, round_number')
        .eq('order_id', orderId)
        .eq('status', 'OPEN')
        .maybeSingle(),
      supabase
        .from('order_events')
        .select('id, order_id, event_type, actor_id, actor_role, quote_id, quote_version, revision_request_id, title, summary, metadata, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true }),
    ])

    if (orderResult.error || revisionResult.error || eventResult.error) {
      if (__DEV__) {
        console.warn(
          '[drape] Could not load conversation actions.',
          orderResult.error ?? revisionResult.error ?? eventResult.error,
        )
      }
      return
    }

    const orderRow = orderResult.data as {
      stage?: OrderStage | null
      active_quote_id?: string | null
      active_quote_version?: number | null
      negotiation_rounds_used?: number | null
      negotiation_round_limit?: number | null
    } | null
    const revisionRow = revisionResult.data as {
      id: string
      status: QuoteRevisionRequest['status']
      round_number: number
    } | null
    const eventRows = (eventResult.data ?? []) as Array<{
      id: string
      order_id: string
      event_type: OrderEvent['eventType']
      actor_id: string | null
      actor_role: OrderEvent['actorRole']
      quote_id: string | null
      quote_version: number | null
      revision_request_id: string | null
      title: string
      summary: string | null
      metadata: Record<string, unknown> | null
      created_at: string
    }>

    setNegotiationState({
      stage: orderRow?.stage ?? orderStage ?? null,
      activeQuote: orderRow?.active_quote_id && orderRow.active_quote_version
        ? { id: orderRow.active_quote_id, version: orderRow.active_quote_version, status: 'ACTIVE' }
        : null,
      openRevision: revisionRow
        ? { id: revisionRow.id, status: revisionRow.status, roundNumber: revisionRow.round_number }
        : null,
      roundsUsed: orderRow?.negotiation_rounds_used ?? 0,
      roundLimit: orderRow?.negotiation_round_limit ?? 3,
    })
    setOrderEvents(eventRows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      quoteId: row.quote_id,
      quoteVersion: row.quote_version,
      revisionRequestId: row.revision_request_id,
      title: row.title,
      summary: row.summary,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    })))
  }, [orderId, orderKind, orderStage])

  async function loadEarlier() {
    if (!hasEarlier || loadingEarlierRef.current || messages.length === 0) return
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    const oldest = messages[0].created_at
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('order_id', orderId)
        .lt('created_at', oldest)
        .order('created_at', { ascending: false })
        .limit(MSG_PAGE_SIZE)

      if (data) {
        const earlierMessages = [...data].reverse() as Message[]
        const nextMessages = [...earlierMessages, ...messages]
        setMessages(nextMessages)
        messagesRef.current = nextMessages
        await fetchReactionsForMessageIds(nextMessages.map((message) => message.id))
        setHasEarlier(data.length === MSG_PAGE_SIZE)
      }
    } catch (error) {
      setThreadNotice({
        tone: 'warning',
        text: resolveThreadLoadError(error, true),
      })
    } finally {
      loadingEarlierRef.current = false
      setLoadingEarlier(false)
    }
  }

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchMessages()
    }, 0)

    // Realtime subscription
    const channel = supabase
      .channel(`messages:${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev
            const nextMessages = [...prev, payload.new as Message]
            messagesRef.current = nextMessages
            return nextMessages
          })
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          setMessages((prev) => {
            const nextMessages = prev.map((message) =>
              message.id === payload.new.id ? { ...message, ...(payload.new as Partial<Message>) } : message
            )
            messagesRef.current = nextMessages
            return nextMessages
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `order_id=eq.${orderId}` },
        (payload) => {
          const next = payload.new as MessageReaction
          setReactionsAvailable(true)
          setReactions((prev) => prev.some((reaction) => reaction.id === next.id) ? prev : [...prev, next])
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `order_id=eq.${orderId}` },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>
          if (!old.id) return
          setReactions((prev) => prev.filter((reaction) => reaction.id !== old.id))
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { userId: string; isTyping: boolean } }) => {
        if (payload.userId === currentUserId) return
        setCounterpartyIsTyping(!!payload.isTyping)
        if (typingClearRef.current) clearTimeout(typingClearRef.current)
        if (payload.isTyping) {
          typingClearRef.current = setTimeout(() => setCounterpartyIsTyping(false), 4000)
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ userId: string }>()
        const others = Object.values(state).flat().filter((p) => p.userId !== currentUserId)
        const isOnline = others.length > 0
        setCounterpartyPresence((prev) => ({
          online: isOnline,
          lastSeen: isOnline ? null : (prev.online ? new Date().toISOString() : prev.lastSeen),
        }))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ userId: currentUserId, threadStatus: 'open' })
        }
      })

    channelRef.current = channel

    // Reconcile from Postgres on every foreground. Mobile realtime sockets can
    // suspend without delivering every change while the app is backgrounded.
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && nextState !== 'active') {
        void channel.untrack()
      }
      if (nextState === 'active') {
        void channel.track({ userId: currentUserId, threadStatus: 'open' })
        void fetchMessages({ silent: true })
      }
      appStateRef.current = nextState
    })

    return () => {
      clearTimeout(initialLoad)
      appStateSub.remove()
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
      if (typingClearRef.current) clearTimeout(typingClearRef.current)
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [fetchMessages, orderId, currentUserId])

  useEffect(() => {
    if (!CHAT_ORDER_ACTIONS_ENABLED || orderKind !== 'CUSTOM') return undefined

    let pollTimer: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (pollTimer || AppState.currentState !== 'active') return
      void fetchOrderConversationState()
      pollTimer = setInterval(() => {
        void fetchOrderConversationState()
      }, 60_000)
    }
    const stopPolling = () => {
      if (!pollTimer) return
      clearInterval(pollTimer)
      pollTimer = null
    }
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') startPolling()
      else stopPolling()
    })
    const channel = supabase
      .channel(`order-conversation:${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` },
        () => { void fetchOrderConversationState() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_revision_requests', filter: `order_id=eq.${orderId}` },
        () => { void fetchOrderConversationState() },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        () => { void fetchOrderConversationState() },
      )
      .subscribe()

    startPolling()

    return () => {
      stopPolling()
      appStateSub.remove()
      void supabase.removeChannel(channel)
    }
  }, [fetchOrderConversationState, orderId, orderKind])

  useEffect(() => {
    if (!focusedEventId || timelineEntries.length === 0) return
    const index = timelineEntries.findIndex(
      (entry) => entry.kind === 'event' && entry.event.id === focusedEventId,
    )
    if (index < 0) return
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 })
    }, 180)
    return () => clearTimeout(timer)
  }, [focusedEventId, timelineEntries])

  useEffect(() => {
    if (!focusedMessageId || timelineEntries.length === 0) return
    const index = timelineEntries.findIndex(
      (entry) => entry.kind === 'messages' && entry.messages.some((message) => message.id === focusedMessageId),
    )
    if (index < 0) return
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 })
    }, 180)
    return () => clearTimeout(timer)
  }, [focusedMessageId, timelineEntries])

  // Mark incoming messages as read
  useEffect(() => {
    if (messages.length === 0) return
    const unread = messages
      .filter((m) => m.sender_id !== currentUserId && !m.read_at)
      .map((m) => m.id)
    if (unread.length > 0) {
      const now = new Date().toISOString()
      supabase
        .from('messages')
        .update({ read_at: now })
        .in('id', unread)
        .then(({ error }) => {
          if (!error) {
            setMessages((prev) => prev.map((message) =>
              unread.includes(message.id) ? { ...message, read_at: message.read_at ?? now } : message
            ))
          }
        })
    }
  }, [messages, currentUserId])

  function checkRateLimit(): boolean {
    const now = Date.now()
    sendTimestamps.current = sendTimestamps.current.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
    if (sendTimestamps.current.length >= RATE_LIMIT_COUNT) {
      setRateLimited(true)
      setTimeout(() => setRateLimited(false), RATE_LIMIT_WINDOW_MS)
      return false
    }
    sendTimestamps.current.push(now)
    return true
  }

  function validateText(t: string): boolean {
    const res = filterContactInfo(t)
    if (res.blocked) {
      setTextError(res.userMessage)
      return false
    }
    setTextError('')
    return true
  }

  async function sendText() {
    if (!text.trim() || !validateText(text)) return
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
    void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, isTyping: false } })
    setSending(true)
    setThreadNotice(null)

    if (editingMessage) {
      const { error } = await invokeFunction('message-action', {
        body: { action: 'edit', messageId: editingMessage.id, body: text.trim() },
      })
      if (error) {
        const failure = await resolveMessageSendFailure(error, 'Could not edit this message. Please try again.')
        if (failure.inlineMessage) setTextError(failure.inlineMessage)
        if (failure.showAlert !== false) Alert.alert(failure.title, failure.message)
      } else {
        const now = new Date().toISOString()
        setMessages((prev) => prev.map((m) => m.id === editingMessage.id ? { ...m, body: text.trim(), edited_at: now } : m))
        messagesRef.current = messagesRef.current.map((m) => m.id === editingMessage.id ? { ...m, body: text.trim(), edited_at: now } : m)
        setText('')
        setTextError('')
        setEditingMessage(null)
      }
      setSending(false)
      return
    }

    if (!checkRateLimit()) { setSending(false); return }

    const { error } = await invokeFunction('message-action', {
      body: {
        action: 'send-message',
        orderId,
        type: 'TEXT',
        body: text.trim(),
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
      },
    })

    if (error) {
      const failure = await resolveMessageSendFailure(error, 'Could not send message. Please try again.')
      if (failure.inlineMessage) {
        setTextError(failure.inlineMessage)
      }
      if (failure.rateLimited) {
        setRateLimited(true)
        setTimeout(() => setRateLimited(false), RATE_LIMIT_WINDOW_MS)
      }
      if (failure.connectivity) {
        setThreadNotice({
          tone: 'warning',
          text: 'Connection looks weak. Your draft stayed in place so you can retry when the signal improves.',
        })
      }
      if (failure.showAlert !== false) {
        Alert.alert(failure.title, failure.message)
      }
    } else {
      setText('')
      setTextError('')
      setReplyingTo(null)
      await fetchMessages({ silent: true })
      Keyboard.dismiss()
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    }
    setSending(false)
  }

  async function performUnsend(message: Message) {
    const { error } = await invokeFunction('message-action', {
      body: { action: 'unsend', messageId: message.id },
    })
    if (error) {
      const payload = await readFunctionErrorPayload(error)
      const code = readPayloadString(payload, 'code')
      if (code === 'UNSEND_WINDOW_EXPIRED') {
        Alert.alert('Cannot unsend', 'Messages can only be unsent within 15 minutes of sending.')
      } else {
        Alert.alert('Could not unsend', 'Something went wrong. Please try again.')
      }
      return
    }
    setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, is_deleted: true, body: null } : m))
    messagesRef.current = messagesRef.current.map((m) => m.id === message.id ? { ...m, is_deleted: true, body: null } : m)
    if (editingMessage?.id === message.id) { setEditingMessage(null); setText('') }
  }

  function openPhotoSourceSheet() {
    setMediaSourceSheetVisible(true)
  }

  function chooseMediaSource(source: MessageMediaSource) {
    setMediaSourceSheetVisible(false)
    setTimeout(() => { void sendMediaFromSource(source) }, 180)
  }

  async function pickMessageMedia(source: MessageMediaSource) {
    const permission =
      source === 'camera-photo' || source === 'camera-video'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera-photo' || source === 'camera-video'
          ? 'Allow camera access to send media.'
          : 'Allow photo access to send media.',
      )
      return null
    }

    if (source === 'camera-photo') {
      return launchImagePickerSafely(
        () =>
          ImagePicker.launchCameraAsync({
            mediaTypes: 'images',
            quality: 0.8,
          }),
        {
          context: 'message_camera_photo_picker',
          mediaLabel: 'message photo',
          extra: { source, orderId, senderId: currentUserId },
        }
      )
    }
    if (source === 'camera-video') {
      return launchImagePickerSafely(
        () =>
          ImagePicker.launchCameraAsync({
            mediaTypes: 'videos',
            quality: 0.8,
            videoMaxDuration: MESSAGE_VIDEO_MAX_SECONDS,
          }),
        {
          context: 'message_camera_video_picker',
          mediaLabel: 'message video',
          extra: { source, orderId, senderId: currentUserId },
        }
      )
    }
    return launchImagePickerSafely(
      () =>
        ImagePicker.launchImageLibraryAsync(
          preferCompatibleVideoRepresentation({
            mediaTypes: ['images', 'videos'],
            quality: 0.8,
            videoMaxDuration: MESSAGE_VIDEO_MAX_SECONDS,
            allowsMultipleSelection: true,
            selectionLimit: 6,
          })
        ),
      {
        context: 'message_library_media_picker',
        mediaLabel: 'message media file',
        extra: { source, orderId, senderId: currentUserId },
      }
    )
  }

  async function sendMediaFromSource(source: MessageMediaSource) {
    if (!checkRateLimit()) return
    const result = await pickMessageMedia(source)
    if (!result) return
    const assets = result.assets ?? []
    if (result.canceled || assets.length === 0) return

    for (const asset of assets) {
      const isVideo = isMessageVideoAsset(asset)
      const videoValidationError = isVideo ? validateMessageVideoAsset(asset) : null
      if (videoValidationError) {
        Alert.alert('Video not sent', videoValidationError)
        return
      }
    }

    setSending(true)
    setThreadNotice(null)
    const replyTargetId = replyingTo?.id ?? null
    let sentCount = 0
    let failure: { kind: 'photo' | 'video'; error: unknown } | null = null

    try {
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index]
        const isVideo = isMessageVideoAsset(asset)
        try {
          const uploadUri = isVideo ? asset.uri : await stripExif(asset.uri)
          const contentType = isVideo ? messageVideoContentType(asset) : 'image/jpeg'
          const extension = isVideo ? messageVideoExtension(asset) : 'jpg'
          const filename = `messages/${orderId}/${Date.now()}-${index}.${extension}`
          const payload = await createValidatedUploadPayload(uploadUri, {
            maxBytes: isVideo ? MESSAGE_VIDEO_MAX_BYTES : MEDIA_LIMITS_BYTES.image,
            contentType,
            allowedContentTypes: isVideo ? ALLOWED_VIDEO_CONTENT_TYPES : ALLOWED_IMAGE_CONTENT_TYPES,
            purpose: 'MESSAGE_MEDIA',
          })
          const { error: uploadError } = await supabase.storage
            .from('message-media')
            .upload(filename, payload.data, { contentType, cacheControl: MEDIA_CACHE_CONTROL_SECONDS.private })
          if (uploadError) throw uploadError

          const { error: insertError } = await invokeFunction('message-action', {
            body: {
              action: 'send-message',
              orderId,
              type: 'PHOTO',
              photoUrl: filename,
              ...(replyTargetId ? { replyToId: replyTargetId } : {}),
            },
          })
          if (insertError) throw insertError
          sentCount += 1
        } catch (error) {
          failure = { kind: isVideo ? 'video' : 'photo', error }
          break
        }
      }

      if (sentCount > 0) {
        setReplyingTo(null)
        await fetchMessages({ silent: true })
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120)
      }

      if (failure) {
        const resolved = resolveMediaFailure(failure.kind, failure.error)
        if (resolved.connectivity) {
          setThreadNotice({
            tone: 'warning',
            text: 'Connection looks weak. Some media may need another try when the signal improves.',
          })
        }
        if (assets.length > 1 && sentCount > 0) {
          Alert.alert('Some media were not sent', `${sentCount} of ${assets.length} items were sent. ${resolved.message}`)
        } else {
          Alert.alert(resolved.title, resolved.message)
        }
      }
    } finally {
      setSending(false)
    }
  }

  async function startRecording(startLocked = false) {
    if (
      recordingStartingRef.current ||
      recordingStoppingRef.current ||
      recordingRef.current ||
      sendingRef.current
    ) return

    const sessionId = recordingSessionRef.current + 1
    recordingSessionRef.current = sessionId
    recordingStartingRef.current = true
    recordingStopRequestedRef.current = false
    isCancelledRef.current = false
    recordingLockedRef.current = startLocked
    setRecordingLocked(startLocked)
    setRecordingHolding(false)
    setRecordingElapsedSeconds(0)
    setShowCancelHint(false)
    try {
      const currentPermission = await Audio.getPermissionsAsync()
      const permission = currentPermission.granted || !currentPermission.canAskAgain
        ? currentPermission
        : await Audio.requestPermissionsAsync()
      if (recordingSessionRef.current !== sessionId) return
      if (!permission.granted) {
        if (recordingGestureActiveRef.current) {
          Alert.alert('Microphone unavailable', 'Drapeon could not access your microphone. Check your phone permissions and try again.')
        }
        return
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)

      if (recordingSessionRef.current !== sessionId) {
        await rec.stopAndUnloadAsync().catch(() => undefined)
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined)
        return
      }

      recordingRef.current = rec
      recordingStartedAtRef.current = Date.now()
      setIsRecording(true)
      if (recordingStopRequestedRef.current || (!recordingGestureActiveRef.current && !recordingLockedRef.current)) {
        await stopRecording(sessionId)
      }
    } catch (error) {
      if (__DEV__) console.warn('[drape] Could not start voice recording.', error)
      if (recordingSessionRef.current === sessionId && recordingGestureActiveRef.current) {
        Alert.alert('Recording unavailable', 'Drapeon could not start a voice note right now. Please try again.')
      }
    } finally {
      if (recordingSessionRef.current === sessionId) {
        recordingStartingRef.current = false
      }
    }
  }

  async function stopRecording(expectedSessionId = recordingSessionRef.current) {
    recordingStopRequestedRef.current = true
    if (expectedSessionId !== recordingSessionRef.current) return
    const rec = recordingRef.current
    if (!rec || recordingStoppingRef.current) return
    recordingStoppingRef.current = true
    recordingRef.current = null
    setIsRecording(false)
    setShowCancelHint(false)
    setRecordingLocked(false)
    setRecordingHolding(false)
    recordingLockedRef.current = false
    recordingStartedAtRef.current = 0

    let durationSeconds = 0
    let uri: string | null = null
    try {
      const status = await rec.getStatusAsync()
      durationSeconds = Math.round((status.durationMillis ?? 0) / 1000)
      await rec.stopAndUnloadAsync()
      uri = rec.getURI()
    } catch (error) {
      if (__DEV__) console.warn('[drape] Could not finalize voice recording.', error)
    } finally {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined)
      recordingStoppingRef.current = false
    }

    // Cancelled via swipe: discard silently
    if (isCancelledRef.current) {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
      return
    }

    // Too short: discard and show inline hint
    if (durationSeconds < 1) {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
      setThreadNotice({ tone: 'warning', text: 'Keep recording for at least one second before sending.' })
      return
    }

    if (!uri) return

    setSending(true)
    setThreadNotice(null)
    const filename = `messages/${orderId}/${Date.now()}.m4a`
    try {
      const payload = await createValidatedUploadPayload(uri, 25 * 1024 * 1024)
      if (payload.byteLength > 25 * 1024 * 1024) {
        setSending(false)
        Alert.alert('Recording too large', 'Voice notes must be under 25 MB.')
        return
      }
      const { error: uploadError } = await supabase.storage.from('message-media').upload(filename, payload.data, { contentType: 'audio/mp4', cacheControl: MEDIA_CACHE_CONTROL_SECONDS.private })
      if (uploadError) throw uploadError

      const { error: insertError } = await invokeFunction('message-action', {
        body: {
          action: 'send-message',
          orderId,
          type: 'VOICE',
          voiceUrl: filename,
          voiceDuration: durationSeconds,
          ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        },
      })
      if (insertError) throw insertError
      setReplyingTo(null)
      await fetchMessages({ silent: true })
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    } catch (error) {
      const failure = resolveMediaFailure('voice', error)
      if (failure.connectivity) {
        setThreadNotice({
          tone: 'warning',
          text: 'Connection looks weak. Retry this voice note when the signal improves.',
        })
      }
      Alert.alert(failure.title, failure.message)
    }
    setSending(false)
  }

  function cancelLockedRecording() {
    isCancelledRef.current = true
    recordingStopRequestedRef.current = true
    void stopRecording()
  }

  function sendLockedRecording() {
    isCancelledRef.current = false
    recordingStopRequestedRef.current = true
    void stopRecording()
  }

  async function toggleReaction(message: Message, emoji: string) {
    if (!reactionsAvailable) return
    const existing = reactions.find((reaction) => (
      reaction.message_id === message.id &&
      reaction.user_id === currentUserId &&
      reaction.emoji === emoji
    ))
    const previous = reactions

    if (existing) {
      setReactions((current) => current.filter((reaction) => reaction.id !== existing.id))
      const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
      if (error) {
        setReactions(previous)
        Alert.alert('Reaction not saved', 'Could not update this reaction right now.')
      }
      return
    }

    optimisticReactionIdRef.current += 1
    const tempReaction: MessageReaction = {
      id: `local-${message.id}-${emoji}-${optimisticReactionIdRef.current}`,
      message_id: message.id,
      order_id: message.order_id,
      user_id: currentUserId,
      emoji,
      created_at: new Date().toISOString(),
    }
    setReactions((current) => [...current, tempReaction])
    const { data, error } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        order_id: message.order_id,
        user_id: currentUserId,
        emoji,
      })
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .single()

    if (error) {
      setReactions(previous)
      Alert.alert('Reaction not saved', 'Could not update this reaction right now.')
      return
    }

    setReactions((current) => current.map((reaction) => (
      reaction.id === tempReaction.id ? data as MessageReaction : reaction
    )))
  }

  function focusComposer() {
    setTimeout(() => composerInputRef.current?.focus(), 24)
  }

  function selectConversationStarter(starter: string) {
    setText(starter)
    setTextError('')
    focusComposer()
  }

  function openReplyComposer(message: Message) {
    setEditingMessage(null)
    setReplyingTo(message)
    focusComposer()
  }

  function openEditComposer(message: Message) {
    setReplyingTo(null)
    setEditingMessage(message)
    setText(message.body ?? '')
    focusComposer()
  }

  function openContextMenu(message: Message) {
    hapticLight()
    setContextMenuMessage(message)
  }

  const otherName = currentUserRole === 'CUSTOMER' ? tailorName : customerName
  const otherAvatarUrl = currentUserRole === 'CUSTOMER' ? tailorAvatarUrl : customerAvatarUrl
  const hasListHeader = hasEarlier

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={Colors.needleGreen} size="large" />

  return (
    <View style={styles.container}>
      <FlashList
        ref={flatListRef}
        data={timelineEntries}
        keyExtractor={(entry) => entry.key}
        drawDistance={420}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (focusedEventId || focusedMessageId) return
          flatListRef.current?.scrollToEnd({ animated: false })
        }}
        ListHeaderComponent={hasListHeader ? (
          <View style={styles.listHeaderStack}>
            {hasEarlier ? (
              <TouchableOpacity style={styles.loadEarlierBtn} onPress={loadEarlier} disabled={loadingEarlier}>
                {loadingEarlier
                  ? <ActivityIndicator size="small" color={Colors.needleGreen} />
                  : <Text style={styles.loadEarlierText}>↑ Load earlier messages</Text>
                }
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEyebrow}>
                {emptyConversationPrompt?.eyebrow ?? 'Conversation'}
              </Text>
              {loadError ? (
                <>
                  <Text style={styles.emptyTitle}>Couldn't load messages.</Text>
                  <Text style={styles.emptyText}>{loadError}</Text>
                  <TouchableOpacity
                    style={styles.retryThreadBtn}
                    onPress={() => void fetchMessages({ silent: true })}
                    disabled={refreshingThread}
                  >
                    {refreshingThread
                      ? <ActivityIndicator size="small" color={Colors.textInverse} />
                      : <Text style={styles.retryThreadBtnText}>Refresh thread</Text>
                    }
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>
                    {emptyConversationPrompt?.title ?? 'No messages yet'}
                  </Text>
                  <Text style={styles.emptyText}>
                    {emptyConversationPrompt?.body ??
                      `Start the conversation with ${otherName}. Keep updates and decisions here.`}
                  </Text>
                  {emptyConversationPrompt?.starters?.length ? (
                    <View style={styles.emptyStarterList}>
                      {emptyConversationPrompt.starters.map((starter) => (
                        <TouchableOpacity
                          key={starter}
                          style={styles.emptyStarterButton}
                          onPress={() => selectConversationStarter(starter)}
                          accessibilityRole="button"
                          accessibilityLabel={`Use message starter: ${starter}`}
                        >
                          <Text style={styles.emptyStarterText}>{starter}</Text>
                          <Feather name="arrow-right" size={16} color={Colors.needleGreen} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </View>
        }
        renderItem={({ item: entry }) => {
          if (entry.kind === 'call') {
            return <CallLifecycleEventCard event={entry.event} />
          }
          if (entry.kind === 'event') {
            return (
              <OrderConversationEventCard
                event={entry.event}
                focused={entry.event.id === focusedEventId}
                onOpenQuote={onConversationAction && entry.event.quoteId
                  ? () => onConversationAction({
                      kind: 'VIEW_QUOTE',
                      label: 'View quote',
                      emphasis: 'SECONDARY',
                      requiresQuoteVersion: true,
                    })
                  : undefined}
              />
            )
          }
          const group = entry.messages
          const item = group[0]
          if (!item) return null
          if (group.length > 1) {
            return (
              <MediaMessageCluster
                messages={group}
                isOwn={item.sender_id === currentUserId}
                avatarUrl={item.sender_id === currentUserId ? null : otherAvatarUrl}
                clusterPosition={conversationPositions.get(item.id) ?? 'isolated'}
                onOpenContextMenu={openContextMenu}
                onOpenMedia={setMediaPreview}
                replyMessage={item.reply_to_id ? (messagesById.get(item.reply_to_id) ?? null) : null}
              />
            )
          }
          return (
            <MessageBubble
              message={item}
              orderId={orderId}
              currentUserRole={currentUserRole}
              isOwn={item.sender_id === currentUserId}
              avatarUrl={item.sender_id === currentUserId ? null : otherAvatarUrl}
              reactions={reactionsByMessageId.get(item.id) ?? []}
              currentUserId={currentUserId}
              onOpenContextMenu={() => openContextMenu(item)}
              onOpenMedia={setMediaPreview}
              onToggleReaction={(emoji) => { void toggleReaction(item, emoji) }}
              replyMessage={item.reply_to_id ? (messagesById.get(item.reply_to_id) ?? null) : null}
              clusterPosition={conversationPositions.get(item.id) ?? 'isolated'}
              mediaClusterMessages={group}
              translation={translations[item.id] ?? null}
              translationLoading={translationLoadingIds.has(item.id)}
              showingOriginal={showOriginalIds.has(item.id)}
              voicePlaybackActive={activeVoiceMessageId === item.id}
              onActivateVoicePlayback={() => setActiveVoiceMessageId(item.id)}
              onDeactivateVoicePlayback={() => setActiveVoiceMessageId((current) => current === item.id ? null : current)}
              onVoicePlaybackFinished={() => setActiveVoiceMessageId(nextVoiceMessageIdById.get(item.id) ?? null)}
              voiceSequenceCount={voiceSequenceCountByStartId.get(item.id) ?? 0}
              onToggleOriginal={() => {
                setShowOriginalIds((current) => {
                  const next = new Set(current)
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })
              }}
            />
          )
        }}
      />

      {threadNotice ? (
        <View style={[styles.threadNotice, threadNotice.tone === 'error' && styles.threadNoticeError]}>
          <Text style={[styles.threadNoticeText, threadNotice.tone === 'error' && styles.threadNoticeTextError]}>
            {threadNotice.text}
          </Text>
          <TouchableOpacity
            style={styles.threadNoticeBtn}
            onPress={() => void fetchMessages({ silent: true })}
            disabled={refreshingThread}
          >
            <Text style={styles.threadNoticeBtnText}>{refreshingThread ? 'Refreshing…' : 'Refresh thread'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Context menu bottom sheet */}
      <MessageContextSheet
        message={contextMenuMessage}
        isOwn={contextMenuMessage?.sender_id === currentUserId}
        visible={contextMenuMessage !== null}
        onDismiss={() => setContextMenuMessage(null)}
        onReply={() => openReplyComposer(contextMenuMessage!)}
        onEdit={() => openEditComposer(contextMenuMessage!)}
        onUnsend={() => { void performUnsend(contextMenuMessage!) }}
        onReport={onReportMessage && contextMenuMessage
          ? () => onReportMessage(contextMenuMessage.id)
          : undefined}
        onTranslate={contextMenuMessage && contextMenuMessage.sender_id !== currentUserId
          ? () => { void requestTranslation(contextMenuMessage, true) }
          : undefined}
        translationLoading={contextMenuMessage ? translationLoadingIds.has(contextMenuMessage.id) : false}
        reactions={contextMenuMessage ? (reactionsByMessageId.get(contextMenuMessage.id) ?? []) : []}
        currentUserId={currentUserId}
        reactionsAvailable={reactionsAvailable}
        onToggleReaction={(emoji) => { if (contextMenuMessage) void toggleReaction(contextMenuMessage, emoji) }}
      />

      <BottomSheetScaffold
        visible={mediaSourceSheetVisible}
        testID="message-media-source-sheet"
        title="Send media"
        subtitle="Choose what you want to add to this conversation."
        onDismiss={() => setMediaSourceSheetVisible(false)}
        scrollable
        snapPoints={['44%']}
        enableDynamicSizing={false}
        secondaryAction={{
          label: 'Cancel',
          onPress: () => setMediaSourceSheetVisible(false),
          accessibilityLabel: 'Cancel adding media',
          tone: 'secondary',
        }}
      >
        <View style={styles.sheetActionList}>
          {([
            ['image', 'Choose from library', 'library'],
            ['camera', 'Take photo', 'camera-photo'],
            ['video', 'Record video', 'camera-video'],
          ] as const).map(([icon, label, source]) => (
            <TouchableOpacity
              key={source}
              style={styles.mediaSourceAction}
              onPress={() => chooseMediaSource(source)}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <View style={styles.mediaSourceActionIcon}>
                <Feather name={icon} size={19} color={Colors.needleGreen} />
              </View>
              <Text style={[styles.sheetActionLabel, styles.mediaSourceActionLabel]}>{label}</Text>
              <Feather name="chevron-right" size={18} color={Colors.midGrey} />
            </TouchableOpacity>
          ))}
        </View>
      </BottomSheetScaffold>

      <MessageMediaPreviewModal
        preview={mediaPreview}
        onDismiss={() => setMediaPreview(null)}
        onOpenItemActions={(item) => {
          const message = item.contextId ? messagesById.get(item.contextId) : null
          if (!message) return
          setMediaPreview(null)
          openContextMenu(message)
        }}
      />

      {/* Locked banner — shown when order is terminal */}
      {locked ? (
        <View style={[styles.lockedBar, { paddingBottom: composerBottomPadding }]}>
          <Text style={styles.lockedText}>{lockedMessage ?? 'This conversation is closed. You can still read previous messages.'}</Text>
        </View>
      ) : (
        <>
          {/* Contact filter warning */}
          {textError ? (
            <View style={styles.filterWarning}>
              <Text style={styles.filterWarningText}>{textError}</Text>
            </View>
          ) : null}

          {/* Rate limit warning */}
          {rateLimited ? (
            <View style={styles.filterWarning}>
              <Text style={styles.filterWarningText}>You're sending messages too quickly. Please wait a moment.</Text>
            </View>
          ) : null}

          {/* Typing indicator */}
          <TypingIndicator visible={counterpartyIsTyping} name={otherName} />

          {/* Reply preview bar */}
          {replyingTo ? (
            <View style={styles.replyBar} testID="message-reply-preview">
              {replyingTo.photo_url ? (
                <View style={styles.replyBarMedia}>
                  {replyingToMediaIsVideo ? (
                    <Feather name="play" size={18} color={Colors.textInverse} />
                  ) : replyingToMediaUrl ? (
                    <RemoteImage
                      uri={replyingToMediaUrl}
                      containerStyle={styles.replyBarMedia}
                      style={styles.replyBarMediaImage}
                      contentFit="cover"
                      transition={80}
                      surface="message_reply_target"
                    />
                  ) : (
                    <ActivityIndicator size="small" color={Colors.midGrey} />
                  )}
                </View>
              ) : null}
              <View style={styles.replyBarContent}>
                <Text style={styles.replyBarAuthor}>{replyingTo.sender_name}</Text>
                <Text style={styles.replyBarBody} numberOfLines={1}>
                  {replyingTo.is_deleted
                    ? 'This message was unsent.'
                    : replyingTo.type === 'PHOTO'
                      ? 'Photo'
                      : replyingTo.type === 'VOICE'
                        ? 'Voice note'
                        : decodeDisplayText(replyingTo.body ?? '')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setReplyingTo(null)}
                style={styles.replyBarDismiss}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
              >
                <Feather name="x" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Edit mode bar */}
          {editingMessage ? (
            <View style={styles.editBar}>
              <Text style={styles.editBarLabel}>Editing message</Text>
              <TouchableOpacity
                onPress={() => { setEditingMessage(null); setText('') }}
                style={styles.editBarDismiss}
                accessibilityRole="button"
                accessibilityLabel="Cancel edit"
              >
                <Feather name="x" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            </View>
          ) : null}

          {draftGuideReferences.length ? (
            <View style={styles.guideDraftList} accessibilityLabel="Guides attached to this draft">
              {draftGuideReferences.map((reference) => (
                <View key={reference.token} style={styles.guideDraftChip}>
                  <Feather name="book-open" size={14} color={Colors.needleGreen} />
                  <Text style={styles.guideDraftTitle} numberOfLines={1}>{reference.guide.title}</Text>
                  <TouchableOpacity
                    onPress={() => setText((current) => removeGuideDraftReference(current, reference.token))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${reference.guide.title} from draft`}
                    style={styles.guideDraftRemove}
                  >
                    <Feather name="x" size={15} color={Colors.midGrey} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          {/* Input bar */}
          <UILibView style={[styles.inputBar, { paddingBottom: composerBottomPadding }]}>
            {isRecording ? (
              <View style={[styles.recordingComposer, showCancelHint && styles.recordingComposerCancel]}>
                <TouchableOpacity
                  style={styles.recordingComposerAction}
                  onPress={cancelLockedRecording}
                  accessibilityRole="button"
                  accessibilityLabel="Discard voice note"
                >
                  <Feather name="trash-2" size={19} color={Colors.kanteRust} />
                </TouchableOpacity>
                <View style={[styles.recordingDot, showCancelHint && styles.recordingDotCancel]} />
                <Text style={[styles.recordingTimer, showCancelHint && styles.recordingTextCancel]}>
                  {`${Math.floor(recordingElapsedSeconds / 60)}:${String(recordingElapsedSeconds % 60).padStart(2, '0')}`}
                </Text>
                <View style={styles.recordingWaveform} accessibilityLabel="Voice recording level">
                  {[8, 15, 11, 20, 13, 17, 9, 19, 12, 16, 8, 14].map((height, index) => (
                    <View
                      key={`${height}:${index}`}
                      style={[styles.recordingWaveBar, { height }, showCancelHint && styles.recordingWaveBarCancel]}
                    />
                  ))}
                </View>
                <View style={styles.recordingInstruction}>
                  <Feather
                    name={recordingLocked ? 'lock' : showCancelHint ? 'trash-2' : 'arrow-up'}
                    size={14}
                    color={showCancelHint ? Colors.kanteRust : Colors.needleGreen}
                  />
                  <Text style={[styles.recordingInstructionText, showCancelHint && styles.recordingTextCancel]} numberOfLines={1}>
                    {showCancelHint
                      ? 'Release to discard'
                      : recordingHolding && !recordingLocked
                        ? '↑ lock · ← cancel'
                        : 'Recording · tap send'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.recordingSendAction}
                  onPress={sendLockedRecording}
                  accessibilityRole="button"
                  accessibilityLabel="Send voice note"
                >
                  <Feather name="arrow-up" size={18} color={Colors.textInverse} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={openPhotoSourceSheet}
              disabled={sending || rateLimited}
              accessibilityRole="button"
              accessibilityLabel="Attach photo"
            >
              <Feather name="paperclip" size={20} color={Colors.needleGreen} />
            </TouchableOpacity>

            <GuidePicker disabled={sending || rateLimited || !!editingMessage} onSelect={guide => setText(previous => [previous, guide].filter(Boolean).join('\n\n'))} />
            <View style={styles.textInputWrap}>
              <TextInput
                ref={composerInputRef}
                style={styles.textInput}
                placeholder="Message…"
                placeholderTextColor={Colors.midGrey}
                value={guideDraftText(text)}
                onChangeText={(v) => {
                  const nextText = updateGuideDraftText(text, v)
                  setText(nextText)
                  if (textError) validateText(nextText)
                  if (channelRef.current) {
                    void channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, isTyping: true } })
                    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current)
                    typingDebounceRef.current = setTimeout(() => {
                      void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, isTyping: false } })
                    }, 2000)
                  }
                }}
                multiline
                maxLength={2000}
                returnKeyType="default"
                testID="message-input"
              />
              {text.length > 1200 ? (
                <Text style={styles.composerCounter}>{text.length}/2000</Text>
              ) : null}
            </View>

            <View style={styles.composerActions}>
              {text.trim() ? (
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={sendText}
                  disabled={sending || !!textError || rateLimited}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                >
                  {sending
                    ? <ActivityIndicator color={Colors.textInverse} size="small" />
                    : <Feather name="arrow-up" size={18} color={Colors.textInverse} />
                  }
                </TouchableOpacity>
              ) : Platform.OS === 'android' ? (
                <TouchableOpacity
                  onPress={() => void startRecording(true)}
                  style={styles.voiceBtn}
                  disabled={sending || rateLimited}
                  accessibilityRole="button"
                  accessibilityLabel="Record voice note"
                  accessibilityHint="Tap to begin, then use the send or discard button"
                >
                  <Feather name="mic" size={20} color={Colors.needleGreen} />
                </TouchableOpacity>
              ) : (
                <Animated.View
                  {...micPanResponder.panHandlers}
                  style={styles.voiceBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Hold to record voice note"
                  accessibilityHint="While holding, slide up to lock or slide left to cancel"
                >
                  <Feather name="mic" size={20} color={Colors.needleGreen} />
                </Animated.View>
              )}
            </View>
              </>
            )}
          </UILibView>

          {callGateMessage ? (
            <View style={styles.callGateCard}>
              <Text style={styles.callGateText}>{callGateMessage}</Text>
              {callGateActionLabel && onPressCallGateAction ? (
                <TouchableOpacity
                  style={styles.callGateAction}
                  onPress={onPressCallGateAction}
                  accessibilityRole="button"
                >
                  <Text style={styles.callGateActionText}>{callGateActionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </>
      )}

    </View>
  )
}

function TypingIndicator({ visible, name }: { visible: boolean; name: string }) {
  const [opacity] = useState(() => new Animated.Value(0))
  const [height] = useState(() => new Animated.Value(0))
  const [dots] = useState(() => [
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ])
  const loopRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.spring(height, {
          toValue: 34,
          damping: 18,
          stiffness: 220,
          mass: 0.8,
          useNativeDriver: false,
        }),
      ]).start()
      const wave = Animated.loop(
        Animated.stagger(115, dots.map((dot) => Animated.sequence([
          Animated.timing(dot, { toValue: -4, duration: 170, useNativeDriver: true }),
          Animated.spring(dot, {
            toValue: 0,
            damping: 9,
            stiffness: 260,
            mass: 0.6,
            useNativeDriver: true,
          }),
          Animated.delay(260),
        ]))),
      )
      loopRef.current = wave
      wave.start()
      return
    }

    loopRef.current?.stop()
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 420, useNativeDriver: false }),
      Animated.timing(height, { toValue: 0, duration: 420, useNativeDriver: false }),
    ]).start()
  }, [dots, height, opacity, visible])

  useEffect(() => () => loopRef.current?.stop(), [])

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.typingRow, { height, opacity }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={visible ? `${name} is typing` : undefined}
    >
      <View style={styles.typingBubble}>
        {dots.map((dot, index) => (
          <Animated.View
            key={index}
            style={[styles.typingDot, { transform: [{ translateY: dot }] }]}
          />
        ))}
      </View>
      <Text style={styles.typingText}>{name}</Text>
    </Animated.View>
  )
}

function OrderConversationEventCard({
  event,
  focused,
  onOpenQuote,
}: {
  event: OrderEvent
  focused: boolean
  onOpenQuote?: () => void
}) {
  const presentation = deriveConversationEventPresentation({
    eventType: event.eventType,
    title: event.title,
    summary: event.summary,
    quoteVersion: event.quoteVersion,
    metadata: event.metadata,
  })
  const icon = {
    quote: 'file-text',
    payment: 'check-circle',
    scope: 'edit-3',
    fabric: 'scissors',
    measurement: 'maximize',
    fulfillment: 'truck',
    remedy: 'shield',
  }[presentation.icon] as ComponentProps<typeof Feather>['name']
  return (
    <View style={[styles.orderEventWrap, focused && styles.orderEventWrapFocused]}>
      <DrapeInlineActionCard
        eyebrow={[presentation.eyebrow, formatPresenceTime(event.createdAt)].join(' · ')}
        title={presentation.title}
        body={presentation.summary ? decodeDisplayText(presentation.summary) : null}
        icon={icon}
      >
        {presentation.facts.length > 0 ? (
          <View style={styles.orderEventFacts}>
            {presentation.facts.map((item, index) => (
              <View
                key={`${item.label}:${item.value}`}
                style={[styles.orderEventFactRow, index > 0 && styles.orderEventFactRowDivided]}
              >
                <Text style={styles.orderEventFactLabel}>{item.label}</Text>
                <Text style={styles.orderEventFactValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.orderEventFooter}>
          <DrapeStatusChip
            label={ORDER_EVENT_LABELS[event.eventType]}
            tone={presentation.tone === 'danger' ? 'danger' : presentation.tone === 'success' ? 'success' : 'info'}
          />
          {onOpenQuote ? (
            <DrapeCapsuleButton label="View quote" compact tone="secondary" onPress={onOpenQuote} />
          ) : null}
        </View>
      </DrapeInlineActionCard>
    </View>
  )
}

function formatLifecycleTime(value: string | null | undefined, timezone?: string | null) {
  return formatExplicitZonedDateTime(value, { timeZone: timezone, fallback: 'Time not set' }) ?? 'Time not set'
}

function googleCalendarUrl(event: CallLifecycleEvent, title: string, reason: string) {
  if (!event.scheduledStartAt) return null
  return buildGoogleCalendarEventUrl({
    startsAt: event.scheduledStartAt,
    durationMinutes: 30,
    title: `Drapeon — ${title}`,
    description: `${reason}. Open Drapeon Messages near the scheduled time to start or join the protected call.`,
  })
}

function CallLifecycleEventCard({ event }: { event: CallLifecycleEvent }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const lifecycle = getCallLifecycleState(event.scheduledStartAt, now)
  if (lifecycle.status === 'unscheduled') return null

  const reason = event.kind === 'consultation'
    ? 'Consultation'
    : callSchedulingReasonFor(event.reason).label
  const isPaymentBlocked = event.paymentRequired === true && event.paymentPaid !== true
  const isExpired =
    event.status === 'EXPIRED' ||
    event.status === 'DECLINED' ||
    event.status === 'COMPLETED' ||
    lifecycle.status === 'expired'
  const scheduledLabel = formatLifecycleTime(event.scheduledStartAt ?? null, event.timezone)
  const title = event.kind === 'consultation' ? 'Consultation call' : 'Scheduled order call'
  const addToCalendar = async () => {
    const url = googleCalendarUrl(event, title, reason)
    if (!url) {
      Alert.alert('Calendar unavailable', 'This call does not have a valid scheduled time yet.')
      return
    }
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Calendar unavailable', 'Drapeon could not open your calendar. Try again from this conversation.')
    }
  }
  const calendarAction = !isExpired ? (
    <TouchableOpacity
      style={styles.callLifecycleCalendarAction}
      onPress={() => { void addToCalendar() }}
      accessibilityRole="button"
      accessibilityLabel="Add this call to calendar"
    >
      <Feather name="calendar" size={16} color={Colors.needleGreen} />
    </TouchableOpacity>
  ) : null

  return (
    <View style={[styles.callLifecycleCard, isExpired && styles.callLifecycleCardExpired]}>
      <View style={styles.callLifecycleHeader}>
        <View style={styles.callLifecycleIcon}>
          <Feather name="video" size={16} color={isExpired ? Colors.midGrey : Colors.needleGreen} />
        </View>
        <View style={styles.callLifecycleTitleWrap}>
          <Text style={styles.callLifecycleEyebrow}>
            {event.kind === 'consultation' ? 'Consultation call' : 'Order call'}
          </Text>
          <Text style={styles.callLifecycleTitle}>{scheduledLabel}</Text>
          <Text style={styles.callLifecycleMeta}>{reason}</Text>
        </View>
      </View>

      {isPaymentBlocked ? (
        <>
          <View style={styles.callLifecyclePaymentBlock}>
            <Text style={styles.callLifecyclePaymentText}>Fee required before the room opens</Text>
            {event.paymentActionLabel && event.onPressPayment ? (
              <TouchableOpacity
                style={styles.callLifecyclePaymentAction}
                onPress={event.onPressPayment}
                accessibilityRole="button"
              >
                <Text style={styles.callLifecyclePaymentActionText}>{event.paymentActionLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {calendarAction}
        </>
      ) : isExpired ? (
        <View style={styles.callLifecycleExpiredBlock}>
          <Text style={styles.callLifecycleExpiredText}>Call Missed / Window Expired</Text>
          {event.onReschedule ? (
            <TouchableOpacity
              style={styles.callLifecycleTextAction}
              onPress={event.onReschedule}
              accessibilityRole="button"
            >
              <Text style={styles.callLifecycleTextActionLabel}>{event.rescheduleLabel ?? 'Reschedule'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : lifecycle.status === 'active' ? (
        <View style={styles.callLifecycleActionsRow}>
          <TouchableOpacity
            style={styles.callLifecyclePrimaryAction}
            onPress={event.onJoinVideo}
            disabled={event.actionLoading || !event.onJoinVideo}
            accessibilityRole="button"
            accessibilityLabel="Join video call now"
          >
            {event.actionLoading ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Text style={styles.callLifecyclePrimaryActionText}>Join call</Text>
            )}
          </TouchableOpacity>
          {calendarAction}
        </View>
      ) : (
        <View style={styles.callLifecycleActionsRow}>
          <View style={styles.callLifecycleDisabledAction}>
            <Text style={styles.callLifecycleDisabledActionText}>
              {formatCallCountdown(lifecycle.msUntilOpen)}
            </Text>
          </View>
          {calendarAction}
        </View>
      )}
    </View>
  )
}

function MediaMessageCluster({
  messages,
  isOwn,
  avatarUrl,
  clusterPosition,
  onOpenContextMenu,
  onOpenMedia,
  replyMessage,
}: {
  messages: Message[]
  isOwn: boolean
  avatarUrl?: string | null
  clusterPosition: ClusterPosition
  onOpenContextMenu: (message: Message) => void
  onOpenMedia: (preview: MessageMediaPreview) => void
  replyMessage: Message | null
}) {
  const mediaUrls = useMessageMediaUrls(messages)
  const firstMessage = messages[0]
  const lastMessage = messages[messages.length - 1]
  if (!firstMessage || !lastMessage) return null
  const continuesSenderTurn = clusterPosition === 'middle' || clusterPosition === 'end'
  const mosaicItems: DrapeMediaMosaicItem[] = messages.map((message, index) => {
    const resolvedUri = mediaUrls.get(message.id) ?? null
    const isVideo = isVideoMediaUrl(message.photo_url) || isVideoMediaUrl(resolvedUri)
    return {
      id: message.id,
      uri: resolvedUri,
      kind: isVideo ? 'video' : 'photo',
      label: `Open ${isVideo ? 'video' : 'photo'} ${index + 1} of ${messages.length}`,
    }
  })

  const time = (parseDateValue(lastMessage.created_at) ?? new Date()).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const receipt = lastMessage.read_at
    ? { text: '✓✓', label: 'Read', style: styles.readReceiptRead }
    : { text: '✓', label: 'Sent', style: styles.readReceiptDelivered }

  return (
    <View style={[
      styles.bubbleRow,
      isOwn && styles.bubbleRowOwn,
      continuesSenderTurn ? styles.bubbleRowClustered : styles.bubbleRowSenderTransition,
    ]}>
      {!isOwn ? (
        <AvatarImage
          uri={avatarUrl}
          initials={firstMessage.sender_name}
          size={32}
          style={styles.messageAvatar}
          borderColor={Colors.white}
          borderWidth={2}
        />
      ) : null}
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, styles.bubbleMedia, styles.mediaMosaicBubble]}>
        {replyMessage ? (
          <View style={[styles.replyQuote, isOwn && styles.replyQuoteOwn]}>
            <Text style={[styles.replyQuoteAuthor, isOwn && styles.replyQuoteAuthorOwn]}>{replyMessage.sender_name}</Text>
            <Text style={[styles.replyQuoteBody, isOwn && styles.replyQuoteBodyOwn]} numberOfLines={2}>
              {replyMessage.is_deleted
                ? 'This message was unsent.'
                : replyMessage.type === 'PHOTO'
                  ? 'Photo'
                  : replyMessage.type === 'VOICE'
                    ? 'Voice note'
                    : decodeDisplayText(replyMessage.body ?? '')}
            </Text>
          </View>
        ) : null}
        <DrapeMediaMosaic
          items={mosaicItems}
          compact
          testID="message-media-mosaic"
          onPressItem={(item, index) => {
            onOpenMedia({
              items: messageMediaPreviewItems(messages, item.id, item.uri),
              index,
            })
          }}
          onLongPressItem={(item) => {
            const message = messages.find((candidate) => candidate.id === item.id)
            if (!message) return
            Vibration.vibrate(12)
            onOpenContextMenu(message)
          }}
        />
        <View style={styles.bubbleMeta}>
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          {isOwn ? (
            <Text style={[styles.readReceipt, receipt.style]} accessibilityLabel={`Message batch ${receipt.label.toLowerCase()}`}>
              {receipt.text} {receipt.label}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function MessageBubble({
  message,
  orderId,
  currentUserRole,
  isOwn,
  avatarUrl,
  reactions,
  currentUserId,
  onOpenContextMenu,
  onOpenMedia,
  onToggleReaction,
  replyMessage,
  clusterPosition = 'isolated',
  mediaClusterMessages,
  translation,
  translationLoading,
  showingOriginal,
  onToggleOriginal,
  voicePlaybackActive,
  onActivateVoicePlayback,
  onDeactivateVoicePlayback,
  onVoicePlaybackFinished,
  voiceSequenceCount,
}: {
  message: Message
  orderId: string
  currentUserRole: 'CUSTOMER' | 'TAILOR'
  isOwn: boolean
  avatarUrl?: string | null
  reactions: MessageReaction[]
  currentUserId: string
  onOpenContextMenu: () => void
  onOpenMedia: (preview: MessageMediaPreview) => void
  onToggleReaction: (emoji: string) => void
  replyMessage: Message | null
  clusterPosition?: ClusterPosition
  mediaClusterMessages: Message[]
  translation: MessageTranslation | null
  translationLoading: boolean
  showingOriginal: boolean
  onToggleOriginal: () => void
  voicePlaybackActive: boolean
  onActivateVoicePlayback: () => void
  onDeactivateVoicePlayback: () => void
  onVoicePlaybackFinished: () => void
  voiceSequenceCount: number
}) {
  const photoUrl = useMessageMediaUrl(message.photo_url)
  const voiceUrl = useMessageMediaUrl(message.voice_url)
  const hasVideoAttachment = !!photoUrl && (isVideoMediaUrl(photoUrl) || isVideoMediaUrl(message.photo_url))
  const isMediaMessage = !!message.photo_url
  const showAvatar = !isOwn && (clusterPosition === 'isolated' || clusterPosition === 'end')
  const showsTail = clusterPosition === 'isolated' || clusterPosition === 'end'
  const continuesSenderTurn = clusterPosition === 'middle' || clusterPosition === 'end'
  const mediaPreviewItems = messageMediaPreviewItems(mediaClusterMessages, message.id, photoUrl)
  const mediaPreviewIndex = Math.max(
    0,
    mediaClusterMessages.findIndex((clusterMessage) => clusterMessage.id === message.id),
  )
  const mediaClusterStyle = isMediaMessage
    ? [
        styles.bubbleMedia,
        clusterPosition === 'start' && (isOwn ? styles.mediaClusterOwnStart : styles.mediaClusterOtherStart),
        clusterPosition === 'middle' && (isOwn ? styles.mediaClusterOwnMiddle : styles.mediaClusterOtherMiddle),
        clusterPosition === 'end' && (isOwn ? styles.mediaClusterOwnEnd : styles.mediaClusterOtherEnd),
      ]
    : null
  const voiceDurationSeconds = (() => {
    if (message.type !== 'VOICE' || !message.body) return null
    const n = parseInt(message.body, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  })()

  const time = (parseDateValue(message.created_at) ?? new Date()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  if (message.is_deleted) {
    return (
      <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn, styles.bubbleRowSenderTransition]}>
        {!isOwn ? (
          <AvatarImage uri={avatarUrl} initials={message.sender_name} size={32} style={styles.messageAvatar} borderColor={Colors.white} borderWidth={2} />
        ) : null}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, styles.bubbleDeleted]}>
          <Text style={[styles.bubbleDeletedText, isOwn && styles.bubbleDeletedTextOwn]}>This message was unsent.</Text>
          <View style={styles.bubbleMeta}>
            <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
          </View>
        </View>
      </View>
    )
  }

  const receipt = message.read_at
    ? { text: '✓✓', label: 'Read', style: styles.readReceiptRead }
    : { text: '✓', label: 'Sent', style: styles.readReceiptDelivered }
  const bodyText = decodeDisplayText(message.body ?? '')
  const displayedBodyText = translation && !showingOriginal ? translation.translatedText : bodyText
  const scheduledOrderCallMessage = message.type === 'TEXT'
    ? parseScheduledOrderCallMessage(message.body)
    : null
  const reactionCounts = MESSAGE_REACTION_OPTIONS.map((emoji) => {
    const matching = reactions.filter((reaction) => reaction.emoji === emoji)
    return {
      emoji,
      count: matching.length,
      selected: matching.some((reaction) => reaction.user_id === currentUserId),
    }
  }).filter(({ count }) => count > 0)

  return (
    <View
      style={[
        styles.bubbleRow,
        isOwn && styles.bubbleRowOwn,
        continuesSenderTurn ? styles.bubbleRowClustered : styles.bubbleRowSenderTransition,
        reactionCounts.length > 0 && styles.bubbleRowWithReaction,
      ]}
    >
      {!isOwn ? (
        showAvatar ? (
          <AvatarImage
            uri={avatarUrl}
            initials={message.sender_name}
            size={32}
            style={styles.messageAvatar}
            borderColor={Colors.white}
            borderWidth={2}
          />
        ) : <View style={styles.messageAvatarSpacer} />
      ) : null}
      <TouchableOpacity
        activeOpacity={0.92}
        onLongPress={onOpenContextMenu}
        accessibilityRole="button"
        accessibilityHint="Long press for message options"
        style={[
          styles.bubble,
          isOwn ? styles.bubbleOwn : styles.bubbleOther,
          clusterPosition === 'start' && (isOwn ? styles.clusterOwnStart : styles.clusterOtherStart),
          clusterPosition === 'middle' && (isOwn ? styles.clusterOwnMiddle : styles.clusterOtherMiddle),
          clusterPosition === 'end' && (isOwn ? styles.clusterOwnEnd : styles.clusterOtherEnd),
          mediaClusterStyle,
        ]}
      >
        {showsTail ? (
          <View
            pointerEvents="none"
            style={[styles.bubbleTail, isOwn ? styles.bubbleTailOwn : styles.bubbleTailOther]}
          />
        ) : null}
        {replyMessage ? (
          <View style={[styles.replyQuote, isOwn && styles.replyQuoteOwn]}>
            <Text style={[styles.replyQuoteAuthor, isOwn && styles.replyQuoteAuthorOwn]}>{replyMessage.sender_name}</Text>
            <Text style={[styles.replyQuoteBody, isOwn && styles.replyQuoteBodyOwn]} numberOfLines={2}>
              {replyMessage.is_deleted
                ? 'This message was unsent.'
                : replyMessage.type === 'PHOTO'
                  ? 'Photo'
                  : replyMessage.type === 'VOICE'
                    ? 'Voice note'
                    : decodeDisplayText(replyMessage.body ?? '')}
            </Text>
          </View>
        ) : null}

        {message.type === 'TEXT' && (
          scheduledOrderCallMessage ? (
            <View
              style={styles.scheduledCallMessage}
              accessible
              accessibilityLabel={`Order call scheduled for ${scheduledOrderCallMessage.scheduledFor}. Reason: ${scheduledOrderCallMessage.reason}.${scheduledOrderCallMessage.note ? ` Note: ${scheduledOrderCallMessage.note}.` : ''} Free in Drapeon.`}
            >
              <View style={styles.scheduledCallMessageHeader}>
                <Feather
                  name="calendar"
                  size={14}
                  color={isOwn ? Colors.textInverse : Colors.needleGreen}
                />
                <Text style={[styles.scheduledCallMessageEyebrow, isOwn && styles.scheduledCallMessageTextOwn]}>
                  Order call scheduled
                </Text>
              </View>
              <Text style={[styles.scheduledCallMessageDate, isOwn && styles.scheduledCallMessageTextOwn]}>
                {scheduledOrderCallMessage.scheduledFor}
              </Text>
              <View style={[styles.scheduledCallMessageRule, isOwn && styles.scheduledCallMessageRuleOwn]} />
              <View style={styles.scheduledCallMessageFactRow}>
                <Text style={[styles.scheduledCallMessageLabel, isOwn && styles.scheduledCallMessageMutedOwn]}>Reason</Text>
                <Text style={[styles.scheduledCallMessageValue, isOwn && styles.scheduledCallMessageTextOwn]}>
                  {scheduledOrderCallMessage.reason}
                </Text>
              </View>
              {scheduledOrderCallMessage.note ? (
                <View style={[styles.scheduledCallMessageNote, isOwn && styles.scheduledCallMessageNoteOwn]}>
                  <Text style={[styles.scheduledCallMessageLabel, isOwn && styles.scheduledCallMessageMutedOwn]}>Note</Text>
                  <Text style={[styles.scheduledCallMessageNoteText, isOwn && styles.scheduledCallMessageTextOwn]}>
                    {scheduledOrderCallMessage.note}
                  </Text>
                </View>
              ) : null}
              <View style={styles.scheduledCallMessageFooter}>
                <Feather
                  name="shield"
                  size={12}
                  color={isOwn ? 'rgba(255,255,255,0.72)' : Colors.midGrey}
                />
                <Text style={[styles.scheduledCallMessageFooterText, isOwn && styles.scheduledCallMessageMutedOwn]}>
                  Free in Drapeon · Keep decisions in chat
                </Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{parseGuideReferences(bodyText).reduce((text, ref) => text.replace(ref.token, ''), displayedBodyText).trim()}</Text>
              <GuideMessageCards body={bodyText} orderId={orderId} currentUserRole={currentUserRole} />
              {translation ? (
                <TouchableOpacity
                  style={styles.translationMeta}
                  onPress={onToggleOriginal}
                  accessibilityRole="button"
                  accessibilityLabel={showingOriginal ? 'View translated message' : 'View original message'}
                >
                  <Feather name="globe" size={11} color={isOwn ? 'rgba(255,255,255,0.68)' : Colors.needleGreen} />
                  <Text style={[styles.translationMetaText, isOwn && styles.translationMetaTextOwn]}>
                    {showingOriginal
                      ? `View ${languageName(translation.targetLanguage)} translation`
                      : `Translated from ${languageName(translation.sourceLanguage)} · View original`}
                  </Text>
                </TouchableOpacity>
              ) : translationLoading ? (
                <View style={styles.translationMeta} accessibilityLabel="Translating message">
                  <ActivityIndicator size="small" color={isOwn ? Colors.textInverse : Colors.needleGreen} />
                  <Text style={[styles.translationMetaText, isOwn && styles.translationMetaTextOwn]}>Translating…</Text>
                </View>
              ) : null}
            </>
          )
        )}

        {message.photo_url && (
          photoUrl && hasVideoAttachment ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => onOpenMedia({ items: mediaPreviewItems, index: mediaPreviewIndex })}
              onLongPress={onOpenContextMenu}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open video message"
              style={styles.bubbleMediaWrap}
            >
              <PortfolioVideoPreview
                uri={photoUrl}
                style={styles.bubblePhoto}
                contentFit="contain"
                nativeControls={false}
                autoplay={false}
                isLooping={false}
              />
              <View style={styles.mediaOpenBadge}>
                <Feather name="maximize-2" size={15} color={Colors.textInverse} />
              </View>
            </TouchableOpacity>
          ) : photoUrl ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => onOpenMedia({ items: mediaPreviewItems, index: mediaPreviewIndex })}
              onLongPress={onOpenContextMenu}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open photo message"
              style={styles.bubbleMediaWrap}
            >
              <RemoteImage
                uri={photoUrl}
                style={styles.bubblePhoto}
                contentFit="cover"
                transition={120}
                surface="message_photo"
                fallback={<View style={[styles.bubblePhoto, styles.photoFallback]} />}
              />
              <View style={styles.mediaOpenBadge}>
                <Feather name="maximize-2" size={15} color={Colors.textInverse} />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={[styles.bubblePhoto, styles.photoFallback]} />
          )
        )}

        {message.type === 'VOICE' ? (
          <>
            <DrapeVoicePlayer
              uri={voiceUrl}
              durationSeconds={voiceDurationSeconds}
              inverse={isOwn}
              isActive={voicePlaybackActive}
              onActivate={onActivateVoicePlayback}
              onDeactivate={onDeactivateVoicePlayback}
              onFinished={onVoicePlaybackFinished}
            />
            {voiceSequenceCount > 1 ? (
              <TouchableOpacity
                style={styles.voiceSequenceAction}
                onPress={onActivateVoicePlayback}
                accessibilityRole="button"
                accessibilityLabel={`Play all ${voiceSequenceCount} consecutive voice notes`}
              >
                <Feather name="play-circle" size={12} color={isOwn ? 'rgba(255,255,255,0.78)' : Colors.needleGreen} />
                <Text style={[styles.voiceSequenceActionText, isOwn && styles.voiceSequenceActionTextOwn]}>
                  Play all {voiceSequenceCount}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}

        {showsTail ? (
          <View style={styles.bubbleMeta}>
            {message.edited_at ? (
              <Text style={[styles.editedTag, isOwn && styles.editedTagOwn]}>(edited)</Text>
            ) : null}
            <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
            {isOwn ? (
              <Text
                style={[styles.readReceipt, receipt.style]}
                accessibilityLabel={'Message ' + receipt.label.toLowerCase()}
              >
                {receipt.text} {receipt.label}
              </Text>
            ) : null}
          </View>
        ) : null}
        {reactionCounts.length > 0 ? (
          <View style={[styles.reactionSummary, isOwn && styles.reactionSummaryOwn]}>
            {reactionCounts.map(({ emoji, count, selected }) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.reactionChip, selected && styles.reactionChipSelected, isOwn && styles.reactionChipOwn]}
                onPress={() => onToggleReaction(emoji)}
                accessibilityRole="button"
                accessibilityLabel={(selected ? 'Remove' : 'Add') + ' ' + emoji + ' reaction'}
              >
                <Text style={[
                  styles.reactionChipText,
                  isOwn && styles.reactionChipTextOwn,
                  selected && styles.reactionChipTextSelected,
                ]}>
                  {emoji} {count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  )
}

function MessageMediaPreviewModal({
  preview,
  onDismiss,
  onOpenItemActions,
}: {
  preview: MessageMediaPreview | null
  onDismiss: () => void
  onOpenItemActions: (item: MediaLightboxItem, index: number) => void
}) {
  return (
    <DrapeMediaViewer
      items={preview?.items ?? []}
      activeIndex={preview?.index ?? null}
      onDismiss={onDismiss}
      onOpenItemActions={onOpenItemActions}
      testID="message-media-viewer"
    />
  )
}

function MessageContextSheet({
  message,
  isOwn,
  visible,
  onDismiss,
  onReply,
  onEdit,
  onUnsend,
  onReport,
  onTranslate,
  translationLoading,
  reactions,
  currentUserId,
  reactionsAvailable,
  onToggleReaction,
}: {
  message: Message | null
  isOwn: boolean
  visible: boolean
  onDismiss: () => void
  onReply: () => void
  onEdit: () => void
  onUnsend: () => void
  onReport?: () => void
  onTranslate?: () => void
  translationLoading: boolean
  reactions: MessageReaction[]
  currentUserId: string
  reactionsAvailable: boolean
  onToggleReaction: (emoji: string) => void
}) {
  if (!message) return null
  const canUnsend = isOwn && !message.is_deleted && isWithin15Minutes(message.created_at)
  const canEdit = isOwn && !message.is_deleted && message.type === 'TEXT'
  const canReply = !message.is_deleted
  const canReact = reactionsAvailable && !message.is_deleted
  const canTranslate = Boolean(onTranslate) && !message.is_deleted && message.type === 'TEXT' && !parseScheduledOrderCallMessage(message.body)
  const actionCount = Number(canReply) + Number(canEdit) + Number(canUnsend) + Number(Boolean(onReport)) + Number(canTranslate)
  const actionSheetSnapPoint = actionCount <= 1 ? '34%' : '46%'
  const previewLabel = message.is_deleted
    ? 'This message was unsent.'
    : message.type === 'PHOTO'
      ? 'Media message'
      : message.type === 'VOICE'
        ? 'Voice note'
        : decodeDisplayText(message.body ?? '')

  return (
    <BottomSheetScaffold
      visible={visible}
      testID="message-actions-sheet"
      title="Message actions"
      subtitle={previewLabel}
      onDismiss={onDismiss}
      scrollable
      snapPoints={[actionSheetSnapPoint]}
      enableDynamicSizing={false}
    >
      {canReact ? (
        <View style={styles.sheetReactionRow}>
          {MESSAGE_REACTION_OPTIONS.map((emoji) => {
            const selected = reactions.some((reaction) => reaction.user_id === currentUserId && reaction.emoji === emoji)
            return (
              <TouchableOpacity
                key={emoji}
                style={[styles.sheetEmojiBtn, selected && styles.sheetEmojiBtnSelected]}
                onPress={() => { onToggleReaction(emoji); onDismiss() }}
                accessibilityRole="button"
                accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${emoji} reaction`}
              >
                <Text style={styles.sheetEmojiText}>{emoji}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}

      <View style={styles.sheetActionList}>
        {canReply ? (
          <TouchableOpacity
            style={styles.sheetActionRow}
            onPress={() => { onReply(); onDismiss() }}
            accessibilityRole="button"
            testID="message-action-reply"
          >
            <Text style={styles.sheetActionLabel}>Reply</Text>
          </TouchableOpacity>
        ) : null}

        {canEdit ? (
          <TouchableOpacity style={styles.sheetActionRow} onPress={() => { onEdit(); onDismiss() }} accessibilityRole="button">
            <Text style={styles.sheetActionLabel}>Edit</Text>
          </TouchableOpacity>
        ) : null}

        {canTranslate ? (
          <TouchableOpacity
            style={styles.sheetActionRow}
            onPress={() => { onTranslate?.(); onDismiss() }}
            accessibilityRole="button"
            accessibilityLabel="Translate this message"
            disabled={translationLoading}
          >
            <View style={styles.sheetActionContent}>
              <Feather name="globe" size={18} color={Colors.needleGreen} />
              <Text style={styles.sheetActionLabel}>{translationLoading ? 'Translating…' : 'Translate'}</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        {canUnsend ? (
          <TouchableOpacity style={styles.sheetActionRow} onPress={() => { onUnsend(); onDismiss() }} accessibilityRole="button">
            <Text style={[styles.sheetActionLabel, styles.sheetActionLabelDestructive]}>Unsend</Text>
          </TouchableOpacity>
        ) : null}
        {onReport ? (
          <TouchableOpacity
            style={styles.sheetActionRow}
            onPress={() => { onReport(); onDismiss() }}
            accessibilityRole="button"
            accessibilityLabel="Report this message"
          >
            <Text style={[styles.sheetActionLabel, styles.sheetActionLabelDestructive]}>Report message</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </BottomSheetScaffold>
  )
}
