import {
  getWelcomeMessage,
  getWelcomeSequence,
  welcomeIdempotencyKey,
} from '../src/lifecycle-welcome'

describe('welcome sequence contract', () => {
  it('keeps customer and tailor sequences role-specific and actionable', () => {
    for (const role of ['CUSTOMER', 'TAILOR'] as const) {
      const sequence = getWelcomeSequence(role)
      expect(sequence).toHaveLength(2)
      expect(sequence.map((message) => message.step)).toEqual(['WELCOME', 'NEXT_STEP'])
      expect(sequence.every((message) => message.role === role)).toBe(true)
      expect(sequence.every((message) => message.category === 'ACCOUNT')).toBe(true)
      expect(sequence.every((message) => message.purpose === 'TRANSACTIONAL')).toBe(true)
      expect(
        sequence.every((message) => message.ctaLabel && message.webPath && message.appUrl)
      ).toBe(true)
    }

    expect(getWelcomeMessage('CUSTOMER', 'NEXT_STEP')?.webPath).toBe('/account/measurements')
    expect(getWelcomeMessage('TAILOR', 'NEXT_STEP')?.webPath).toBe('/account/profile?setup=1')
  })

  it('uses a stable per-user key and rejects an empty user id', () => {
    expect(welcomeIdempotencyKey('user-123', 'CUSTOMER', 'WELCOME')).toBe(
      'welcome:customer:user-123:welcome'
    )
    expect(() => welcomeIdempotencyKey('  ', 'TAILOR', 'WELCOME')).toThrow('userId is required')
  })
})
