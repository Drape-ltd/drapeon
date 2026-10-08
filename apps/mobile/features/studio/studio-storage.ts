import { Directory, File, Paths } from 'expo-file-system'
import {
  parseSavedLooks,
  studioStorageKey,
  MAX_STUDIO_BYTES,
  parseDraft,
} from '../../../../packages/drape-studio/src/studio-storage'
export { parseSavedLooks }
const MAX_STUDIO_DRAFT_BYTES = 1_000_000
function files(owner: string, suffix = '') {
  const dir = new Directory(Paths.document, 'studio-drafts')
  dir.create({ intermediates: true, idempotent: true })
  const key = studioStorageKey(owner)
  return { main: new File(dir, `${key}${suffix}.json`), backup: new File(dir, `${key}${suffix}.backup.json`) }
}
export function loadStudioLooks(owner: string) {
  const { main, backup } = files(owner)
  if (!main.exists && !backup.exists) return []
  for (const f of [main, backup]) {
    if (!f.exists || f.size > MAX_STUDIO_BYTES) continue
    try {
      return parseSavedLooks(JSON.parse(f.textSync()))
    } catch {
      /* Try the last good save. */
    }
  }
  throw Error('Saved designs could not be read. They have been kept on this device.')
}
export function saveStudioLooks(owner: string, raw: unknown) {
  const looks = parseSavedLooks(raw),
    { main, backup } = files(owner)
  if (main.exists) {
    const previous = main.textSync()
    parseSavedLooks(JSON.parse(previous))
    backup.write(previous)
  }
  main.write(JSON.stringify(looks))
  return looks
}
export function loadStudioDraft(owner: string) {
  const { main, backup } = files(owner, '-draft')
  if (!main.exists && !backup.exists) return null
  for (const file of [main, backup]) {
    if (!file.exists || file.size > MAX_STUDIO_DRAFT_BYTES) continue
    try {
      const draft = parseDraft(JSON.parse(file.textSync()))
      if (draft) return draft
    } catch { /* Recover from the last complete draft save. */ }
  }
  throw Error('Your latest draft could not be read. It has been kept on this device.')
}
export function saveStudioDraft(owner: string, raw: unknown) {
  const draft = parseDraft(raw)
  if (!draft || JSON.stringify(draft).length > MAX_STUDIO_DRAFT_BYTES) throw Error('This draft is too large to save.')
  const { main, backup } = files(owner, '-draft')
  if (main.exists) {
    const previous = main.textSync()
    if (parseDraft(JSON.parse(previous))) backup.write(previous)
  }
  main.write(JSON.stringify(draft))
}
