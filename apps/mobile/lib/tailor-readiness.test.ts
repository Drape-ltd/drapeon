import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveTailorReadiness, type TailorReadinessInput } from './tailor-readiness.ts'

test('seller readiness names the trust video in every review state', () => {
  const cases: Array<[string, string, string]> = [
    ['NOT_SUBMITTED', 'Submit your trust video', 'Record trust video'],
    ['PENDING', 'Trust review in progress', 'Set up payout while you wait'],
    ['REJECTED', 'Trust review needs an update', 'Update trust video'],
  ]

  for (const [status, title, actionLabel] of cases) {
    const readiness = deriveTailorReadiness({ profileCompleted: true, idVerificationStatus: status })
    assert.equal(readiness.title, title)
    assert.equal(readiness.actionLabel, actionLabel)
    assert.match(readiness.body, /trust video|trust review/i)
    assert.doesNotMatch(
      [readiness.title, readiness.body, readiness.actionLabel, ...readiness.blockers].join(' '),
      /identity|document|appeal|verification|ops-visible|higher-risk/i,
    )
  }
})

test('ready and international states use customer-facing wording', () => {
  const incomplete = deriveTailorReadiness({ profileCompleted: false })
  assert.match(incomplete.body, /record a trust video/i)
  assert.doesNotMatch(incomplete.body, /verification|identity|document|appeal/i)

  const ready: TailorReadinessInput = {
    profileCompleted: true,
    idVerificationStatus: 'VERIFIED',
    payoutAccountVerified: true,
    payoutFirstReleaseReviewStatus: 'CLEARED',
  }
  const notLive = deriveTailorReadiness(ready)
  assert.match(notLive.body, /trust review and payout setup are complete/i)

  const international = deriveTailorReadiness({ ...ready, isLive: true, shipsInternationally: true })
  assert.equal(international.title, 'Live with international shipping')
  assert.match(international.body, /international delivery details/i)
  assert.doesNotMatch(international.body, /higher-risk|conservative|ops-visible/i)
})
