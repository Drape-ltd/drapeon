import { invokeFunction } from './supabase'
import {
  isLikelyConnectivityIssue,
  readFunctionErrorMessage,
  readFunctionErrorStatus,
} from './function-errors'
import type { ManualBankVerificationStatus, PayoutSetupOption } from '@drape/shared/payout-setup'

export type PayoutSetupProvider = 'STRIPE' | 'PAYSTACK'
export type PayoutSetupCurrency = 'NGN' | 'GHS' | 'KES' | 'USD' | 'GBP' | 'EUR' | 'CAD'

export type TailorPayoutStatus = {
  id: string
  displayName: string
  payoutCurrency: PayoutSetupCurrency
  payoutProvider: PayoutSetupProvider | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payoutAccountVerified: boolean
  payoutReverificationRequired: boolean
  payoutAccountVerifiedAt: string | null
  payoutBankName: string | null
  payoutAccountName: string | null
  payoutAccountMasked: string | null
  payoutCountryCode: string | null
  manualBankEntry: boolean
  manualBankName: string | null
  manualBankCountryCode: string | null
  manualBankCountryName: string | null
  manualBankSwiftBic: string | null
  manualBankAccountName: string | null
  manualBankVerificationStatus: ManualBankVerificationStatus | null
  manualBankSubmittedAt: string | null
  manualBankEntryEnabled: boolean
  paystackRecipientCode: string | null
  stripeConnectAccountId: string | null
  payoutAccountChangeCount: number
  payoutAccountLastChangedAt: string | null
  payoutAccountChangeLockedUntil: string | null
  payoutDestinationHoldUntil: string | null
  bachsPayoutDestination: {
    id: string
    countryCode: string
    payoutCurrency: string
    transfersEnabled: boolean
    payoutsEnabled: boolean
    firstWithdrawalReviewStatus: 'PENDING' | 'CLEARED' | 'BLOCKED'
    active: boolean
    capabilityCheckedAt: string | null
    onboardingDueCount: number | null
    onboardingPendingCount: number | null
    onboardingCheckedAt: string | null
  } | null
}

export type PayoutDestinationSummary = {
  payoutCurrency: PayoutSetupCurrency | null
  payoutProvider: PayoutSetupProvider | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payoutBankName: string | null
  payoutAccountName: string | null
  payoutAccountMasked: string | null
  payoutCountryCode: string | null
  payoutAccountVerified: boolean
  payoutReverificationRequired: boolean
}

export type PendingPayoutChange = {
  id: string
  status: 'PENDING'
  submittedAt: string | null
  confirmationStatus: 'PENDING' | 'CONFIRMED'
  lifecycleState: 'AWAITING_CONFIRMATION' | 'SECURITY_HOLD' | 'OPS_REVIEW' | 'ACTIVATED'
  confirmationExpiresAt: string | null
  confirmedAt: string | null
  holdUntil: string | null
  autoActivationEligible: boolean
  riskSignals: string[]
  currentDestination: PayoutDestinationSummary | null
  requestedDestination: PayoutDestinationSummary | null
}

export async function confirmPendingPayoutChange(requestId: string) {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    lifecycleState?: string
    holdUntil?: string | null
  }>('payout-account-action', {
    body: { action: 'confirm-payout-change', requestId },
  })
  if (error || !data?.ok) {
    return {
      data: null,
      error: await edgeError(error, 'We could not confirm this payout change.'),
    }
  }
  return { data, error: null }
}

export async function cancelPendingPayoutChange(requestId: string) {
  const { data, error } = await invokeFunction<{ ok?: boolean; outcome?: string }>(
    'payout-account-action',
    {
      body: { action: 'cancel-payout-change', requestId },
    }
  )
  if (error || !data?.ok) {
    return {
      data: null,
      error: await edgeError(error, 'We could not cancel this payout change.'),
    }
  }
  return { data, error: null }
}

type StatusResponse = {
  ok?: boolean
  profile?: TailorPayoutStatus
  pendingPayoutChange?: PendingPayoutChange | null
  payoutSetupOptions?: PayoutSetupOption[]
  payoutSetupOptionsStatus?: 'AVAILABLE' | 'NONE' | 'UNAVAILABLE'
}

async function edgeError(error: unknown, fallback: string) {
  const status = readFunctionErrorStatus(error)
  if (status === 404) {
    return 'Payout setup is not available in this environment yet. Deploy the latest payout function, then try again.'
  }
  return isLikelyConnectivityIssue(error)
    ? 'Connection looks weak. Try again when your signal improves.'
    : await readFunctionErrorMessage(error, fallback)
}

