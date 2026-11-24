import { deriveBachsPayoutPresentation, type BachsPayoutStatusInput } from '../bachs-payout-status'

const readyProvider: BachsPayoutStatusInput = {
  transfersEnabled: true,
  payoutsEnabled: true,
  firstWithdrawalReviewStatus: 'PENDING',
  active: false,
  onboardingDueCount: 0,
  onboardingPendingCount: 0,
  hasProviderDestination: true,
}

describe('Bachs payout presentation', () => {
  it.each([
    ['not started', null, 'NOT_STARTED', 'START'],
    ['requirements due', { ...readyProvider, onboardingDueCount: 2 }, 'REQUIREMENTS_DUE', 'CONTINUE_BACHS'],
    ['Bachs review', { ...readyProvider, onboardingPendingCount: 1 }, 'PROVIDER_REVIEWING', 'WAIT'],
    ['first payout review', readyProvider, 'FIRST_PAYOUT_REVIEW', 'WAIT'],
    ['cleared', { ...readyProvider, firstWithdrawalReviewStatus: 'CLEARED', active: true }, 'READY', 'NONE'],
    ['blocked', { ...readyProvider, firstWithdrawalReviewStatus: 'BLOCKED' }, 'BLOCKED', 'CONTACT_SUPPORT'],
    ['restricted later', { ...readyProvider, firstWithdrawalReviewStatus: 'CLEARED', transfersEnabled: false }, 'RESTRICTED', 'CONTACT_SUPPORT'],
    ['destination rejected', { ...readyProvider, hasProviderDestination: false }, 'DESTINATION_REJECTED', 'CONTACT_SUPPORT'],
  ] as const)('%s', (_name, destination, state, nextAction) => {
    const result = deriveBachsPayoutPresentation(destination)
    expect(result.state).toBe(state)
    expect(result.nextAction).toBe(nextAction)
    expect(result.ready).toBe(state === 'READY')
  })

  it('does not show Drapeon first-payout review while Bachs still needs documents', () => {
    const result = deriveBachsPayoutPresentation({ ...readyProvider, onboardingDueCount: 1 })
    expect(result.label).toBe('Finish with Bachs')
    expect(result.detail).not.toContain('Drapeon is reviewing')
  })
})
