'use client'

import {
  ORDER_EVENT_LABELS,
  QUOTE_REVISION_REASON_LABELS,
  deriveConversationEventPresentation,
  formatDatabaseEnumLabel,
  languageName,
} from '@drape/shared'
import {
  Archive,
  ArchiveRestore,
  Banknote,
  BellRing,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  ClipboardList,
  Languages,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Ruler,
  ShoppingBag,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { Button } from '../../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Field } from '../../../components/ui/field'
import { IconButton } from '../../../components/ui/icon-button'
import { Input } from '../../../components/ui/input'
import { StatusChip } from '../../../components/ui/status-chip'
import { Textarea } from '../../../components/ui/textarea'
import { safeUserText } from '../../../lib/safe-display'
import type { AccountOrderEvent } from '../shared/account-data-contracts'
import { MessageComposer } from './message-composer'
import {
  formatMessageRelative,
  initialsForName,
  orderTitle,
  partyAvatar,
  partyName,
} from './message-foundation'
import type { useMessagesWorkspaceController } from './messages-workspace-render'

type ActiveContext = Exclude<
  ReturnType<typeof useMessagesWorkspaceController>,
  { emptyState: React.ReactNode }
>

export function OrderConversationEventCard({ event }: { event: AccountOrderEvent }) {
  const presentation = deriveConversationEventPresentation({
    eventType: event.event_type,
    title: event.title,
    summary: event.summary,
    quoteVersion: event.quote_version,
    metadata: event.metadata,
  })
  const EventIcon = {
    quote: ClipboardList,
    payment: Banknote,
    scope: Pencil,
    fabric: SlidersHorizontal,
    measurement: Ruler,
    fulfillment: ShoppingBag,
    remedy: CircleHelp,
  }[presentation.icon]
  return (
    <article className="mx-auto my-3 grid w-[min(88%,34rem)] gap-3 rounded-[10px] border border-needle/18 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-needle/10 text-needle">
          <EventIcon className="size-4.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-needle">
              {presentation.eyebrow}
            </p>
            <time className="text-xs text-ink/44">{formatMessageRelative(event.created_at)}</time>
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-ink">{presentation.title}</h3>
        </div>
      </div>
      {event.summary ? (
        <p className="rounded-[8px] bg-ui-muted px-3 py-2 text-sm leading-5 text-ink/68">
          {safeUserText(event.summary, '')}
        </p>
      ) : null}
      {presentation.facts.length > 0 ? (
        <dl className="divide-y divide-ink/8 border-y border-ink/8">
          {presentation.facts.map((item) => (
            <div
              key={`${item.label}:${item.value}`}
              className="grid grid-cols-[minmax(5rem,0.7fr)_minmax(0,1.3fr)] gap-4 py-2"
            >
              <dt className="text-xs font-semibold text-ink/46">{item.label}</dt>
              <dd className="text-right text-sm font-semibold leading-5 text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChip status={event.event_type} fallback={ORDER_EVENT_LABELS[event.event_type]} />
        <p className="text-xs text-ink/44">
          {formatDatabaseEnumLabel(event.actor_role, 'Drapeon')}
        </p>
      </div>
    </article>
  )
}

export function MessagesWorkspaceView({ context }: { context: ActiveContext }) {
  const {
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
  } = context
  return (
    <section className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm lg:flex lg:h-[calc(100vh-2rem)]">
      <h1 className="sr-only">Order conversations</h1>

      {/* ── Sidebar ── */}
      {!sidebarCollapsed ? (
        <aside className="flex w-full shrink-0 flex-col border-b border-ink/8 lg:w-72 lg:border-b-0 lg:border-r">
          {/* Search + filters */}
          <div className="border-b border-ink/8 p-3">
            <label className="sr-only" htmlFor="message-search">
              Search conversations
            </label>
            <Input
              id="message-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-ui-canvas"
              placeholder="Search conversations"
            />
            <div className="mt-2 flex gap-1">
              {(['active', 'completed', 'archived'] as const).map((key) => {
                const unreadCounts = {
                  active: activeThreads.reduce((sum, t) => sum + t.unread, 0),
                  completed: completedThreads.reduce((sum, t) => sum + t.unread, 0),
                  archived: archivedThreads.reduce((sum, t) => sum + t.unread, 0),
                }
                const labels = { active: 'Active', completed: 'Done', archived: 'Archived' }
                return (
                  <Button
                    key={key}
                    onClick={() => {
                      setFilter(key)
                      setSelectedOrderId(null)
                    }}
                    variant={filter === key ? 'primary' : 'ghost'}
                    size="sm"
                    className="relative flex-1 text-xs"
                  >
                    {labels[key]}
                    {unreadCounts[key] > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rust text-[0.6rem] font-bold text-white">
                        {unreadCounts[key] > 9 ? '9+' : unreadCounts[key]}
                      </span>
                    ) : null}
                  </Button>
                )
              })}
            </div>
            {notificationPermission === 'default' ? (
              <div className="mt-2">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    void requestNotifications()
                  }}
                >
                  <BellRing /> Enable alerts
                </Button>
              </div>
            ) : null}
          </div>

          {/* Grouped conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="p-4 text-sm text-ink/48">
                {search ? 'No conversations match.' : 'Nothing here.'}
              </p>
            ) : (
              groups.map((group) => {
                const isExpanded = expandedGroupKeys.has(group.key) || group.threads.length === 1
                const groupActive = group.threads.some(
                  (t) => t.order.id === selectedThread?.order.id
                )
                return (
                  <div key={group.key}>
                    {/* Group header row */}
                    <button
                      type="button"
                      onClick={() => {
                        if (group.threads.length === 1) {
                          setSelectedOrderId(group.threads[0]!.order.id)
                        } else {
                          setExpandedGroupKeys((prev) => {
                            const next = new Set(prev)
                            if (next.has(group.key)) next.delete(group.key)
                            else next.add(group.key)
                            return next
                          })
                          if (!isExpanded) setSelectedOrderId(group.threads[0]!.order.id)
                        }
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${groupActive && group.threads.length === 1 ? 'bg-needle/8' : 'hover:bg-ink/4'}`}
                    >
                      <div className="relative shrink-0">
                        <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-needle/14 text-sm font-semibold text-needle">
                          {group.avatarSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={group.avatarSrc}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            initialsForName(group.name)
                          )}
                        </div>
                        {group.unread > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-0.5 text-[0.6rem] font-bold text-white">
                            {group.unread > 9 ? '9+' : group.unread}
                          </span>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={`truncate text-sm ${group.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink'}`}
                          >
                            {group.name}
                          </p>
                          <p className="shrink-0 text-[0.65rem] text-ink/38">
                            {formatMessageRelative(group.latestPreview?.created_at ?? null)}
                          </p>
                        </div>
                        <p
                          className={`mt-0.5 truncate text-xs ${group.unread > 0 ? 'font-semibold text-ink/80' : 'text-ink/44'}`}
                        >
                          {group.threads.length > 1
                            ? `${group.threads.length} orders`
                            : group.latestPreview
                              ? safeUserText(
                                  group.latestPreview.body,
                                  group.latestPreview.photo_url || group.latestPreview.voice_url
                                    ? 'Sent media'
                                    : 'No messages yet'
                                )
                              : 'No messages yet'}
                        </p>
                      </div>
                      {group.threads.length > 1 ? (
                        isExpanded ? (
                          <ChevronUp className="size-4 shrink-0 text-ui-subtle" />
                        ) : (
                          <ChevronDown className="size-4 shrink-0 text-ui-subtle" />
                        )
                      ) : null}
                    </button>

                    {/* Sub-threads (shown when group expanded and has >1 order) */}
                    {isExpanded && group.threads.length > 1
                      ? group.threads.map((thread) => {
                          const subActive = thread.order.id === selectedThread?.order.id
                          return (
                            <button
                              key={thread.order.id}
                              type="button"
                              onClick={() => setSelectedOrderId(thread.order.id)}
                              className={`flex w-full items-center gap-2 border-l-2 py-2 pl-16 pr-3 text-left transition ${subActive ? 'border-needle bg-needle/6' : 'border-ink/8 hover:bg-ink/4'}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`truncate text-xs font-semibold ${subActive ? 'text-needle' : 'text-ink/70'}`}
                                >
                                  {orderTitle(thread.order)}
                                </p>
                                <StatusChip
                                  status={thread.order.stage}
                                  fallback="Order"
                                  className="mt-1 py-0 text-[0.6rem]"
                                />
                              </div>
                              {thread.unread > 0 ? (
                                <span className="shrink-0 rounded-full bg-rust px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
                                  {thread.unread}
                                </span>
                              ) : null}
                            </button>
                          )
                        })
                      : null}
                  </div>
                )
              })
            )}
            {totalUnread > 0 ? (
              <div className="border-t border-ink/6 p-3">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    void markAllRead()
                  }}
                  disabled={markingAllRead}
                >
                  <CheckCheck />
                  {markingAllRead ? 'Marking...' : 'Mark all read'}
                </Button>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {/* ── Chat pane ── */}
      {!selectedThread ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-needle/10 text-needle">
              <MessageSquareText className="size-6" />
            </div>
            <p className="text-sm font-semibold text-ink">Pick a conversation</p>
            <p className="mt-1 text-xs text-ink/44">Select a thread from the list to open it.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-needle/10 bg-needle/6 px-3 py-2.5">
            {/* Collapse toggle */}
            <IconButton
              label={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
              onClick={() => setSidebarCollapsed((v) => !v)}
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 lg:inline-flex"
            >
              {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
            {/* Avatar + name */}
            {(() => {
              const name = partyName(selectedThread.order, data.userId)
              const avatarSrc = partyAvatar(selectedThread.order, data.userId)
              return (
                <>
                  <div
                    className="relative h-8 w-8 shrink-0"
                    aria-label={counterpartyPresence.online ? `${name} is online` : undefined}
                  >
                    <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-needle/14 text-xs font-semibold text-needle">
                      {avatarSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initialsForName(name)
                      )}
                    </div>
                    {counterpartyPresence.online ? (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#eef7f1] bg-needle"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    <p className="truncate text-xs text-ink/44">
                      {orderTitle(selectedThread.order)}
                    </p>
                  </div>
                </>
              )
            })()}
            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              {translationAvailable ? (
                <details className="relative">
                  <summary
                    className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-needle/12 bg-white/75 px-3 text-xs font-semibold text-needle transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
                    aria-label={`Translation settings. Current language: ${languageName(translationPreference.targetLanguage, translationLanguages)}`}
                  >
                    <Languages className="size-4" aria-hidden="true" />
                    <span className="hidden xl:inline">
                      Translate ·{' '}
                      {languageName(translationPreference.targetLanguage, translationLanguages)}
                    </span>
                  </summary>
                  <div className="absolute right-0 top-11 z-40 grid w-72 gap-3 rounded-[8px] border border-ui-border bg-white p-4 shadow-xl">
                    <div>
                      <p className="text-sm font-semibold text-ink">Message translation</p>
                      <p className="mt-1 text-xs leading-5 text-ink/52">
                        Original messages stay available for order and safety records.
                      </p>
                    </div>
                    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-[8px] bg-needle/5 p-3">
                      <span>
                        <span className="block text-sm font-semibold text-ink">
                          Always translate this conversation
                        </span>
                        <span className="mt-0.5 block text-xs leading-4 text-ink/52">
                          Translate incoming text automatically.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={translationPreference.autoTranslate}
                        disabled={translationSettingsBusy}
                        onChange={(event) => {
                          void saveTranslationPreference({
                            ...translationPreference,
                            autoTranslate: event.target.checked,
                          })
                        }}
                        className="mt-1 size-4 accent-needle"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold text-ink/62">
                      Translate messages to
                      <select
                        value={translationPreference.targetLanguage}
                        disabled={translationSettingsBusy}
                        onChange={(event) => {
                          void saveTranslationPreference({
                            ...translationPreference,
                            targetLanguage: event.target.value,
                          })
                        }}
                        className="min-h-10 cursor-pointer rounded-[8px] border border-ui-border bg-white px-3 text-sm font-medium text-ink outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
                      >
                        {translationLanguages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold text-ink/62">
                      Message language
                      <select
                        value={translationPreference.sourceLanguage ?? ''}
                        disabled={translationSettingsBusy}
                        onChange={(event) => {
                          void saveTranslationPreference({
                            ...translationPreference,
                            sourceLanguage: event.target.value || null,
                          })
                        }}
                        className="min-h-10 cursor-pointer rounded-[8px] border border-ui-border bg-white px-3 text-sm font-medium text-ink outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
                      >
                        <option value="">Detect automatically</option>
                        {translationLanguages.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="rounded-[8px] bg-ui-muted px-3 py-2 text-[0.68rem] leading-4 text-ink/52">
                      Choose the language you want to read. Detection is automatic; dialects such as
                      Nigerian Pidgin may be less exact.
                    </p>
                  </div>
                </details>
              ) : null}
              {selectedCanJoinCall && selectedCallHref ? (
                <Button asChild size="sm">
                  <Link href={selectedCallHref}>
                    <Video /> Join {selectedCallType} call
                  </Link>
                </Button>
              ) : null}
              {selectedThread.completed || selectedThread.archived ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setThreadArchived(selectedThread.order.id, !selectedThread.archived)
                  }
                  className="text-ui-subtle"
                >
                  {selectedThread.archived ? <ArchiveRestore /> : <Archive />}
                  <span className="hidden xl:inline">
                    {selectedThread.archived ? 'Unarchive' : 'Archive'}
                  </span>
                </Button>
              ) : null}
              <Button asChild size="sm" variant={selectedCanJoinCall ? 'outline' : 'primary'}>
                <Link href={`/account/orders/${selectedThread.order.id}`}>
                  <ClipboardList /> Order
                </Link>
              </Button>
            </div>
          </div>

          {translationError ? (
            <div
              className="border-b border-rust/12 bg-rust/6 px-4 py-2 text-xs font-medium text-rust"
              role="status"
            >
              {translationError}
            </div>
          ) : null}

          {/* Messages area */}
          <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto bg-ui-canvas/70 py-3">
            {conversationItems.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="rounded-[8px] border border-ui-border bg-white px-5 py-4 text-sm leading-6 text-ui-subtle">
                  No messages yet.
                </p>
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{ height: messageVirtualizer.getTotalSize() }}
              >
                {messageVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = conversationItems[virtualRow.index]
                  if (!item) return null
                  return (
                    <div
                      key={item.key}
                      ref={messageVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {item.kind === 'event' ? (
                        <OrderConversationEventCard event={item.event} />
                      ) : (
                        (() => {
                          const message = item.group.at(-1)
                          return message ? renderMessageBubble(message, item.group) : null
                        })()
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Typing indicator */}
          {counterpartyIsTyping ? (
            <div className="border-t border-ink/8 px-4 py-1.5">
              <p className="text-xs italic text-ink/44">
                {partyName(selectedThread.order, data.userId)} is typing…
              </p>
            </div>
          ) : null}

          {conversationActionError && !revisionDialogOpen ? (
            <div className="border-t border-rust/18 bg-rust/6 px-4 py-2 text-sm text-rust">
              {conversationActionError}
            </div>
          ) : null}

          {/* Reply preview bar */}
          {replyingTo ? (
            <div className="flex items-center gap-2 border-t border-needle/20 bg-needle/6 px-4 py-2">
              <div className="flex-1 overflow-hidden">
                <p className="text-[0.65rem] font-semibold text-needle">
                  {replyingTo.sender_name ?? 'Unknown'}
                </p>
                <p className="truncate text-[0.65rem] text-ink/52">
                  {replyingTo.is_deleted
                    ? 'This message was unsent.'
                    : replyingTo.type === 'PHOTO'
                      ? 'Photo'
                      : replyingTo.type === 'VOICE'
                        ? 'Voice note'
                        : safeUserText(replyingTo.body, '')}
                </p>
              </div>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => setReplyingTo(null)}
                label="Cancel reply"
              >
                <X />
              </IconButton>
            </div>
          ) : null}

          {/* Edit mode bar */}
          {editingMessage ? (
            <div className="flex items-center justify-between border-t border-ink/10 bg-bone px-4 py-2">
              <p className="text-xs font-semibold text-ink/52">Editing message</p>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditingMessage(null)}
                label="Cancel edit"
              >
                <X />
              </IconButton>
            </div>
          ) : null}

          {/* Composer */}
          <div className="border-t border-ink/8 bg-white/90 px-3 pb-3 pt-2">
            <MessageComposer
              order={selectedThread.order}
              consultationBooking={selectedConsultationBooking}
              onRefresh={onRefresh}
              channelRef={orderChannelRef}
              replyingTo={replyingTo}
              onClearReply={() => setReplyingTo(null)}
              editingMessage={editingMessage}
              onClearEdit={() => setEditingMessage(null)}
            />
          </div>
          <Dialog open={revisionDialogOpen} onOpenChange={setRevisionDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingRevision ? 'Edit quote change request' : 'Request quote changes'}
                </DialogTitle>
                <DialogDescription>
                  This is a formal revision round. Ordinary questions in chat do not use a round.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-semibold text-ink">What should change?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(QUOTE_REVISION_REASON_LABELS).map(([value, label]) => {
                      const checked = revisionReasons.includes(value)
                      return (
                        <label
                          key={value}
                          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[8px] border border-ui-border px-3 py-2 text-sm text-ink"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setRevisionReasons((current) =>
                                checked
                                  ? current.filter((reason) => reason !== value)
                                  : current.length < 4
                                    ? [...current, value]
                                    : current
                              )
                            }
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <Field
                  label="Change request"
                  hint="Be specific about price, scope, timing, fabric, fulfillment, or fit."
                >
                  <Textarea
                    value={revisionNote}
                    onChange={(event) => setRevisionNote(event.target.value)}
                    rows={5}
                    maxLength={1200}
                  />
                </Field>
                <Field
                  label="Target budget (optional)"
                  hint={`Uses the locked quote currency ${selectedActiveQuote?.currency ?? ''}.`}
                >
                  <Input
                    inputMode="decimal"
                    value={revisionTargetAmount}
                    onChange={(event) => setRevisionTargetAmount(event.target.value)}
                    placeholder="e.g. 85000"
                  />
                </Field>
                {conversationActionError ? (
                  <p className="rounded-[8px] border border-rust/18 bg-rust/6 px-3 py-2 text-sm text-rust">
                    {conversationActionError}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => setRevisionDialogOpen(false)}
                  disabled={conversationActionBusy}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    void submitQuoteRevision()
                  }}
                  disabled={conversationActionBusy || revisionReasons.length === 0}
                >
                  {conversationActionBusy
                    ? 'Saving...'
                    : editingRevision
                      ? 'Save request'
                      : 'Send request'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </section>
  )
}
