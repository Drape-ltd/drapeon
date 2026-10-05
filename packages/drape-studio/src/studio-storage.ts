import { parseLook, type Look } from './studio-state.ts'
export const MAX_STUDIO_BYTES = 8_000_000
export function parseSavedLooks(raw: unknown): Look[] {
  if (!Array.isArray(raw) || raw.length > 12) throw Error('This collection is not supported.')
  if (JSON.stringify(raw).length > MAX_STUDIO_BYTES)
    throw Error('These designs are too large to save together.')
  return raw.map(parseLook)
}
export function studioStorageKey(owner: string) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(owner)) throw Error('Sign in to save your designs.')
  return `drape-studio-v1-${owner}`
}
export function studioDraftKey(owner: string) {
  return `${studioStorageKey(owner)}-draft`
}
export function parseDraft(raw: unknown): Look | null {
  return raw == null ? null : parseLook(raw)
}
export type StudioBriefHandoff = { image: string; notes: string; name: string; design: Look }
export function parseStudioBriefHandoff(raw: unknown): StudioBriefHandoff {
  if (!raw || typeof raw !== 'object') throw Error('The Sketch Room reference could not be read.')
  const value = raw as Record<string, unknown>
  if (typeof value.image !== 'string' || value.image.length > 9_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.image))
    throw Error('The Sketch Room sheet is too large or could not be read.')
  if (typeof value.notes !== 'string' || value.notes.length > 1200)
    throw Error('The Sketch Room directions could not be read.')
  if (!value.design || JSON.stringify(value.design).length > 1_000_000)
    throw Error('The editable Sketch Room design is too large to attach.')
  const design = parseLook(value.design)
  return { image: value.image, notes: value.notes, name: typeof value.name === 'string' ? value.name.trim().slice(0, 100) || 'Sketch Room sheet' : 'Sketch Room sheet', design }
}
