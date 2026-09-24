import {
  LIFECYCLE_EVENT_REGISTRY,
  LIFECYCLE_EVENT_REGISTRY_VERSION,
  LIFECYCLE_FORBIDDEN_PROPERTIES,
  getLifecycleEventDefinition,
  isForbiddenLifecycleProperty,
  isLifecycleEventName,
  sanitizeLifecycleProperties,
} from '../src/lifecycle-events'

describe('lifecycle event registry', () => {
  it('is versioned and has unique, fully specified events', () => {
    expect(LIFECYCLE_EVENT_REGISTRY_VERSION).toBe(1)

    const names = LIFECYCLE_EVENT_REGISTRY.map((definition) => definition.name)
    expect(new Set(names).size).toBe(names.length)

    for (const definition of LIFECYCLE_EVENT_REGISTRY) {
      expect(definition.version).toBe(LIFECYCLE_EVENT_REGISTRY_VERSION)
      expect(definition.surfaces.length).toBeGreaterThan(0)
      expect(definition.trigger).not.toBe('')
      expect(definition.terminal.success).not.toBe('')
      expect(definition.terminal.failure).not.toBe('')
      expect(definition.correlationId).not.toBe('')
      expect(definition.dedupeKey).not.toBe('')
      expect(definition.negativeCase).not.toBe('')
      expect(definition.samplingRate).toBeGreaterThan(0)
      expect(definition.samplingRate).toBeLessThanOrEqual(1)
      expect(definition.forbiddenProperties).toEqual(LIFECYCLE_FORBIDDEN_PROPERTIES)
      expect(definition.allowedProperties).not.toEqual(
        expect.arrayContaining(LIFECYCLE_FORBIDDEN_PROPERTIES)
      )
    }
  })

  it('keeps lookup constrained to the registry', () => {
    expect(isLifecycleEventName('order_paid')).toBe(true)
    expect(getLifecycleEventDefinition('order_paid')?.source).toBe('AUTHORITATIVE_OPERATIONAL')
    expect(isLifecycleEventName('marketing_cta_clicked')).toBe(true)
    expect(getLifecycleEventDefinition('marketing_cta_clicked')?.surfaces).toEqual(['web'])
    expect(isLifecycleEventName('product_update_opened')).toBe(true)
    expect(getLifecycleEventDefinition('product_update_opened')?.allowedProperties).toEqual([
      'update_id',
      'entry_surface',
      'release',
    ])
    expect(isLifecycleEventName('waitlist_joined')).toBe(true)
    expect(getLifecycleEventDefinition('waitlist_joined')?.allowedProperties).toEqual([
      'role',
      'entry_surface',
    ])
    expect(getLifecycleEventDefinition('fit_profile_completed')?.allowedProperties).toEqual([
      'entry_surface',
      'completion_method',
      'field_count_bucket',
    ])
    expect(getLifecycleEventDefinition('order_started')?.allowedProperties).toEqual([
      'tailor_id_hash',
      'item_id_hash',
      'order_kind',
      'entry_surface',
    ])
    expect(isLifecycleEventName('arbitrary_private_event')).toBe(false)
    expect(getLifecycleEventDefinition('arbitrary_private_event')).toBeNull()
  })

  it('keeps payment and feedback events out of optional marketing consent', () => {
    expect(getLifecycleEventDefinition('order_paid')?.consentBasis).toBe('REQUIRED_OPERATIONAL')
    expect(getLifecycleEventDefinition('survey_submitted')?.consentBasis).toBe(
      'REQUIRED_OPERATIONAL'
    )
    expect(getLifecycleEventDefinition('survey_submitted')?.actorRole).toBe('SYSTEM')
  })

  it('allow-lists primitive payloads and rejects private or unknown properties', () => {
    expect(isForbiddenLifecycleProperty('email')).toBe(true)
    expect(isForbiddenLifecycleProperty('refresh_token')).toBe(true)
    expect(isForbiddenLifecycleProperty('accessToken')).toBe(true)
    expect(isForbiddenLifecycleProperty('profile_variant')).toBe(false)

    expect(
      sanitizeLifecycleProperties('tailor_profile_viewed', {
        tailor_id_hash: 'hash',
        media_ready: true,
        email: 'private@example.com',
        nested: { value: 'not allowed' },
      })
    ).toEqual({
      accepted: { tailor_id_hash: 'hash', media_ready: true },
      rejected: ['email', 'nested'],
    })

    expect(sanitizeLifecycleProperties('unknown_event', { page: 'home' })).toEqual({
      accepted: {},
      rejected: ['page'],
    })

    expect(
      sanitizeLifecycleProperties('waitlist_joined', {
        role: 'TAILOR',
        entry_surface: 'web',
        email: 'private@example.com',
      })
    ).toEqual({
      accepted: { role: 'TAILOR', entry_surface: 'web' },
      rejected: ['email'],
    })
  })
})
