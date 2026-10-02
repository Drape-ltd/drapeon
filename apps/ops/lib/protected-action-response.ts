function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A 2xx response is not proof of a completed protected action without its receipt. */
export function validProtectedActionSuccess(value: unknown): boolean {
  if (!isObject(value) || value.ok !== true || !isObject(value.receipt)) return false
  if (value.duplicate === true) {
    return typeof value.receipt.receiptId === 'string' && value.receipt.receiptId.length > 0 &&
      value.receipt.receiptOutcome === 'SUCCEEDED'
  }
  return typeof value.receipt.id === 'string' && value.receipt.id.length > 0 &&
    value.receipt.outcome === 'SUCCEEDED'
}
