export function requestRefundOrderPayments({ supabaseUrl, serviceRoleKey, body, fetchImpl = fetch }) {
  return fetchImpl(`${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/refund-order-payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'X-Drape-Service-Key': serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
