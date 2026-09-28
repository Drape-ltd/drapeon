'use client'

import {
  FALLBACK_TRANSLATION_LANGUAGES,
  deriveOrderConversationActions,
  getCallLifecycleState,
  translationTargetFromLocale,
  type ConversationTranslationPreference,
  type MessageTranslation,
  type TranslationLanguage,
} from '@drape/shared'
import type { OrderStage } from '@drape/shared/order-machine'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { safeUserText } from '../../../lib/safe-display'
import { createClient } from '../../../lib/supabase'
import type {
  AccountMessage,
  AccountMessageReaction,
  MessagesRenderData,
} from '../shared/account-data-contracts'
import { QUOTE_NEGOTIATION_UI_ENABLED } from '../shared/account-realtime-config'
import {
  accountRoute,
  activeQuoteForOrder,
  cleanLabel,
  isActiveConversationOrder,
  orderTitle,
  partyAvatar,
  partyKey,
  partyName,
  supportMetaWithConsultationBooking,
  timestampMs,
} from './message-foundation'

type MessageThreadFilter = 'active' | 'completed' | 'archived'

export function currentNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function readArchivedMessageOrderIds(storageKey: string | null) {
  if (!storageKey || typeof window === 'undefined') return new Set<string>()
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    )
  } catch {
    return new Set<string>()
  }
}

