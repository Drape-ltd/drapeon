/** Re-read Bachs immediately before Ops decides the first payout review. */
export async function refreshBachsPayoutDestination({
  supabaseUrl,
  serviceRoleKey,
  destinationId,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/payout-account-action`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'X-Drape-Service-Key': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'ops-refresh-bachs-destination', destinationId }),
      cache: 'no-store',
    }
  )
  const payload = await response.json().catch(() => null)
  const providerCode =
    typeof payload?.code === 'string' && /^[A-Z0-9_-]{1,80}$/u.test(payload.code)
      ? payload.code
      : null
  return response.ok && payload?.ok
    ? { ok: true }
    : { ok: false, errorCode: providerCode ?? `HTTP_${response.status}` }
}

/** Queue the audited tailor notice after the review RPC commits. */
export async function notifyBachsPayoutDestinationReview({
  supabaseUrl,
  serviceRoleKey,
  destinationId,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/payout-account-action`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'X-Drape-Service-Key': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'ops-notify-bachs-first-review', destinationId }),
      cache: 'no-store',
    }
  )
  const payload = await response.json().catch(() => null)
  return response.ok && payload?.ok
    ? { ok: true, pushJobId: payload.pushJobId, emailJobId: payload.emailJobId }
    : { ok: false, errorCode: `HTTP_${response.status}` }
}
