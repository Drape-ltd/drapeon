import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isMarketingTopicKey, MARKETING_TOPIC_KEYS } from './communications.ts'
import { canUseMarketingTopic } from '../../../packages/shared/src/marketing-topics.ts'

Deno.test('Edge uses the canonical shared marketing vocabulary', () => {
  assertEquals(MARKETING_TOPIC_KEYS.length, 4)
  for (const key of MARKETING_TOPIC_KEYS) assertEquals(isMarketingTopicKey(key), true)
  for (const value of [null, undefined, {}, [], 5, 'new_tailor_drops', 'UNKNOWN']) assertEquals(isMarketingTopicKey(value), false)
})
Deno.test('topics preserve account role and channel restrictions', () => {
  assertEquals(canUseMarketingTopic('NEW_TAILOR_DROPS', 'TAILOR', 'EMAIL'), false)
  assertEquals(canUseMarketingTopic('READY_MADE_EDITS', 'TAILOR', 'PUSH'), false)
  assertEquals(canUseMarketingTopic('DRAPEON_STORIES', 'CUSTOMER', 'PUSH'), false)
  assertEquals(canUseMarketingTopic('LAUNCH_EVENTS', 'TAILOR', 'EMAIL'), true)
})
