export type BachsPayoutStatusInput = {
  transfersEnabled: boolean
  payoutsEnabled: boolean
  firstWithdrawalReviewStatus: 'PENDING' | 'CLEARED' | 'BLOCKED' | (string & {})
  active: boolean
  onboardingDueCount: number | null
  onboardingPendingCount: number | null
  hasProviderDestination: boolean | null
}

export type BachsPayoutState =
  | 'NOT_STARTED'
  | 'REQUIREMENTS_DUE'
  | 'PROVIDER_REVIEWING'
  | 'FIRST_PAYOUT_REVIEW'
  | 'READY'
  | 'BLOCKED'
  | 'RESTRICTED'
  | 'DESTINATION_REJECTED'

export type BachsPayoutPresentation = {
  state: BachsPayoutState
  label: string
  detail: string
  nextAction: 'START' | 'CONTINUE_BACHS' | 'WAIT' | 'CONTACT_SUPPORT' | 'NONE'
  ctaLabel: string | null
  ready: boolean
}

const presentations: Record<BachsPayoutState, Omit<BachsPayoutPresentation, 'state'>> = {
  NOT_STARTED: {
    label: 'Payout setup needed',
    detail: 'Connect a payout account with Bachs to receive earnings.',
    nextAction: 'START',
    ctaLabel: 'Set up payouts',
    ready: false,
  },
  REQUIREMENTS_DUE: {
    label: 'Finish with Bachs',
    detail: 'Bachs needs more information before this payout account is ready.',
    nextAction: 'CONTINUE_BACHS',
    ctaLabel: 'Continue with Bachs',
    ready: false,
  },
  PROVIDER_REVIEWING: {
    label: 'Bachs is reviewing',
    detail: 'Bachs is checking your payout information. We will update this status when its review finishes.',
    nextAction: 'WAIT',
    ctaLabel: null,
    ready: false,
  },
  FIRST_PAYOUT_REVIEW: {
    label: 'First payout under review',
    detail: 'Your Bachs account is ready. Drapeon is reviewing your first payout; no action is needed.',
    nextAction: 'WAIT',
    ctaLabel: null,
    ready: false,
  },
  READY: {
    label: 'Ready',
    detail: 'Your Bachs payout account is ready.',
    nextAction: 'NONE',
    ctaLabel: null,
    ready: true,
  },
  BLOCKED: {
    label: 'Payout review blocked',
    detail: 'Drapeon could not clear this payout account. Contact payouts support for the next step.',
    nextAction: 'CONTACT_SUPPORT',
    ctaLabel: 'Contact payouts',
    ready: false,
  },
  RESTRICTED: {
    label: 'Payout account restricted',
    detail: 'Bachs has restricted this account. New paid orders and payouts are paused until it is resolved.',
    nextAction: 'CONTACT_SUPPORT',
    ctaLabel: 'Contact payouts',
    ready: false,
  },
  DESTINATION_REJECTED: {
    label: 'Payout destination needs review',
    detail: 'Bachs cannot use the saved payout destination. Contact payouts support before continuing.',
    nextAction: 'CONTACT_SUPPORT',
    ctaLabel: 'Contact payouts',
    ready: false,
  },
}

/** One provider-first ordering for web, mobile and Ops. A pending Drapeon
 * review is shown only after Bachs itself has no requirements or review due. */
export function deriveBachsPayoutPresentation(
  destination: BachsPayoutStatusInput | null | undefined,
): BachsPayoutPresentation {
  let state: BachsPayoutState
  if (!destination) state = 'NOT_STARTED'
  else if (destination.firstWithdrawalReviewStatus === 'BLOCKED') state = 'BLOCKED'
  else if ((destination.onboardingDueCount ?? 0) > 0) state = 'REQUIREMENTS_DUE'
  else if ((destination.onboardingPendingCount ?? 0) > 0 ||
    destination.onboardingDueCount === null ||
    destination.onboardingPendingCount === null) state = 'PROVIDER_REVIEWING'
  else if (!destination.transfersEnabled || !destination.payoutsEnabled) {
    state = destination.firstWithdrawalReviewStatus === 'CLEARED'
      ? 'RESTRICTED' : 'PROVIDER_REVIEWING'
  } else if (destination.hasProviderDestination === false) {
    state = 'DESTINATION_REJECTED'
  } else if (destination.hasProviderDestination === null) {
    state = 'PROVIDER_REVIEWING'
  } else if (destination.firstWithdrawalReviewStatus === 'PENDING') {
    state = 'FIRST_PAYOUT_REVIEW'
  } else if (destination.active) state = 'READY'
  else state = 'RESTRICTED'
  return { state, ...presentations[state] }
}
