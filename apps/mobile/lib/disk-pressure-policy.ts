const MAX_TRANSIENT_FILES = 4
const MAX_TRANSIENT_BYTES = 20_000_000

export type CacheEntry = {
  uri: string
  size: number
  modifiedAt: number
}

export function selectTransientCacheRemovals(entries: CacheEntry[]) {
  const newestFirst = [...entries].sort((a, b) => b.modifiedAt - a.modifiedAt)
  let keptBytes = 0

  return newestFirst.filter((entry, index) => {
    keptBytes += entry.size
    return index >= MAX_TRANSIENT_FILES || keptBytes > MAX_TRANSIENT_BYTES
  })
}

export function isDiskFullManifestError(value: unknown) {
  const message = typeof value === 'string'
    ? value
    : value instanceof Error
      ? `${value.name}: ${value.message}`
      : ''

  return /(?:enospc|no space left on device|disk(?: is)? full)/iu.test(message)
    && /manifest(?:\.json)?/iu.test(message)
}

export function shouldSampleDiskFullEvent(eventId: string | undefined, rate = 0.1) {
  if (!eventId) return true
  const bucket = Number.parseInt(eventId.slice(0, 8), 16)
  if (!Number.isFinite(bucket)) return true
  return bucket / 0xffff_ffff < rate
}
