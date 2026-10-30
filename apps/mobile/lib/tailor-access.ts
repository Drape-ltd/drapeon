import { CONTACTS } from '@drape/shared'
import { deriveTailorReadiness, type TailorReadinessInput } from './tailor-readiness'

export type TailorAccessState = 'CLEAR' | 'FIX_REQUIRED' | 'UNDER_REVIEW'

export type TailorAccessGuidance = {
  state: TailorAccessState
  title: string
  body: string
  reasonCategory: string
  blockedCapabilities: string[]
  nextStep: string
  supportEmail: string | null
  supportLabel: string | null
  supportSubject: string | null
}

export function tailorTrustReviewStatusCopy(status: string | null | undefined) {
  if (status === 'PENDING') return 'Trust review in progress.'
  if (status === 'REJECTED') return 'Trust review needs an update.'
  if (status === 'VERIFIED' || status === 'APPROVED') return 'Trust review complete.'
  return 'Trust video submitted.'
}

function sharedBlockedCapabilities(readiness: ReturnType<typeof deriveTailorReadiness>) {
  const blocked: string[] = []

  if (!readiness.publicDiscoveryReady) {
    blocked.push('Public discovery stays limited')
  }

  if (!readiness.canAcceptPaidOrders) {
    blocked.push('Paid quotes stay blocked')
  }

  if (!readiness.canPublishPaidItems) {
    blocked.push('Live paid shop items stay blocked')
  }

  return blocked
}

export function deriveTailorAccessGuidance(input: TailorReadinessInput | null | undefined): TailorAccessGuidance {
  const readiness = deriveTailorReadiness(input)
  const idStatus = input?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const liveHigherRisk = input?.isLive === true && input?.shipsInternationally === true
  const blockedCapabilities = sharedBlockedCapabilities(readiness)

  if (!input?.profileCompleted) {
    return {
      state: 'FIX_REQUIRED',
      title: 'Finish your profile to open seller access',
      body: 'Add your shop details and portfolio so customers can find your work.',
      reasonCategory: 'Profile setup',
      blockedCapabilities,
      nextStep: 'Complete your public profile and return here if access still looks blocked.',
      supportEmail: CONTACTS.tailors,
      supportLabel: 'Tailor support',
      supportSubject: 'Drapeon tailor setup help',
    }
  }

  if (idStatus === 'PENDING') {
    return {
      state: 'UNDER_REVIEW',
      title: 'Trust review in progress',
      body: "We're reviewing your trust video and profile.",
      reasonCategory: 'Trust review',
      blockedCapabilities,
      nextStep: "We'll update this page when the review is complete.",
      supportEmail: CONTACTS.verify,
      supportLabel: 'Trust review team',
      supportSubject: 'Drapeon trust review follow-up',
    }
  }

  if (idStatus === 'REJECTED') {
    return {
      state: 'FIX_REQUIRED',
      title: 'Trust review needs an update',
      body: 'Your trust video or profile needs an update before access can expand.',
      reasonCategory: 'Trust review',
      blockedCapabilities,
      nextStep: 'Record a new trust video or update your profile in setup, then submit again.',
      supportEmail: CONTACTS.verify,
      supportLabel: 'Trust review team',
      supportSubject: 'Drapeon trust review follow-up',
    }
  }

  if (idStatus !== 'VERIFIED' && idStatus !== 'APPROVED') {
    return {
      state: 'FIX_REQUIRED',
      title: 'Submit a trust video to open seller access',
      body: 'We need your trust video and profile before customers can find or pay your shop.',
      reasonCategory: 'Trust review',
      blockedCapabilities,
      nextStep: 'Record a trust video in setup, then return here.',
      supportEmail: CONTACTS.tailors,
      supportLabel: 'Tailor support',
      supportSubject: 'Drapeon trust review question',
    }
  }

  if (!readiness.payoutReady) {
    return {
      state: 'FIX_REQUIRED',
      title: 'Set up your payout account before paid work opens',
      body: 'Your trust review is complete, but payout setup is not ready yet.',
      reasonCategory: 'Payout readiness',
      blockedCapabilities,
      nextStep: 'Finish payout setup before accepting paid work.',
      supportEmail: CONTACTS.payouts,
      supportLabel: 'Payouts',
      supportSubject: 'Drapeon payout readiness question',
    }
  }

  if (liveHigherRisk) {
    return {
      state: 'CLEAR',
      title: 'Standard seller access is open',
      body: 'Your setup supports standard paid work. Keep international order details clear in each order thread.',
      reasonCategory: 'International shipping',
      blockedCapabilities,
      nextStep: 'Keep your storefront and payout details current. Share order details in Drapeon so support can help.',
      supportEmail: CONTACTS.tailors,
      supportLabel: 'Tailor support',
      supportSubject: 'Drapeon tailor trust question',
    }
  }

  return {
    state: 'CLEAR',
    title: 'Seller access is ready',
    body: 'Your profile, trust review, and payout setup are ready for standard paid work.',
    reasonCategory: 'Normal access',
    blockedCapabilities,
    nextStep: 'Keep your storefront and payout details up to date.',
    supportEmail: CONTACTS.tailors,
    supportLabel: 'Tailor support',
    supportSubject: 'Drapeon tailor trust question',
  }
}
