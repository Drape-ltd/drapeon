import {
  isRealtimeFilterValue,
  uniqueRealtimeOrderIds,
} from '../src/realtime-identifiers'

describe('realtime filter identifiers', () => {
  it.each(['order_123', 'abc-DEF_456', '123456'])(
    'accepts a safe identifier: %s',
    (value) => {
      expect(isRealtimeFilterValue(value)).toBe(true)
    }
  )

  it.each([
    null,
    undefined,
    '',
    'short',
    'order.id=eq.unsafe',
    'space value',
    'a'.repeat(121),
  ])('rejects an unsafe identifier: %s', (value) => {
    expect(isRealtimeFilterValue(value)).toBe(false)
  })

  it('deduplicates, filters, and preserves identifier order', () => {
    expect(
      uniqueRealtimeOrderIds([
        'order_123',
        null,
        'unsafe.value',
        'order_456',
        'order_123',
      ])
    ).toEqual(['order_123', 'order_456'])
  })

  it('caps the subscription list at sixty identifiers by default', () => {
    const values = Array.from({ length: 75 }, (_, index) => `order_${index}`)
    expect(uniqueRealtimeOrderIds(values)).toHaveLength(60)
  })

  it('supports an explicit non-negative limit', () => {
    expect(uniqueRealtimeOrderIds(['order_1', 'order_2'], 1)).toEqual(['order_1'])
    expect(uniqueRealtimeOrderIds(['order_1'], -1)).toEqual([])
  })
})
