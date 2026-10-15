'use client'

import { useMemo, useSyncExternalStore } from 'react'
import { parseWorkColumns, WORK_COLUMNS_STORAGE_KEY } from '../lib/work-column-preferences.mjs'

const changedEvent = 'drapeon:ops-work-columns'
let sessionValue: string | null = null

function readSnapshot() {
  if (sessionValue !== null) return sessionValue
  try { return window.localStorage.getItem(WORK_COLUMNS_STORAGE_KEY) }
  catch { return sessionValue }
}

function serverSnapshot() { return null }

function subscribe(notify: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === WORK_COLUMNS_STORAGE_KEY || event.key === null) {
      sessionValue = null
      notify()
    }
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(changedEvent, notify)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(changedEvent, notify)
  }
}

export function useWorkColumns() {
  const raw = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot)
  const visibleColumns = useMemo(() => parseWorkColumns(raw), [raw])
  function toggleColumn(key: string, checked: boolean) {
    const next = JSON.stringify({ ...parseWorkColumns(readSnapshot()), [key]: checked })
    sessionValue = next
    try { window.localStorage.setItem(WORK_COLUMNS_STORAGE_KEY, next) }
    catch { /* Retain the session preference when storage is unavailable. */ }
    window.dispatchEvent(new Event(changedEvent))
  }
  return { visibleColumns, toggleColumn }
}
