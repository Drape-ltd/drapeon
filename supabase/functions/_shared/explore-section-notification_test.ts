import {
  exploreSectionMoveEmailForJob,
  exploreSectionMovePushForJob,
} from '../../../packages/shared/src/marketplace-category.ts'

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

for (const [category, label] of [['TAILORING', 'Tailors'], ['READY_TO_WEAR', 'Ready-made']] as const) {
  Deno.test(`the queue's push and email handlers use shared ${label} move copy`, () => {
    const payload = { eventType: 'explore_section_moved', exploreSectionMove: category, userId: 'qa-user' }
    const push = exploreSectionMovePushForJob(payload, `move-${category}`)
    const email = exploreSectionMoveEmailForJob(payload)
    expect(push?.body === `You now appear in ${label} on Explore`, 'push must use the public shared copy')
    expect(email?.message === push?.body, 'email and push must use the same shared copy')
    expect(email?.reviewPath === '/account/support', 'email must link to section review')
    expect(push?.data.url === email?.reviewUrl, 'push must link to section review')
    expect(push?.communication.inApp === true && push.communication.strictInApp === true, 'push must persist an in-app notice')
    expect(push?.communication.deduplicationKey === `move-${category}`, 'push must carry the job dedupe key')
    expect(!JSON.stringify({ push, email }).includes('internal reason'), 'customer copy must not include an Ops reason')
  })
}

Deno.test('non-move jobs retain their existing push and email handling', () => {
  const payload = { eventType: 'verification_approved', exploreSectionMove: 'READY_TO_WEAR' }
  expect(exploreSectionMovePushForJob(payload, 'approval') === null, 'approval must not become a section-move push')
  expect(exploreSectionMoveEmailForJob(payload) === null, 'approval must not become a section-move email')
})

Deno.test('an invalid move category fails the queue job', () => {
  const payload = { eventType: 'explore_section_moved', exploreSectionMove: 'OTHER' }
  let failed = 0
  try { exploreSectionMovePushForJob(payload, 'bad-move') } catch { failed += 1 }
  try { exploreSectionMoveEmailForJob(payload) } catch { failed += 1 }
  expect(failed === 2, 'both handlers must reject an invalid section')
})
