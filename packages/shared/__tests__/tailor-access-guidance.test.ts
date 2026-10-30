import { deriveTailorAccessGuidance, tailorTrustReviewStatusCopy } from '../../../apps/mobile/lib/tailor-access'
import type { TailorReadinessInput } from '../../../apps/mobile/lib/tailor-readiness'

const readyTailor: TailorReadinessInput = {
  profileCompleted: true,
  idVerificationStatus: 'VERIFIED',
  isLive: false,
  payoutAccountVerified: true,
  payoutReverificationRequired: false,
  payoutAccountType: 'STRIPE_CONNECT',
  shipsInternationally: false,
}

const cases: Array<{
  name: string
  input: TailorReadinessInput
  expected: { title: string; body: string; reasonCategory: string; nextStep: string }
}> = [
  {
    name: 'profile setup',
    input: { ...readyTailor, profileCompleted: false, idVerificationStatus: 'NOT_SUBMITTED' },
    expected: {
      title: 'Finish your profile to open seller access',
      body: 'Add your shop details and portfolio so customers can find your work.',
      reasonCategory: 'Profile setup',
      nextStep: 'Complete your public profile and return here if access still looks blocked.',
    },
  },
  {
    name: 'trust video not submitted',
    input: { ...readyTailor, idVerificationStatus: 'NOT_SUBMITTED' },
    expected: {
      title: 'Submit a trust video to open seller access',
      body: 'We need your trust video and profile before customers can find or pay your shop.',
      reasonCategory: 'Trust review',
      nextStep: 'Record a trust video in setup, then return here.',
    },
  },
  {
    name: 'trust review in progress',
    input: { ...readyTailor, idVerificationStatus: 'PENDING' },
    expected: {
      title: 'Trust review in progress',
      body: "We're reviewing your trust video and profile.",
      reasonCategory: 'Trust review',
      nextStep: "We'll update this page when the review is complete.",
    },
  },
  {
    name: 'trust review needs an update',
    input: { ...readyTailor, idVerificationStatus: 'REJECTED' },
    expected: {
      title: 'Trust review needs an update',
      body: 'Your trust video or profile needs an update before access can expand.',
      reasonCategory: 'Trust review',
      nextStep: 'Record a new trust video or update your profile in setup, then submit again.',
    },
  },
  {
    name: 'payout setup',
    input: { ...readyTailor, payoutAccountVerified: false },
    expected: {
      title: 'Set up your payout account before paid work opens',
      body: 'Your trust review is complete, but payout setup is not ready yet.',
      reasonCategory: 'Payout readiness',
      nextStep: 'Finish payout setup before accepting paid work.',
    },
  },
  {
    name: 'international shipping',
    input: { ...readyTailor, isLive: true, shipsInternationally: true },
    expected: {
      title: 'Standard seller access is open',
      body: 'Your setup supports standard paid work. Keep international order details clear in each order thread.',
      reasonCategory: 'International shipping',
      nextStep: 'Keep your storefront and payout details current. Share order details in Drapeon so support can help.',
    },
  },
  {
    name: 'standard access',
    input: readyTailor,
    expected: {
      title: 'Seller access is ready',
      body: 'Your profile, trust review, and payout setup are ready for standard paid work.',
      reasonCategory: 'Normal access',
      nextStep: 'Keep your storefront and payout details up to date.',
    },
  },
]

describe('tailor access guidance', () => {
  it.each(cases)('$name uses the approved plain-language status copy', ({ input, expected }) => {
    const guidance = deriveTailorAccessGuidance(input)
    const copy = [
      guidance.title,
      guidance.body,
      guidance.reasonCategory,
      guidance.nextStep,
      guidance.supportLabel,
      guidance.supportSubject,
      ...guidance.blockedCapabilities,
    ].join(' ')

    expect(copy).not.toMatch(/identity|document|appeal/i)
    expect(guidance).toMatchObject(expected)
  })

  it('describes the pending trust review and keeps its blocked capability list', () => {
    const guidance = deriveTailorAccessGuidance({ ...readyTailor, idVerificationStatus: 'PENDING' })

    expect(guidance).toMatchObject({
      state: 'UNDER_REVIEW',
      title: 'Trust review in progress',
      body: "We're reviewing your trust video and profile.",
      reasonCategory: 'Trust review',
      nextStep: "We'll update this page when the review is complete.",
    })
    expect(guidance.blockedCapabilities).toEqual([
      'Public discovery stays limited',
      'Paid quotes stay blocked',
      'Live paid shop items stay blocked',
    ])
  })

  it('keeps trust video status accurate for the existing setup hint', () => {
    expect(tailorTrustReviewStatusCopy('PENDING')).toBe('Trust review in progress.')
    expect(tailorTrustReviewStatusCopy('VERIFIED')).toBe('Trust review complete.')
    expect(tailorTrustReviewStatusCopy('APPROVED')).toBe('Trust review complete.')
    expect(tailorTrustReviewStatusCopy('REJECTED')).toBe('Trust review needs an update.')
    expect(tailorTrustReviewStatusCopy('NOT_SUBMITTED')).toBe('Trust video submitted.')
  })
})
