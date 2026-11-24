import { Directory, File, Paths } from 'expo-file-system'
import { selectTransientCacheRemovals } from './disk-pressure-policy'

/**
 * Removes only abandoned app-owned style-plan files. Expo Updates' internal
 * store is deliberately left alone because it has no supported cleanup API.
 */
export function cleanupTransientMobileCache() {
  const directory = new Directory(Paths.cache, 'studio-style-plans')
  if (!directory.exists) return 0

  const files = directory.list().filter((entry): entry is File => entry instanceof File)
  const entries = files.map((file) => {
    const info = file.info()
    return {
      uri: file.uri,
      size: info.size ?? 0,
      modifiedAt: info.modificationTime ?? 0,
    }
  })
  const removals = selectTransientCacheRemovals(entries)
  for (const entry of removals) {
    try {
      new File(entry.uri).delete()
    } catch {
      // Best effort: cache maintenance must never block app startup.
    }
  }
  return removals.length
}
