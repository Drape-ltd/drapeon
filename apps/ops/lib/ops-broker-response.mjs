/**
 * Preserve a valid Edge response, but never turn an interrupted or malformed
 * action response into an apparent success. The caller adds no-store headers.
 * @param {() => Promise<Response>} request
 * @param {string} correlationId
 */
export async function resolveOpsBrokerResponse(request, correlationId) {
  const interrupted = { status: 502, payload: { error: 'Response interrupted. Reread the record before retrying the same action.', code: 'OPS_BROKER_INTERRUPTED', correlationId } }
  const invalid = { status: 502, payload: { error: 'The Ops response could not be verified. Reread the record before retrying.', code: 'OPS_BROKER_INVALID_RESPONSE', correlationId } }
  let response
  try {
    response = await request()
  } catch {
    return interrupted
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return invalid
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid
  }
  if (response.ok && (payload.ok !== true || (typeof payload.error === 'string' && payload.error.trim()))) {
    return invalid
  }
  return { status: response.status, payload: { ...payload, correlationId: payload.correlationId ?? correlationId } }
}