export async function loadPayoutAccountStatus() {
  const { data, error } = await invokeFunction<StatusResponse>('payout-account-action', {
    body: { action: 'get-status' },
  })

  if (error || !data?.profile) {
    return {
      profile: null,
      pendingPayoutChange: null,
      payoutSetupOptions: [],
      payoutSetupOptionsStatus: 'UNAVAILABLE' as const,
      error: await edgeError(error, 'We could not load your payout setup right now.'),
    }
  }

  return {
    profile: data.profile,
    pendingPayoutChange: data.pendingPayoutChange ?? null,
    payoutSetupOptions: data.payoutSetupOptions ?? [],
    payoutSetupOptionsStatus: data.payoutSetupOptionsStatus ?? 'UNAVAILABLE',
    error: null,
  }
}

export async function startStripeConnectOnboarding(input: {
  payoutCurrency: 'USD' | 'GBP' | 'EUR' | 'CAD'
  countryCode: string
  returnUrl: string
  refreshUrl: string
}) {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    onboarding?: {
      provider: 'STRIPE'
      payoutCurrency: string
      countryCode: string
      stripeConnectAccountId: string
      url: string
      expiresAt: number
    }
  }>('payout-account-action', {
    body: {
      action: 'start-stripe-connect',
      payoutCurrency: input.payoutCurrency,
      countryCode: input.countryCode.trim().toUpperCase(),
      returnUrl: input.returnUrl,
      refreshUrl: input.refreshUrl,
    },
  })

  if (error || !data?.onboarding?.url) {
    return {
      onboarding: null,
      error: await edgeError(error, 'We could not start Stripe onboarding right now.'),
    }
  }

  return {
    onboarding: data.onboarding,
    error: null,
  }
}

export async function refreshStripeConnectPayoutStatus() {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    pendingReview?: boolean
    confirmationRequired?: boolean
    account?: {
      provider: 'STRIPE'
      stripeConnectAccountId: string
      chargesEnabled: boolean
      payoutsEnabled: boolean
      detailsSubmitted: boolean
      payoutAccountVerified: boolean
      payoutReverificationRequired: boolean
      payoutAccountVerifiedAt: string | null
      payoutCountryCode: string | null
    }
  }>('payout-account-action', {
    body: { action: 'refresh-stripe-connect-status' },
  })

  if (
    error ||
    (!data?.account && data?.pendingReview !== true && data?.confirmationRequired !== true)
  ) {
    return {
      account: null,
      pendingReview: false,
      confirmationRequired: false,
      error: await edgeError(error, 'We could not refresh the Stripe payout status right now.'),
    }
  }

  return {
    account: data.account ?? null,
    pendingReview: data.pendingReview === true,
    confirmationRequired: data.confirmationRequired === true,
    error: null,
  }
}

export async function startBachsPayoutOnboarding(input: {
  routeId: string
  returnUrl: string
  refreshUrl: string
}) {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    pendingReview?: boolean
    onboarding?: {
      provider: 'BACHS'
      routeId: string
      routeVersion: number
      countryCode: string
      payoutCurrency: string
      destinationId: string
      accountId: string
      firstWithdrawalReviewStatus: string
      capabilitiesReady: boolean
      url: string
      expiresAt: number
    }
  }>('payout-account-action', {
    body: {
      action: 'start-bachs-connect',
      routeId: input.routeId,
      returnUrl: input.returnUrl,
      refreshUrl: input.refreshUrl,
    },
  })

  if (error || (!data?.onboarding?.url && data?.pendingReview !== true)) {
    return {
      onboarding: null,
      pendingReview: false,
      error: await edgeError(error, 'We could not start Bachs payout setup right now.'),
    }
  }

  return {
    onboarding: data.onboarding ?? null,
    pendingReview: data.pendingReview === true,
    error: null,
  }
}

export async function refreshBachsPayoutStatus(routeId: string) {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    pendingReview?: boolean
    account?: {
      provider: 'BACHS'
      accountId: string
      transfersEnabled: boolean
      payoutsEnabled: boolean
      firstWithdrawalReviewStatus: string
      destinationActive: boolean
      requirements: Record<string, unknown>
    } | null
  }>('payout-account-action', {
    body: { action: 'refresh-bachs-connect-status', routeId },
  })

  if (error || data?.ok !== true) {
    return {
      account: null,
      pendingReview: false,
      error: await edgeError(error, 'We could not refresh Bachs payout status right now.'),
    }
  }

  return {
    account: data.account ?? null,
    pendingReview: data.pendingReview === true,
    error: null,
  }
}