export function useMessageThreadState({
  data,
  onRefresh,
}: {
  data: MessagesRenderData
  onRefresh: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedOrderId = searchParams.get('orderId')
  const requestedEventId = searchParams.get('eventId')
  const [realtimeMessages, setRealtimeMessages] = useState<AccountMessage[]>([])
  const [reactionPatchState, setReactionPatchState] = useState<{
    upserts: AccountMessageReaction[]
    deletedIds: Set<string>
  }>({ upserts: [], deletedIds: new Set() })
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'offline'>(
    'connecting'
  )
  const [filter, setFilter] = useState<MessageThreadFilter>('active')
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(() => requestedOrderId)
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<AccountMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<AccountMessage | null>(null)
  const [archiveRevision, setArchiveRevision] = useState(0)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => currentNotificationPermission())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set())
  const [counterpartyIsTyping, setCounterpartyIsTyping] = useState(false)
  const [counterpartyPresence, setCounterpartyPresence] = useState<{
    online: boolean
    lastSeen: Date | null
  }>({ online: false, lastSeen: null })
  const [conversationActionBusy, setConversationActionBusy] = useState(false)
  const [conversationActionError, setConversationActionError] = useState<string | null>(null)
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false)
  const [revisionReasons, setRevisionReasons] = useState<string[]>(['PRICE'])
  const [revisionNote, setRevisionNote] = useState('')
  const [revisionTargetAmount, setRevisionTargetAmount] = useState('')
  const [editingRevision, setEditingRevision] = useState(false)
  const [translationPreference, setTranslationPreference] =
    useState<ConversationTranslationPreference>(() => ({
      autoTranslate: false,
      targetLanguage:
        typeof navigator === 'undefined' ? 'en' : translationTargetFromLocale(navigator.language),
      sourceLanguage: null,
    }))
  const [translationLanguages, setTranslationLanguages] = useState<TranslationLanguage[]>(
    FALLBACK_TRANSLATION_LANGUAGES
  )
  const [messageTranslations, setMessageTranslations] = useState<
    Record<string, MessageTranslation>
  >({})
  const [translationLoadingIds, setTranslationLoadingIds] = useState<Set<string>>(new Set())
  const [translationFailedIds, setTranslationFailedIds] = useState<Set<string>>(new Set())
  const [showOriginalTranslationIds, setShowOriginalTranslationIds] = useState<Set<string>>(
    new Set()
  )
  const [translationSettingsBusy, setTranslationSettingsBusy] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [translationAvailable, setTranslationAvailable] = useState(false)
  const notificationPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported')
  const markedReadRef = useRef<Set<string>>(new Set())
  const orderChannelRef = useRef<RealtimeChannel | null>(null)
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const orderIds = useMemo(() => data.orders.map((order) => order.id), [data.orders])
  const ordersById = useMemo(
    () => new Map(data.orders.map((order) => [order.id, order])),
    [data.orders]
  )
  const archiveStorageKey = data.userId
    ? `drapeon:web:archived-message-orders:${data.userId}`
    : null
  const archivedOrderIds = useMemo(() => {
    void archiveRevision
    return readArchivedMessageOrderIds(archiveStorageKey)
  }, [archiveRevision, archiveStorageKey])
  const liveMessages = useMemo(() => {
    const seen = new Set<string>()
    return [...realtimeMessages, ...data.messages].filter((message) => {
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [data.messages, realtimeMessages])
  const liveReactionMessageIds = useMemo(
    () => new Set(liveMessages.map((message) => message.id)),
    [liveMessages]
  )
  const liveReactions = useMemo(() => {
    const reactions = new Map<string, AccountMessageReaction>()
    for (const reaction of data.reactions) {
      if (
        !liveReactionMessageIds.has(reaction.message_id) ||
        reactionPatchState.deletedIds.has(reaction.id)
      )
        continue
      reactions.set(reaction.id, reaction)
    }
    for (const reaction of reactionPatchState.upserts) {
      if (
        !liveReactionMessageIds.has(reaction.message_id) ||
        reactionPatchState.deletedIds.has(reaction.id)
      )
        continue
      reactions.set(reaction.id, reaction)
    }
    return [...reactions.values()]
  }, [data.reactions, liveReactionMessageIds, reactionPatchState])
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, AccountMessageReaction[]>()
    for (const reaction of liveReactions) {
      const current = map.get(reaction.message_id) ?? []
      current.push(reaction)
      map.set(reaction.message_id, current)
    }
    return map
  }, [liveReactions])

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission
  }, [notificationPermission])

  useEffect(() => {
    if (orderIds.length === 0) {
      return
    }
    const supabase = createClient()
    const orderIdSet = new Set(orderIds)
    const channel = supabase
      .channel(`account-messages:${data.userId ?? 'anonymous'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const next = payload.new as AccountMessage
          if (!orderIdSet.has(next.order_id)) return
          setRealtimeMessages((current) =>
            current.some((message) => message.id === next.id) ? current : [next, ...current]
          )
          const threadOrder = ordersById.get(next.order_id)
          if (
            typeof window !== 'undefined' &&
            notificationPermissionRef.current === 'granted' &&
            next.sender_id !== data.userId &&
            document.visibilityState !== 'visible'
          ) {
            const notice = new Notification(
              `New message: ${threadOrder ? orderTitle(threadOrder) : 'Order thread'}`,
              {
                body: safeUserText(
                  next.body,
                  next.photo_url || next.voice_url ? 'New media message' : 'New order message'
                ),
                icon: '/icon-192.png',
              }
            )
            notice.onclick = () => {
              window.focus()
              setSelectedOrderId(next.order_id)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const next = payload.new as AccountMessageReaction
          if (!orderIdSet.has(next.order_id)) return
          setReactionPatchState((current) => {
            const deletedIds = new Set(current.deletedIds)
            deletedIds.delete(next.id)
            return {
              deletedIds,
              upserts: [...current.upserts.filter((reaction) => reaction.id !== next.id), next],
            }
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const old = payload.old as Partial<AccountMessageReaction>
          if (!old.id) return
          setReactionPatchState((current) => {
            const deletedIds = new Set(current.deletedIds)
            deletedIds.add(old.id!)
            return {
              deletedIds,
              upserts: current.upserts.filter((reaction) => reaction.id !== old.id),
            }
          })
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(
          status === 'SUBSCRIBED'
            ? 'live'
            : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'
              ? 'offline'
              : 'connecting'
        )
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [data.userId, orderIds, ordersById])

  // Per-order channel for presence + typing (torn down when thread changes)
  useEffect(() => {
    if (!selectedOrderId || !data.userId) {
      const resetTimer = window.setTimeout(() => {
        setCounterpartyIsTyping(false)
        setCounterpartyPresence({ online: false, lastSeen: null })
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const supabaseClient = createClient()
    const ch = supabaseClient
      .channel(`messages:${selectedOrderId}`)
      .on(
        'broadcast',
        { event: 'typing' },
        ({ payload }: { payload: { userId: string; isTyping: boolean } }) => {
          if (payload.userId === data.userId) return
          setCounterpartyIsTyping(!!payload.isTyping)
          if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current)
          if (payload.isTyping) {
            typingClearTimerRef.current = setTimeout(() => setCounterpartyIsTyping(false), 4000)
          }
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState<{ userId: string }>()
        const others = Object.values(state)
          .flat()
          .filter((p) => p.userId !== data.userId)
        const isOnline = others.length > 0
        setCounterpartyPresence((prev) => ({
          online: isOnline,
          lastSeen: isOnline ? null : prev.online ? new Date() : prev.lastSeen,
        }))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ userId: data.userId })
        }
      })

    orderChannelRef.current = ch

    function handleVisibility() {
      if (document.hidden) {
        void ch.untrack()
      } else {
        void ch.track({ userId: data.userId! })
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current)
      void supabaseClient.removeChannel(ch)
      orderChannelRef.current = null
      setCounterpartyIsTyping(false)
      setCounterpartyPresence({ online: false, lastSeen: null })
    }
  }, [selectedOrderId, data.userId])

  function persistArchived(next: Set<string>) {
    if (archiveStorageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(archiveStorageKey, JSON.stringify([...next]))
    }
  }

  function setThreadArchived(orderId: string, archived: boolean) {
    const order = ordersById.get(orderId)
    if (archived && order && isActiveConversationOrder(order, data.userId)) {
      setConversationActionError('Ongoing order conversations cannot be archived.')
      return
    }
    const next = new Set(archivedOrderIds)
    if (archived) next.add(orderId)
    else next.delete(orderId)
    persistArchived(next)
    setArchiveRevision((current) => current + 1)
    setSelectedOrderId(null)
    setFilter(
      archived
        ? 'archived'
        : order && isActiveConversationOrder(order, data.userId)
          ? 'active'
          : 'completed'
    )
  }

  async function requestNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const threads = useMemo(() => {
    return data.orders
      .map((order) => {
        const messages = liveMessages
          .filter((message) => message.order_id === order.id)
          .sort((a, b) => timestampMs(b.created_at) - timestampMs(a.created_at))
        const latest = messages[0] ?? null
        const unread = messages.filter(
          (message) =>
            message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id)
        ).length
        const archived = archivedOrderIds.has(order.id)
        const completed = !isActiveConversationOrder(order, data.userId)
        return {
          order,
          messages,
          latest,
          unread,
          archived,
          completed,
          searchable: [
            orderTitle(order),
            partyName(order, data.userId),
            cleanLabel(order.stage, 'Order'),
            safeUserText(latest?.body, ''),
          ]
            .join(' ')
            .toLowerCase(),
        }
      })
      .sort((a, b) => {
        if (a.unread > 0 && b.unread === 0) return -1
        if (b.unread > 0 && a.unread === 0) return 1
        const aTime = timestampMs(a.latest?.created_at ?? a.order.updated_at ?? a.order.created_at)
        const bTime = timestampMs(b.latest?.created_at ?? b.order.updated_at ?? b.order.created_at)
        return bTime - aTime
      })
  }, [archivedOrderIds, data.orders, data.userId, liveMessages, localReadIds])
  const normalizedSearch = search.trim().toLowerCase()
  const activeThreads = threads.filter((thread) => !thread.archived && !thread.completed)
  const completedThreads = threads.filter((thread) => !thread.archived && thread.completed)
  const archivedThreads = threads.filter((thread) => thread.archived)
  const baseThreads =
    filter === 'active'
      ? activeThreads
      : filter === 'completed'
        ? completedThreads
        : archivedThreads
  const filteredThreads = baseThreads.filter(
    (thread) => !normalizedSearch || thread.searchable.includes(normalizedSearch)
  )

  const groups = (() => {
    const map = new Map<
      string,
      { key: string; name: string; avatarSrc: string | null; threads: typeof filteredThreads }
    >()
    for (const thread of filteredThreads) {
      const key = partyKey(thread.order, data.userId)
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: partyName(thread.order, data.userId),
          avatarSrc: partyAvatar(thread.order, data.userId),
          threads: [],
        })
      }
      map.get(key)!.threads.push(thread)
    }
    return [...map.values()]
      .map((group) => {
        const unread = group.threads.reduce((sum, t) => sum + t.unread, 0)
        const latestTime = Math.max(
          ...group.threads.map((t) =>
            timestampMs(t.latest?.created_at ?? t.order.updated_at ?? t.order.created_at)
          )
        )
        const latestPreview = group.threads.reduce<(typeof threads)[0]['latest']>((best, t) => {
          if (!best) return t.latest
          if (!t.latest) return best
          return timestampMs(t.latest.created_at) > timestampMs(best.created_at) ? t.latest : best
        }, null)
        return { ...group, unread, latestTime, latestPreview }
      })
      .sort((a, b) => {
        if (a.unread > 0 && b.unread === 0) return -1
        if (b.unread > 0 && a.unread === 0) return 1
        return b.latestTime - a.latestTime
      })
  })()

  const selectedThread = threads.find((thread) => thread.order.id === selectedOrderId) ?? null
  const selectedActiveQuote = selectedThread
    ? activeQuoteForOrder(data.quotes, selectedThread.order.id)
    : null
  const selectedOpenRevision = selectedThread
    ? (data.quoteRevisions.find(
        (revision) => revision.order_id === selectedThread.order.id && revision.status === 'OPEN'
      ) ?? null)
    : null
  const selectedNegotiationRoundsUsed = selectedThread
    ? Math.max(
        0,
        ...data.quoteRevisions
          .filter((revision) => revision.order_id === selectedThread.order.id)
          .map((revision) => revision.round_number)
      )
    : 0
  const selectedConversationActions = useMemo(() => {
    if (
      !QUOTE_NEGOTIATION_UI_ENABLED ||
      !selectedThread ||
      selectedThread.order.order_kind !== 'CUSTOM'
    ) {
      return null
    }
    const role = selectedThread.order.customer_id === data.userId ? 'CUSTOMER' : 'TAILOR'
    return deriveOrderConversationActions({
      role,
      orderKind: 'CUSTOM',
      stage: (selectedThread.order.stage ?? 'PENDING_QUOTE') as OrderStage,
      activeQuote: selectedActiveQuote
        ? {
            id: selectedActiveQuote.id,
            version: selectedActiveQuote.version,
            status: selectedActiveQuote.status,
          }
        : null,
      openRevision: selectedOpenRevision
        ? {
            id: selectedOpenRevision.id,
            status: selectedOpenRevision.status,
            roundNumber: selectedOpenRevision.round_number,
          }
        : null,
      negotiationRoundsUsed: selectedNegotiationRoundsUsed,
      negotiationRoundLimit: 3,
      paymentStarted: ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(
        selectedThread.order.stage ?? ''
      ),
    })
  }, [
    data.userId,
    selectedActiveQuote,
    selectedNegotiationRoundsUsed,
    selectedOpenRevision,
    selectedThread,
  ])
  const selectedMessages = useMemo(
    () =>
      selectedThread
        ? [...selectedThread.messages].sort(
            (a, b) => timestampMs(a.created_at) - timestampMs(b.created_at)
          )
        : [],
    [selectedThread]
  )
  const selectedConsultationBooking = selectedThread
    ? ((data.consultationBookings ?? []).find(
        (booking) => booking.order_id === selectedThread.order.id
      ) ?? null)
    : null
  const selectedCallMeta = selectedThread
    ? supportMetaWithConsultationBooking(
        selectedThread.order.special_note,
        selectedConsultationBooking
      )
    : null
  const selectedScheduledCall =
    selectedCallMeta?.consultation?.scheduledStartAt &&
    selectedCallMeta.consultation.status === 'SCHEDULED'
      ? selectedCallMeta.consultation
      : selectedCallMeta?.orderCall?.scheduledStartAt &&
          selectedCallMeta.orderCall.status === 'SCHEDULED'
        ? selectedCallMeta.orderCall
        : null
  const selectedCallLifecycle = (() => {
    if (!selectedThread) return null
    return selectedScheduledCall?.scheduledStartAt
      ? getCallLifecycleState(selectedScheduledCall.scheduledStartAt)
      : null
  })()
  const selectedCallType = selectedCallMeta?.consultation?.callType === 'AUDIO' ? 'audio' : 'video'
  const selectedCallKind =
    selectedCallMeta?.consultation?.scheduledStartAt &&
    selectedCallMeta.consultation.status === 'SCHEDULED'
      ? 'consultation'
      : 'ready-made'
  const selectedCallPaymentBlocked = Boolean(
    selectedCallMeta?.consultation?.feeAmount && !selectedCallMeta.consultation.paidAt
  )
  const selectedCanJoinCall = Boolean(
    selectedThread &&
    selectedScheduledCall &&
    isActiveConversationOrder(selectedThread.order, data.userId) &&
    selectedCallLifecycle?.status === 'active' &&
    !selectedCallPaymentBlocked
  )
  const selectedCallHref = selectedThread
    ? accountRoute(
        `/account/call-join?orderId=${encodeURIComponent(selectedThread.order.id)}&callKind=${selectedCallKind}&callType=${selectedCallType}`
      )
    : null
  return {
    router,
    searchParams,
    requestedOrderId,
    requestedEventId,
    realtimeMessages,
    setRealtimeMessages,
    reactionPatchState,
    setReactionPatchState,
    realtimeStatus,
    setRealtimeStatus,
    filter,
    setFilter,
    search,
    setSearch,
    selectedOrderId,
    setSelectedOrderId,
    openReactionMessageId,
    setOpenReactionMessageId,
    hoveredMessageId,
    setHoveredMessageId,
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    archiveRevision,
    setArchiveRevision,
    markingAllRead,
    setMarkingAllRead,
    localReadIds,
    setLocalReadIds,
    notificationPermission,
    setNotificationPermission,
    sidebarCollapsed,
    setSidebarCollapsed,
    expandedGroupKeys,
    setExpandedGroupKeys,
    counterpartyIsTyping,
    setCounterpartyIsTyping,
    counterpartyPresence,
    setCounterpartyPresence,
    conversationActionBusy,
    setConversationActionBusy,
    conversationActionError,
    setConversationActionError,
    revisionDialogOpen,
    setRevisionDialogOpen,
    revisionReasons,
    setRevisionReasons,
    revisionNote,
    setRevisionNote,
    revisionTargetAmount,
    setRevisionTargetAmount,
    editingRevision,
    setEditingRevision,
    translationPreference,
    setTranslationPreference,
    translationLanguages,
    setTranslationLanguages,
    messageTranslations,
    setMessageTranslations,
    translationLoadingIds,
    setTranslationLoadingIds,
    translationFailedIds,
    setTranslationFailedIds,
    showOriginalTranslationIds,
    setShowOriginalTranslationIds,
    translationSettingsBusy,
    setTranslationSettingsBusy,
    translationError,
    setTranslationError,
    translationAvailable,
    setTranslationAvailable,
    notificationPermissionRef,
    markedReadRef,
    orderChannelRef,
    typingClearTimerRef,
    messageListRef,
    orderIds,
    ordersById,
    archiveStorageKey,
    archivedOrderIds,
    liveMessages,
    liveReactionMessageIds,
    liveReactions,
    reactionsByMessageId,
    persistArchived,
    setThreadArchived,
    requestNotifications,
    threads,
    normalizedSearch,
    activeThreads,
    completedThreads,
    archivedThreads,
    baseThreads,
    filteredThreads,
    groups,
    selectedThread,
    selectedActiveQuote,
    selectedOpenRevision,
    selectedNegotiationRoundsUsed,
    selectedConversationActions,
    selectedMessages,
    selectedConsultationBooking,
    selectedCallMeta,
    selectedScheduledCall,
    selectedCallLifecycle,
    selectedCallType,
    selectedCallKind,
    selectedCallPaymentBlocked,
    selectedCanJoinCall,
    selectedCallHref,
  }
}
