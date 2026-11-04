import {
  ACTION_ERROR_COPY,
  friendlyActionError,
  isDisplayableActionError,
  isLikelyConnectivityIssue,
  isMachineErrorCodeMessage,
} from '../src/action-errors'

describe('action error presentation', () => {
  it.each([
    'PAYMENT_FAILED',
    'AUTH:INVALID_SESSION',
    'HTTP-500',
  ])('recognizes machine-only error code %s', (value) => {
    expect(isMachineErrorCodeMessage(value)).toBe(true)
    expect(isDisplayableActionError(value)).toBe(false)
  })

  it.each([
    'Internal server error',
    'Failed to send a request to the Edge Function',
    'Validation error: expected string, received number',
  ])('blocks implementation detail %s', (value) => {
    expect(isDisplayableActionError(value)).toBe(false)
  })

  it('keeps specific, user-safe provider messages', () => {
    expect(isDisplayableActionError('This payout account needs another review.')).toBe(true)
    expect(
      friendlyActionError(new Error('This payout account needs another review.'))
    ).toBe('This payout account needs another review.')
  })

  it.each([
    new Error('Failed to fetch'),
    { message: 'Network request failed' },
    new Error('The internet connection appears to be offline'),
  ])('maps connectivity failures to recoverable copy', (error) => {
    expect(isLikelyConnectivityIssue(error)).toBe(true)
    expect(friendlyActionError(error)).toBe(ACTION_ERROR_COPY.save)
  })

  it('exports distinct load, save, and unknown-outcome copy', () => {
    expect(ACTION_ERROR_COPY).toEqual({
      load: "Couldn't load this. Check your connection and try again.",
      save: "Couldn't save this. Check your connection and try again.",
      unknownOutcome: "We couldn't confirm this went through. Check the order before trying again.",
    })
  })

  it('removes the FunctionsHttpError wrapper from safe messages', () => {
    expect(
      friendlyActionError({ message: 'FunctionsHttpError: Quote approval has expired.' })
    ).toBe('Quote approval has expired.')
  })

  it('uses the caller fallback for unsafe or missing errors', () => {
    expect(friendlyActionError(new Error('INTERNAL_ERROR'), 'Try again later.')).toBe(
      'Try again later.'
    )
    expect(friendlyActionError(null, 'Try again later.')).toBe('Try again later.')
  })
})
