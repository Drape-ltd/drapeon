// Navigation only: destination pages still enforce their own permissions.
export function opsContextReturn(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\x00-\x20]/.test(value)) return null
  const path = value.split(/[?#]/, 1)[0]
  if (!/^\/ops\/(?:my-work|overview|queues\/[a-z-]+|providers|communications|money|orders(?:\/[a-f0-9-]{36})?|customers(?:\/[a-f0-9-]{36})?|tailors(?:\/[a-f0-9-]{36})?|cases\/OPS-[A-Z0-9-]+)$/.test(path)) return null
  return value
}
