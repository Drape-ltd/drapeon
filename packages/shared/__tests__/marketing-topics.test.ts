import {
  MARKETING_TOPIC_KEYS,
  canUseMarketingTopic,
  getMarketingTopic,
  isMarketingTopic,
  validateMarketingTopicAudience,
} from '../src/marketing-topics'

describe('marketing topic contract', () => {
  it('keeps provider aliases subordinate to a bounded product vocabulary', () => {
    expect(MARKETING_TOPIC_KEYS).toHaveLength(4)
    for (const key of MARKETING_TOPIC_KEYS) {
      const topic = getMarketingTopic(key)
      expect(topic.requiresExplicitConsent).toBe(true)
      expect(topic.providerTopicAlias).not.toBe(key)
      expect(topic.providerTopicAlias).not.toContain('@')
    }
  })

  it('enforces role and channel eligibility before delivery', () => {
    expect(canUseMarketingTopic('NEW_TAILOR_DROPS', 'CUSTOMER', 'EMAIL')).toBe(true)
    expect(canUseMarketingTopic('NEW_TAILOR_DROPS', 'TAILOR', 'EMAIL')).toBe(false)
    expect(canUseMarketingTopic('DRAPEON_STORIES', 'TAILOR', 'PUSH')).toBe(false)
    expect(isMarketingTopic('READY_MADE_EDITS')).toBe(true)
    expect(isMarketingTopic('PASSWORD_RESET')).toBe(false)
  })

  it('requires curated customer IDs for new tailor drops', () => {
    expect(validateMarketingTopicAudience('NEW_TAILOR_DROPS', { user_ids: ['customer-1'] })).toEqual({ ok: true })
    expect(validateMarketingTopicAudience('NEW_TAILOR_DROPS', { roles: ['CUSTOMER'] })).toMatchObject({ ok: false })
    expect(validateMarketingTopicAudience('NEW_TAILOR_DROPS', { user_ids: [], roles: [] })).toMatchObject({ ok: false })
    expect(validateMarketingTopicAudience('DRAPEON_STORIES', { roles: ['CUSTOMER'] })).toEqual({ ok: true })
  })
})
