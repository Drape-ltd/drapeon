'use client'

import {
  conversationClusterPositionForMessage,
  groupMessageMediaClusters,
  languageName,
  parseDateValue,
  parseScheduledOrderCallMessage,
  type ConversationTranslationPreference,
  type MessageTranslation,
  type OrderConversationAction,
  type TranslationLanguage,
} from '@drape/shared'
import { friendlyActionError } from '@drape/shared/action-errors'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  CalendarDays,
  CheckCheck,
  Languages,
  LoaderCircle,
  Pencil,
  Reply,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo } from 'react'
import { Button } from '../../../components/ui/button'
import { IconButton } from '../../../components/ui/icon-button'
import { safeUserText } from '../../../lib/safe-display'
import { createClient } from '../../../lib/supabase'
import type {
  AccountMessage,
  AccountMessageReaction,
  MessagesRenderData,
} from '../shared/account-data-contracts'
import { invokeAccountFunction } from '../shared/account-data-queries'
import {
  EmptyState,
  MessageContent,
  MessageMediaMosaic,
  MessageReactionBar,
  accountRoute,
  formatMessageRelative,
  parseMinorUnits,
  timestampMs,
} from './message-foundation'
import { useMessageThreadState } from './message-thread-state'
import { MessagesWorkspaceView } from './messages-workspace-view'
export { currentNotificationPermission } from './message-thread-state'
export { OrderConversationEventCard } from './messages-workspace-view'

