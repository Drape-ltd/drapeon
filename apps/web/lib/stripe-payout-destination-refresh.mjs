/**
 * Refresh the provider state pinned to a Stripe payout destination.
 *
 * @param {{
 *   supabaseUrl: string,
 *   serviceRoleKey: string,
 *   destinationId: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function refreshStripePayoutDestination({
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
      body: JSON.stringify({ action: 'ops-refresh-stripe-destination', destinationId }),
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
    : {
        ok: false,
        errorCode: providerCode ?? `HTTP_${response.status}`,
      }
}
