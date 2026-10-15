// Invalid explicit selectors must fail closed, never broaden to the latest list.
export function parseIncidentKey(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Invalid incident key')
  }
  return value.trim()
}
