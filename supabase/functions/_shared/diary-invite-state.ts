export type DiaryInviteStatus = 'NOT_INVITED' | 'LINK_COPIED' | 'LINK_SHARED' | 'INVITE_SENT' | 'CLAIMED'
export type DiaryInviteAction = 'mark-invite-copied' | 'mark-invite-shared' | 'mark-invite-sent'

type InviteTransition =
  | { outcome: 'claimed' }
  | { outcome: 'unchanged'; status: DiaryInviteStatus }
  | { outcome: 'update'; status: DiaryInviteStatus }

const STATUS_RANK: Record<DiaryInviteStatus, number> = {
  NOT_INVITED: 0,
  LINK_COPIED: 1,
  LINK_SHARED: 2,
  INVITE_SENT: 2,
  CLAIMED: 3,
}

function parseStatus(value: string | null | undefined): DiaryInviteStatus {
  return value && value in STATUS_RANK ? value as DiaryInviteStatus : 'NOT_INVITED'
}

function targetStatus(action: DiaryInviteAction): DiaryInviteStatus {
  if (action === 'mark-invite-copied') return 'LINK_COPIED'
  if (action === 'mark-invite-shared') return 'LINK_SHARED'
  return 'INVITE_SENT'
}

/** Plan a retry-safe invite-state write without ever downgrading a live outcome. */
export function planDiaryInviteTransition(input: {
  action: DiaryInviteAction
  currentStatus: string | null | undefined
  inviteExpiresAt: string | null | undefined
  nowMs?: number
}): InviteTransition {
  const current = parseStatus(input.currentStatus)
  if (current === 'CLAIMED') return { outcome: 'claimed' }

  const target = targetStatus(input.action)
  const expiresAtMs = input.inviteExpiresAt ? Date.parse(input.inviteExpiresAt) : Number.NaN
  const stillValid = Number.isFinite(expiresAtMs) && expiresAtMs > (input.nowMs ?? Date.now())
  if (stillValid && STATUS_RANK[current] >= STATUS_RANK[target]) {
    return { outcome: 'unchanged', status: current }
  }

  return { outcome: 'update', status: target }
}