export function useMessagesWorkspaceController({
  data,
  onRefresh,
}: {
  data: MessagesRenderData
  onRefresh: () => void
}) {
  const {
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
  } = useMessageThreadState({ data, onRefresh })

  useEffect(() => {
    setMessageTranslations({})
    setShowOriginalTranslationIds(new Set())
    setTranslationFailedIds(new Set())
  }, [translationPreference.sourceLanguage, translationPreference.targetLanguage])

  useEffect(() => {
    if (!selectedOrderId) {
      setTranslationAvailable(false)
      return
    }
    let active = true
    setTranslationAvailable(false)
    setTranslationError(null)
    void Promise.all([
      invokeAccountFunction<{ preference?: ConversationTranslationPreference }>(
        'message-translation',
        {
          action: 'settings',
          orderId: selectedOrderId,
        }
      ),
      invokeAccountFunction<{ languages?: TranslationLanguage[] }>('message-translation', {
        action: 'languages',
        orderId: selectedOrderId,
      }),
    ])
      .then(([settings, languageResult]) => {
        if (!active) return
        setTranslationAvailable(true)
        if (settings.preference) setTranslationPreference(settings.preference)
        if (languageResult.languages?.length) setTranslationLanguages(languageResult.languages)
      })
      .catch((error) => {
        if (!active) return
        setTranslationAvailable(false)
        setTranslationError(
          friendlyActionError(
            error,
            'Message translation is unavailable right now. Your original messages are unchanged.'
          )
        )
      })
    return () => {
      active = false
    }
  }, [selectedOrderId])

  const saveTranslationPreference = useCallback(
    async (next: ConversationTranslationPreference) => {
      if (!selectedOrderId) return
      const previous = translationPreference
      setTranslationPreference(next)
      setTranslationSettingsBusy(true)
      setTranslationError(null)
      try {
        const result = await invokeAccountFunction<{
          preference?: ConversationTranslationPreference
        }>('message-translation', {
          action: 'update-settings',
          orderId: selectedOrderId,
          ...next,
        })
        if (result.preference) setTranslationPreference(result.preference)
      } catch (error) {
        setTranslationPreference(previous)
        setTranslationError(friendlyActionError(error, 'Could not save translation settings.'))
      } finally {
        setTranslationSettingsBusy(false)
      }
    },
    [selectedOrderId, translationPreference]
  )

  const translateAccountMessage = useCallback(
    async (message: AccountMessage, announceError: boolean) => {
      if (
        !selectedOrderId ||
        message.type !== 'TEXT' ||
        message.is_deleted ||
        !message.body ||
        parseScheduledOrderCallMessage(message.body)
      )
        return
      if (messageTranslations[message.id] || translationLoadingIds.has(message.id)) return
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
        const result = await Promise.race([
          invokeAccountFunction<{ translation?: MessageTranslation }>('message-translation', {
            action: 'translate',
            orderId: selectedOrderId,
            messageId: message.id,
            targetLanguage: translationPreference.targetLanguage,
            sourceLanguage: translationPreference.sourceLanguage,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Translation took too long. Please try again.')),
              20_000
            )
          }),
        ])
        if (!result.translation) throw new Error('This message could not be translated right now.')
        setMessageTranslations((current) => ({ ...current, [message.id]: result.translation! }))
        setShowOriginalTranslationIds((current) => {
          const next = new Set(current)
          next.delete(message.id)
          return next
        })
      } catch (error) {
        setTranslationFailedIds((current) => new Set(current).add(message.id))
        if (announceError)
          setTranslationError(
            friendlyActionError(error, 'This message could not be translated right now.')
          )
      } finally {
        setTranslationLoadingIds((current) => {
          const next = new Set(current)
          next.delete(message.id)
          return next
        })
      }
    },
    [
      messageTranslations,
      selectedOrderId,
      translationFailedIds,
      translationLoadingIds,
      translationPreference.sourceLanguage,
      translationPreference.targetLanguage,
    ]
  )

  useEffect(() => {
    if (!translationAvailable || !translationPreference.autoTranslate) return
    selectedMessages
      .filter(
        (message) =>
          message.sender_id !== data.userId &&
          message.type === 'TEXT' &&
          !message.is_deleted &&
          !!message.body &&
          !parseScheduledOrderCallMessage(message.body) &&
          !messageTranslations[message.id] &&
          !translationFailedIds.has(message.id) &&
          !translationLoadingIds.has(message.id)
      )
      .slice(-30)
      .forEach((message) => {
        void translateAccountMessage(message, false)
      })
  }, [
    data.userId,
    messageTranslations,
    selectedMessages,
    translateAccountMessage,
    translationAvailable,
    translationFailedIds,
    translationLoadingIds,
    translationPreference.autoTranslate,
  ])
  const selectedMessageGroups = useMemo(
    () =>
      groupMessageMediaClusters(
        selectedMessages.map((message) => ({
          ...message,
          sender_id: message.sender_id ?? '',
        }))
      ),
    [selectedMessages]
  )
  const selectedConversationPositions = useMemo(() => {
    const clusterable = selectedMessages.map((message) => ({
      ...message,
      sender_id: message.sender_id ?? '',
    }))
    return new Map(
      selectedMessages.map((message, index) => [
        message.id,
        conversationClusterPositionForMessage(clusterable, index),
      ])
    )
  }, [selectedMessages])
  const selectedOrderEvents = useMemo(
    () =>
      selectedThread
        ? data.orderEvents.filter((event) => event.order_id === selectedThread.order.id)
        : [],
    [data.orderEvents, selectedThread]
  )
  const conversationItems = useMemo(() => {
    const messageItems = selectedMessageGroups.map((group) => ({
      kind: 'messages' as const,
      key: group.map((message) => message.id).join(':'),
      createdAt: group.at(-1)?.created_at ?? null,
      group,
    }))
    const eventItems = selectedOrderEvents.map((event) => ({
      kind: 'event' as const,
      key: `event:${event.id}`,
      createdAt: event.created_at,
      event,
    }))
    return [...messageItems, ...eventItems].sort(
      (left, right) => timestampMs(left.createdAt) - timestampMs(right.createdAt)
    )
  }, [selectedMessageGroups, selectedOrderEvents])
  const messageVirtualizer = useVirtualizer({
    count: conversationItems.length,
    getScrollElement: () => messageListRef.current,
    estimateSize: (index) => {
      const item = conversationItems[index]
      if (!item) return 86
      if (item.kind === 'event') return 122
      const group = item.group
      const message = group.at(-1)
      if (group.length > 1) return 390
      if (message?.voice_url) return 112
      if (message?.photo_url) return 300
      return 86
    },
    getItemKey: (index) => conversationItems[index]?.key ?? index,
    overscan: 8,
  })

  useEffect(() => {
    if (!selectedOrderId || conversationItems.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      const requestedIndex = requestedEventId
        ? conversationItems.findIndex(
            (item) => item.kind === 'event' && item.event.id === requestedEventId
          )
        : -1
      messageVirtualizer.scrollToIndex(
        requestedIndex >= 0 ? requestedIndex : conversationItems.length - 1,
        { align: requestedIndex >= 0 ? 'center' : 'end' }
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [conversationItems, messageVirtualizer, requestedEventId, selectedOrderId])
  const selectedUnreadIds = selectedMessages
    .filter(
      (message) =>
        data.userId &&
        message.sender_id !== data.userId &&
        !message.read_at &&
        !localReadIds.has(message.id)
    )
    .map((message) => message.id)
  const selectedUnreadKey = selectedUnreadIds.join('|')
  const unreadMessageIds = useMemo(() => {
    if (!data.userId) return []
    return liveMessages
      .filter(
        (message) =>
          message.sender_id !== data.userId && !message.read_at && !localReadIds.has(message.id)
      )
      .map((message) => message.id)
  }, [data.userId, liveMessages, localReadIds])
  const totalUnread = unreadMessageIds.length

  useEffect(() => {
    if (!data.userId || !selectedUnreadKey) return
    const ids = selectedUnreadKey.split('|').filter((id) => id && !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    const supabase = createClient()
    void supabase
      .from('messages')
      .update({ read_at: now })
      .in('id', ids)
      .then(({ error }) => {
        if (error) {
          ids.forEach((id) => markedReadRef.current.delete(id))
          setLocalReadIds((current) => {
            const next = new Set(current)
            ids.forEach((id) => next.delete(id))
            return next
          })
          return
        }
        onRefresh()
      })
  }, [data.userId, onRefresh, selectedUnreadKey])

  async function markAllRead() {
    if (!data.userId || unreadMessageIds.length === 0 || markingAllRead) return
    const ids = unreadMessageIds.filter((id) => !markedReadRef.current.has(id))
    if (ids.length === 0) return
    const now = new Date().toISOString()
    setMarkingAllRead(true)
    ids.forEach((id) => markedReadRef.current.add(id))
    setLocalReadIds((current) => new Set([...current, ...ids]))
    try {
      const supabase = createClient()
      const { error } = await supabase.from('messages').update({ read_at: now }).in('id', ids)
      if (error) throw error
      onRefresh()
    } catch (readError) {
      console.warn('[messages] Mark all read failed.', readError)
      ids.forEach((id) => markedReadRef.current.delete(id))
      setLocalReadIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } finally {
      setMarkingAllRead(false)
    }
  }

  function openQuoteRevisionDialog(editing: boolean) {
    setConversationActionError(null)
    setEditingRevision(editing)
    setRevisionReasons(
      editing && selectedOpenRevision?.reason_codes.length
        ? selectedOpenRevision.reason_codes
        : ['PRICE']
    )
    setRevisionNote(editing ? (selectedOpenRevision?.note ?? '') : '')
    setRevisionTargetAmount(
      editing && selectedOpenRevision?.target_amount
        ? String(selectedOpenRevision.target_amount / 100)
        : ''
    )
    setRevisionDialogOpen(true)
  }

  async function submitQuoteRevision() {
    if (!selectedThread || !selectedActiveQuote) return
    if (revisionNote.trim().length < 10) {
      setConversationActionError('Add at least 10 characters explaining what should change.')
      return
    }
    const targetAmount = revisionTargetAmount.trim() ? parseMinorUnits(revisionTargetAmount) : null
    if (revisionTargetAmount.trim() && targetAmount === null) {
      setConversationActionError('Enter a valid target amount or leave it blank.')
      return
    }

    setConversationActionBusy(true)
    setConversationActionError(null)
    try {
      await invokeAccountFunction('customer-order-action', {
        action: editingRevision ? 'edit-quote-revision' : 'request-quote-revision',
        orderId: selectedThread.order.id,
        quoteId: selectedActiveQuote.id,
        expectedQuoteVersion: selectedActiveQuote.version,
        ...(editingRevision && selectedOpenRevision
          ? { revisionRequestId: selectedOpenRevision.id }
          : {}),
        quoteRevisionReasons: revisionReasons,
        quoteRevisionNote: revisionNote.trim(),
        quoteTargetAmount: targetAmount,
      })
      setRevisionDialogOpen(false)
      onRefresh()
    } catch (actionError) {
      setConversationActionError(
        friendlyActionError(
          actionError,
          'The quote change request could not be saved. Refresh the conversation and try again.'
        )
      )
    } finally {
      setConversationActionBusy(false)
    }
  }

  async function handleConversationAction(action: OrderConversationAction) {
    if (!selectedThread) return
    setConversationActionError(null)

    if (action.kind === 'REQUEST_QUOTE_CHANGES') {
      openQuoteRevisionDialog(false)
      return
    }
    if (action.kind === 'EDIT_QUOTE_CHANGE_REQUEST') {
      openQuoteRevisionDialog(true)
      return
    }
    if (action.kind === 'ACCEPT_AND_PAY') {
      router.push(accountRoute(`/account/checkout?orderId=${selectedThread.order.id}`))
      return
    }
    if (action.kind === 'VIEW_QUOTE') {
      router.push(accountRoute(`/account/orders/${selectedThread.order.id}`))
      return
    }

    if (action.kind === 'WITHDRAW_QUOTE_CHANGE_REQUEST' || action.kind === 'KEEP_CURRENT_QUOTE') {
      if (!selectedActiveQuote || !selectedOpenRevision) {
        setConversationActionError(
          'The quote changed. Refresh this conversation before taking that action.'
        )
        return
      }
      setConversationActionBusy(true)
      try {
        await invokeAccountFunction(
          action.kind === 'WITHDRAW_QUOTE_CHANGE_REQUEST'
            ? 'customer-order-action'
            : 'tailor-order-action',
          {
            action:
              action.kind === 'WITHDRAW_QUOTE_CHANGE_REQUEST'
                ? 'withdraw-quote-revision'
                : 'keep-current-quote',
            orderId: selectedThread.order.id,
            quoteId: selectedActiveQuote.id,
            expectedQuoteVersion: selectedActiveQuote.version,
            revisionRequestId: selectedOpenRevision.id,
          }
        )
        onRefresh()
      } catch (actionError) {
        setConversationActionError(
          friendlyActionError(
            actionError,
            'The order action could not be completed. Refresh the conversation and try again.'
          )
        )
      } finally {
        setConversationActionBusy(false)
      }
      return
    }

    router.push(accountRoute(`/account/orders/${selectedThread.order.id}`))
  }

  async function toggleMessageReaction(message: AccountMessage, emoji: string) {
    if (!data.userId) return
    const existing = liveReactions.find(
      (reaction) =>
        reaction.message_id === message.id &&
        reaction.user_id === data.userId &&
        reaction.emoji === emoji
    )
    const supabase = createClient()

    if (existing) {
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(existing.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== existing.id),
        }
      })
      const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id)
      if (error) {
        console.warn('[messages] Reaction delete failed.', error.message)
        setReactionPatchState((current) => {
          const deletedIds = new Set(current.deletedIds)
          deletedIds.delete(existing.id)
          return {
            deletedIds,
            upserts: [
              ...current.upserts.filter((reaction) => reaction.id !== existing.id),
              existing,
            ],
          }
        })
      }
      return
    }

    const tempReaction: AccountMessageReaction = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `local-${Date.now()}`,
      message_id: message.id,
      order_id: message.order_id,
      user_id: data.userId,
      emoji,
      created_at: new Date().toISOString(),
    }
    setReactionPatchState((current) => ({
      deletedIds: new Set([...current.deletedIds].filter((id) => id !== tempReaction.id)),
      upserts: [...current.upserts, tempReaction],
    }))
    const { data: inserted, error } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        order_id: message.order_id,
        user_id: data.userId,
        emoji,
      })
      .select('id, message_id, order_id, user_id, emoji, created_at')
      .single()

    if (error) {
      console.warn('[messages] Reaction insert failed.', error.message)
      setReactionPatchState((current) => {
        const deletedIds = new Set(current.deletedIds)
        deletedIds.add(tempReaction.id)
        return {
          deletedIds,
          upserts: current.upserts.filter((reaction) => reaction.id !== tempReaction.id),
        }
      })
      return
    }
    setReactionPatchState((current) => {
      const insertedReaction = inserted as AccountMessageReaction
      const deletedIds = new Set(current.deletedIds)
      deletedIds.add(tempReaction.id)
      deletedIds.delete(insertedReaction.id)
      return {
        deletedIds,
        upserts: [
          ...current.upserts.filter(
            (reaction) => reaction.id !== tempReaction.id && reaction.id !== insertedReaction.id
          ),
          insertedReaction,
        ],
      }
    })
  }

  async function handleUnsend(message: AccountMessage) {
    try {
      await invokeAccountFunction('message-action', { action: 'unsend', messageId: message.id })
    } catch (err) {
      const msg = friendlyActionError(err, 'Could not unsend this message. Please try again.')
      if (/15 minutes/i.test(msg)) {
        alert('Messages can only be unsent within 15 minutes of sending.')
      } else {
        alert(msg)
      }
    }
  }

  function renderMessageBubble(
    message: AccountMessage,
    mediaCluster: AccountMessage[] = [message]
  ) {
    const mine = message.sender_id === data.userId
    const isDeleted = Boolean(message.is_deleted)
    const replyTarget = message.reply_to_id
      ? (selectedMessages.find((candidate) => candidate.id === message.reply_to_id) ?? null)
      : null
    const isHovered = hoveredMessageId === message.id
    const canUnsend =
      mine &&
      !isDeleted &&
      (() => {
        const sentAt = parseDateValue(message.created_at)
        return sentAt ? Date.now() - sentAt.getTime() < 15 * 60 * 1000 : false
      })()
    const canEdit = mine && !isDeleted && message.type === 'TEXT'
    const isVoiceMessage = !isDeleted && (message.type === 'VOICE' || Boolean(message.voice_url))
    const hasMedia = Boolean(message.photo_url)
    const scheduledCallMessage =
      message.type === 'TEXT' && !isDeleted ? parseScheduledOrderCallMessage(message.body) : null
    const translation = messageTranslations[message.id] ?? null
    const showingOriginal = showOriginalTranslationIds.has(message.id)
    const canTranslate =
      !mine && !isDeleted && message.type === 'TEXT' && !!message.body && !scheduledCallMessage
    const clusterPosition = selectedConversationPositions.get(message.id) ?? 'isolated'
    const showsTail = clusterPosition === 'isolated' || clusterPosition === 'end'
    const clusterShape = mine
      ? clusterPosition === 'start'
        ? 'rounded-br-[8px]'
        : clusterPosition === 'middle'
          ? 'rounded-r-[8px]'
          : clusterPosition === 'end'
            ? 'rounded-tr-[8px] rounded-br-[5px]'
            : 'rounded-br-[5px]'
      : clusterPosition === 'start'
        ? 'rounded-bl-[8px]'
        : clusterPosition === 'middle'
          ? 'rounded-l-[8px]'
          : clusterPosition === 'end'
            ? 'rounded-tl-[8px] rounded-bl-[5px]'
            : 'rounded-bl-[5px]'

    return (
      <div
        className={`group relative flex w-full px-3 ${clusterPosition === 'isolated' || clusterPosition === 'start' ? 'pt-2' : 'pt-0.5'} pb-0.5 sm:px-5 ${mine ? 'justify-end' : 'justify-start'}`}
        onMouseEnter={() => setHoveredMessageId(message.id)}
        onMouseLeave={() => setHoveredMessageId(null)}
      >
        {isHovered && !isDeleted ? (
          <div
            className={`absolute top-2 z-10 flex items-center gap-1 rounded-[8px] border border-ui-border bg-white p-1 shadow-md ${mine ? 'right-[calc(min(76%,42rem)+1.75rem)]' : 'left-[calc(min(76%,42rem)+1.75rem)]'}`}
          >
            <IconButton
              size="icon-sm"
              variant="ghost"
              label="Reply"
              onClick={() => setReplyingTo(message)}
            >
              <Reply />
            </IconButton>
            {canTranslate ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label="Translate message"
                disabled={translationLoadingIds.has(message.id)}
                onClick={() => {
                  void translateAccountMessage(message, true)
                }}
              >
                {translationLoadingIds.has(message.id) ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Languages />
                )}
              </IconButton>
            ) : null}
            {canEdit ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label="Edit message"
                onClick={() => setEditingMessage(message)}
              >
                <Pencil />
              </IconButton>
            ) : null}
            {canUnsend ? (
              <IconButton
                size="icon-sm"
                variant="ghost"
                label="Unsend message"
                className="text-rust hover:text-rust"
                onClick={() => {
                  void handleUnsend(message)
                }}
              >
                <Trash2 />
              </IconButton>
            ) : null}
          </div>
        ) : null}

        <div
          className={`relative text-xs leading-4 ${isVoiceMessage || scheduledCallMessage ? 'w-[18rem] max-w-[72%]' : hasMedia ? 'w-[20rem] max-w-[72%]' : 'w-fit max-w-[62%]'} min-w-0 rounded-[14px] px-2.5 py-1.5 ${clusterShape} ${mine ? 'bg-gradient-to-b from-needle to-[#12694d]' : 'bg-[#eef0ed]'} ${isDeleted ? 'opacity-60' : ''}`}
        >
          {showsTail ? (
            <span
              aria-hidden="true"
              className={`absolute bottom-1 h-3 w-3 rotate-45 ${mine ? '-right-1 bg-[#12694d]' : '-left-1 bg-[#eef0ed]'}`}
            />
          ) : null}
          {replyTarget ? (
            <div
              className={`mb-2 rounded-[6px] border-l-2 px-2 py-1.5 ${mine ? 'border-white/35 bg-white/10' : 'border-needle/45 bg-ui-muted'}`}
            >
              <p
                className={`text-[0.68rem] font-semibold ${mine ? 'text-white/78' : 'text-ink/62'}`}
              >
                {replyTarget.sender_name ?? 'Unknown'}
              </p>
              <p
                className={`line-clamp-2 text-xs leading-4 ${mine ? 'text-white/62' : 'text-ui-subtle'}`}
              >
                {replyTarget.is_deleted
                  ? 'This message was unsent.'
                  : replyTarget.type === 'PHOTO'
                    ? 'Photo attachment'
                    : replyTarget.type === 'VOICE'
                      ? 'Voice note'
                      : safeUserText(replyTarget.body, '')}
              </p>
            </div>
          ) : null}

          {isDeleted ? (
            <p className={`text-sm italic leading-6 ${mine ? 'text-white/64' : 'text-ui-subtle'}`}>
              This message was unsent.
            </p>
          ) : (
            <div
              className={mine ? '[&_p]:text-white/92 [&_a]:text-white [&_audio]:opacity-90' : ''}
            >
              {scheduledCallMessage ? (
                <div
                  className="grid gap-2"
                  aria-label={`Order call scheduled for ${scheduledCallMessage.scheduledFor}`}
                >
                  <div
                    className={`flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] ${mine ? 'text-white/82' : 'text-needle'}`}
                  >
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Order call scheduled
                  </div>
                  <p
                    className={`text-sm font-semibold leading-5 ${mine ? 'text-white' : 'text-ink'}`}
                  >
                    {safeUserText(scheduledCallMessage.scheduledFor, '')}
                  </p>
                  <dl
                    className={`divide-y ${mine ? 'divide-white/18 border-white/20' : 'divide-ink/8 border-ink/10'} border-y`}
                  >
                    <div className="grid grid-cols-[auto_1fr] gap-4 py-2">
                      <dt
                        className={`text-xs font-semibold ${mine ? 'text-white/68' : 'text-ink/48'}`}
                      >
                        Reason
                      </dt>
                      <dd
                        className={`text-right text-sm font-semibold ${mine ? 'text-white' : 'text-ink'}`}
                      >
                        {safeUserText(scheduledCallMessage.reason, '')}
                      </dd>
                    </div>
                  </dl>
                  {scheduledCallMessage.note ? (
                    <div
                      className={`rounded-[8px] px-3 py-2 ${mine ? 'bg-white/12' : 'bg-white/80'}`}
                    >
                      <p
                        className={`text-xs font-semibold ${mine ? 'text-white/68' : 'text-ink/48'}`}
                      >
                        Note
                      </p>
                      <p className={`mt-0.5 text-sm leading-5 ${mine ? 'text-white' : 'text-ink'}`}>
                        {safeUserText(scheduledCallMessage.note, '')}
                      </p>
                    </div>
                  ) : null}
                  <p
                    className={`text-[0.68rem] leading-4 ${mine ? 'text-white/68' : 'text-ink/46'}`}
                  >
                    Free in Drapeon · Keep decisions in chat
                  </p>
                </div>
              ) : mediaCluster.length > 1 ? (
                <MessageMediaMosaic messages={mediaCluster} onReply={setReplyingTo} />
              ) : translation && message.type === 'TEXT' ? (
                <div className="grid gap-1.5">
                  <p className="whitespace-pre-wrap break-words text-xs leading-4 text-ink/72">
                    {showingOriginal ? safeUserText(message.body, '') : translation.translatedText}
                  </p>
                  <button
                    type="button"
                    className={`inline-flex w-fit cursor-pointer items-center gap-1 text-[0.68rem] font-semibold transition-colors ${mine ? 'text-white/72 hover:text-white' : 'text-needle/75 hover:text-needle'}`}
                    onClick={() =>
                      setShowOriginalTranslationIds((current) => {
                        const next = new Set(current)
                        if (next.has(message.id)) next.delete(message.id)
                        else next.add(message.id)
                        return next
                      })
                    }
                  >
                    <Languages className="size-3" aria-hidden="true" />
                    {showingOriginal
                      ? `View ${languageName(translation.targetLanguage)} translation`
                      : `Translated from ${languageName(translation.sourceLanguage)} · View original`}
                  </button>
                </div>
              ) : (
                <MessageContent
                  message={message}
                  returnTo={selectedThread
                    ? `/account/messages?orderId=${encodeURIComponent(selectedThread.order.id)}`
                    : '/account/messages'}
                />
              )}
            </div>
          )}

          {canTranslate && !translation ? (
            <button
              type="button"
              disabled={translationLoadingIds.has(message.id)}
              onClick={() => {
                void translateAccountMessage(message, true)
              }}
              className={`mt-1 inline-flex items-center gap-1 text-[0.68rem] font-semibold ${mine ? 'text-white/72' : 'text-needle'}`}
            >
              {translationLoadingIds.has(message.id) ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Languages className="size-3" />
              )}
              {translationLoadingIds.has(message.id) ? 'Translating…' : 'Translate'}
            </button>
          ) : null}
          <div
            className={`mt-1 flex items-center justify-end gap-1 text-[0.62rem] ${mine ? 'text-white/58' : 'text-ink/38'}`}
            title={parseDateValue(message.created_at)?.toISOString()}
          >
            {!isDeleted ? (
              <MessageReactionBar
                reactions={reactionsByMessageId.get(message.id) ?? []}
                userId={data.userId}
                mine={mine}
                open={openReactionMessageId === message.id}
                onOpenChange={(open) => setOpenReactionMessageId(open ? message.id : null)}
                onToggle={(emoji) => {
                  void toggleMessageReaction(message, emoji)
                }}
              />
            ) : null}
            {message.edited_at && !isDeleted ? <span className="italic">edited</span> : null}
            <span>{formatMessageRelative(message.created_at)}</span>
            {mine ? (
              <CheckCheck
                className={`size-3.5 ${message.read_at ? 'opacity-100' : 'opacity-55'}`}
                aria-label={message.read_at ? 'Read' : 'Sent'}
              />
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (threads.length === 0) {
    return {
      emptyState: (
        <div className="grid gap-4 py-3 lg:pt-0">
          <section className="app-surface p-4">
            <p className="text-[0.68rem] font-semibold uppercase text-needle/80">Messages</p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-3xl">
              Order conversations stay protected.
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/64">
              Calls, photos, decisions, and notes appear here only after an order conversation
              exists.
            </p>
          </section>
          <EmptyState
            title="No conversations yet."
            body="Start with Explore or review an existing order. A conversation opens when there is real work to discuss."
            action={
              <div className="flex flex-wrap gap-3">
                <Button asChild size="sm">
                  <Link href="/account/explore">Explore tailors</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/account/orders">View orders</Link>
                </Button>
              </div>
            }
          />
        </div>
      ),
    }
  }

  return {
    data,
    onRefresh,
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
    saveTranslationPreference,
    translateAccountMessage,
    selectedMessageGroups,
    selectedConversationPositions,
    selectedOrderEvents,
    conversationItems,
    messageVirtualizer,
    selectedUnreadIds,
    selectedUnreadKey,
    unreadMessageIds,
    totalUnread,
    markAllRead,
    openQuoteRevisionDialog,
    submitQuoteRevision,
    handleConversationAction,
    toggleMessageReaction,
    handleUnsend,
    renderMessageBubble,
  }
}

export function RenderMessages(props: { data: MessagesRenderData; onRefresh: () => void }) {
  const context = useMessagesWorkspaceController(props)
  if ('emptyState' in context) return context.emptyState
  return <MessagesWorkspaceView context={context} />
}
