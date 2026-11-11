import { payoutProviderLabelFromSavedIdentity, tailorPayoutSetupCopy } from '@drape/shared'
import { isFirstReleaseReady } from './payout-review-state'

export type TailorSellerStage =
  | 'DRAFT'
  | 'APPLICATION_COMPLETE'
  | 'IDENTITY_VERIFIED'
  | 'PAYOUT_READY'
  | 'LIVE_STANDARD'
  | 'LIVE_HIGHER_RISK'
  | 'RESTRICTED'

export type TailorReadinessInput = {
  profileCompleted?: boolean | null
  idVerificationStatus?: string | null
  isLive?: boolean | null
  payoutCurrency?: string | null
  payoutProvider?: string | null
  stripeAccountId?: string | null
  paystackAccountId?: string | null
  stripeConnectAccountId?: string | null
  paystackRecipientCode?: string | null
  payoutAccountVerified?: boolean | null
  payoutReverificationRequired?: boolean | null
  payoutAccountType?: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payoutFirstReleaseReviewStatus?: 'PENDING' | 'CLEARED' | 'BLOCKED' | null
  shipsInternationally?: boolean | null
}

export type TailorReadiness = {
  sellerStage: TailorSellerStage
  identityVerified: boolean
  payoutReady: boolean
  publicDiscoveryReady: boolean
  canAcceptPaidOrders: boolean
  canPublishPaidItems: boolean
  payoutProviderLabel: string | null
  blockers: string[]
  title: string
  body: string
  actionLabel: string | null
  tone: 'neutral' | 'warning' | 'success'
}

function isIdentityVerifiedStatus(status: string | null | undefined) {
  return status === 'VERIFIED' || status === 'APPROVED'
}

export function payoutSetupCopy(currency: string | null | undefined) {
  return tailorPayoutSetupCopy(currency)
}

export function deriveTailorReadiness(
  input: TailorReadinessInput | null | undefined
): TailorReadiness {
  const profileCompleted = input?.profileCompleted === true
  const idVerificationStatus = input?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const identityVerified = isIdentityVerifiedStatus(idVerificationStatus)
  const payoutVerified = input?.payoutAccountVerified === true
  const needsReverification = input?.payoutReverificationRequired === true
  const payoutProviderLabel = payoutProviderLabelFromSavedIdentity({
    payoutProvider: input?.payoutProvider,
    payoutAccountType: input?.payoutAccountType,
    stripeAccountId: input?.stripeAccountId,
    stripeConnectAccountId: input?.stripeConnectAccountId,
    paystackAccountId: input?.paystackAccountId,
    paystackRecipientCode: input?.paystackRecipientCode,
  })
  const explicitPayoutStateKnown =
    typeof input?.payoutAccountVerified === 'boolean' ||
    typeof input?.payoutReverificationRequired === 'boolean'
  const firstReleaseCleared = isFirstReleaseReady(input?.payoutFirstReleaseReviewStatus)
  const payoutReady =
    identityVerified &&
    firstReleaseCleared &&
    (explicitPayoutStateKnown
      ? payoutVerified && !needsReverification
      : payoutProviderLabel != null)
  const publicDiscoveryReady = profileCompleted && identityVerified
  const canAcceptPaidOrders = payoutReady
  const canPublishPaidItems = payoutReady
  const liveHigherRisk = input?.isLive === true && input?.shipsInternationally === true

  const blockers: string[] = []
  if (!profileCompleted) blockers.push('Complete your public profile')
  if (idVerificationStatus === 'PENDING') blockers.push('Wait for trust review to finish')
  if (idVerificationStatus === 'REJECTED') blockers.push('Update your trust video or profile')
  if (identityVerified && !payoutReady)
    blockers.push('Connect a payout account before taking paid orders')

  if (!profileCompleted) {
    return {
      sellerStage: 'DRAFT',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: 'Finish your tailor profile first',
      body: 'Complete your profile and portfolio, then record a trust video before your shop opens to customers.',
      actionLabel: 'Complete profile',
      tone: 'warning',
    }
  }

  if (!identityVerified) {
    return {
      sellerStage: 'APPLICATION_COMPLETE',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title:
        idVerificationStatus === 'PENDING'
          ? 'Trust review in progress'
          : idVerificationStatus === 'REJECTED'
            ? 'Trust review needs an update'
            : 'Submit your trust video',
      body:
        idVerificationStatus === 'PENDING'
          ? "We're reviewing your trust video and profile. Paid work opens after trust review and payout setup are complete."
          : idVerificationStatus === 'REJECTED'
            ? 'Update your trust video or profile in setup, then submit it for another review.'
            : 'Record your trust video in setup so we can review your shop for customer discovery and paid work.',
      actionLabel:
        idVerificationStatus === 'PENDING'
          ? 'Set up payout while you wait'
          : idVerificationStatus === 'REJECTED'
            ? 'Update trust video'
            : 'Record trust video',
      tone: 'warning',
    }
  }

  if (!payoutReady) {
    if (input?.payoutFirstReleaseReviewStatus === 'PENDING') {
      return {
        sellerStage: 'IDENTITY_VERIFIED',
        identityVerified,
        payoutReady,
        publicDiscoveryReady,
        canAcceptPaidOrders,
        canPublishPaidItems,
        payoutProviderLabel,
        blockers,
        title: 'Payout review in progress',
        body: 'You can take paid orders once this review clears.',
        actionLabel: 'View payout setup',
        tone: 'warning',
      }
    }
    const reconnect = needsReverification
    return {
      sellerStage: 'IDENTITY_VERIFIED',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: reconnect ? 'Reconnect your payout account' : 'Set up your payout account',
      body: reconnect
        ? 'Your payout details changed or need review again. Reconnect your payout account to start receiving earnings and unlock paid work again. It takes about 2 minutes.'
        : 'Set up your payout account to start receiving earnings. Paid quotes and live shop items stay blocked until a verified payout path is connected. It takes about 2 minutes.',
      actionLabel: reconnect ? 'Reconnect payout account' : 'Set up payout account',
      tone: 'warning',
    }
  }

  if (input?.isLive !== true) {
    return {
      sellerStage: 'PAYOUT_READY',
      identityVerified,
      payoutReady,
      publicDiscoveryReady,
      canAcceptPaidOrders,
      canPublishPaidItems,
      payoutProviderLabel,
      blockers,
      title: 'You are payout-ready',
      body: 'Your trust review and payout setup are complete. Review your storefront before going live.',
      actionLabel: 'Review live profile',
      tone: 'neutral',
    }
  }

  return {
    sellerStage: liveHigherRisk ? 'LIVE_HIGHER_RISK' : 'LIVE_STANDARD',
    identityVerified,
    payoutReady,
    publicDiscoveryReady,
    canAcceptPaidOrders,
    canPublishPaidItems,
    payoutProviderLabel,
    blockers,
    title: liveHigherRisk ? 'Live with international shipping' : 'Live and payout-ready',
    body: liveHigherRisk
      ? 'Your shop is live. Share international delivery details in each order thread.'
      : 'You can accept standard paid work and publish paid items with your current setup.',
    actionLabel: null,
    tone: 'success',
  }
}
