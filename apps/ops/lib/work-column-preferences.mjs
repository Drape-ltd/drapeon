export const WORK_COLUMNS_STORAGE_KEY = 'drapeon.ops.work-columns.v1'
export const DEFAULT_WORK_COLUMNS = Object.freeze({ context: true, assignee: true, nextAction: true, activity: true })

/** Parse only display preferences. Never restore arbitrary stored properties. */
export function parseWorkColumns(raw) {
  try {
    const value = JSON.parse(raw ?? 'null')
    return Object.fromEntries(Object.entries(DEFAULT_WORK_COLUMNS).map(([key, fallback]) => [
      key, typeof value?.[key] === 'boolean' ? value[key] : fallback,
    ]))
  } catch {
    return { ...DEFAULT_WORK_COLUMNS }
  }
}
