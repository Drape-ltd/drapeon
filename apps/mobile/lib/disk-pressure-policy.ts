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
