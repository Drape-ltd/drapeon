import { enqueueBackgroundJob } from './jobs.ts'

export async function enqueueBachsPayoutChangeRequested(
  supabase: any,
  input: { requestId: string; userId: string; bankName: string | null; masked: string | null },
) {
  const lastFour = input.masked?.replace(/\D/gu, '').slice(-4)
  const account = lastFour
    ? `${input.bankName ?? 'New payout account'} ending ${lastFour}`
    : 'your new payout account'
  const title = 'Confirm your payout change'
  const body = `Confirm ${account} within 48 hours. Your current payout account remains in place until then.`
  const [pushJobId, emailJobId] = await Promise.all([
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_CHANGE_REQUESTED',
      aggregateType: 'PAYOUT_CHANGE_REQUEST',
      aggregateId: input.requestId,
      actorId: input.userId,
      actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:requested:push`,
      jobType: 'SEND_PUSH',
      priority: 35,
      payload: {
        userId: input.userId,
        notification: {
          title,
          body,
          data: { url: '/profile/payout-setup', payoutChangeRequestId: input.requestId },
          preferenceKey: 'paymentReleased',
        },
      },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_CHANGE_REQUESTED',
      aggregateType: 'PAYOUT_CHANGE_REQUEST',
      aggregateId: input.requestId,
      actorId: input.userId,
      actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:requested:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL',
      priority: 35,
      payload: {
        userId: input.userId,
        subject: 'Confirm your Drapeon payout change',
        headline: title,
        body,
        eyebrow: 'Payout account update',
        ctaLabel: 'Review payout change',
        webPath: '/account/payout',
        appUrl: 'drape://profile/payout-setup',
        details: [{ label: 'Requested destination', value: account }],
      },
    }),
  ])
  return { pushJobId, emailJobId }
}

export async function enqueueBachsPayoutChangeRejected(
  supabase: any,
  input: { requestId: string; userId: string },
) {
  const title = 'Bachs could not verify your new payout bank'
  const body = 'Your previous bank remains selected. Review the reason in your payout settings and start a new change when ready.'
  const [pushJobId, emailJobId] = await Promise.all([
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_CHANGE_REJECTED', aggregateType: 'PAYOUT_CHANGE_REQUEST',
      aggregateId: input.requestId, actorId: input.userId, actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:rejected:push`,
      jobType: 'SEND_PUSH', priority: 35,
      payload: { userId: input.userId, notification: { title, body,
        data: { url: '/profile/payout-setup', payoutChangeRequestId: input.requestId },
        preferenceKey: 'paymentReleased' } },
    }),
    enqueueBackgroundJob(supabase, {
      eventType: 'PAYOUT_CHANGE_REJECTED', aggregateType: 'PAYOUT_CHANGE_REQUEST',
      aggregateId: input.requestId, actorId: input.userId, actorRole: 'TAILOR',
      idempotencyKey: `payout-change:${input.requestId}:rejected:email`,
      jobType: 'SEND_ACCOUNT_EVENT_EMAIL', priority: 35,
      payload: { userId: input.userId, subject: title, headline: title,
        body, eyebrow: 'Payout account update', ctaLabel: 'View payout account',
        webPath: '/account/payout', appUrl: 'drape://profile/payout-setup', details: [] },
    }),
  ])
  return { pushJobId, emailJobId }
}
