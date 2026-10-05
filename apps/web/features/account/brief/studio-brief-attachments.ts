import type { ReferencePhotoAttributionDrafts } from './reference-photo-attribution-fields'
import type { Look } from '../../../../../packages/drape-studio/src/studio-state'

type BriefAttachments = {
  savedAt: number
  referencePhotos: File[]
  photoAttributions: ReferencePhotoAttributionDrafts
  fabricReferenceFiles: File[]
  studioAttachment: { fileName: string; design: Look } | null
}

const DATABASE = 'drape-studio-brief-attachments-v1'
const STORE = 'briefs'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

function attachmentKey(userId: string, tailorId: string) {
  return `${userId}:${tailorId}`
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, setResult: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    let result: T
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
    action(transaction.objectStore(STORE), (value) => { result = value })
  })
}

export async function saveStudioBriefAttachments(userId: string, tailorId: string, attachments: Omit<BriefAttachments, 'savedAt'>) {
  await runTransaction<void>('readwrite', (store, resolve) => {
    const request = store.put({ ...attachments, savedAt: Date.now() } satisfies BriefAttachments, attachmentKey(userId, tailorId))
    request.onsuccess = () => resolve()
  })
}

export async function loadStudioBriefAttachments(userId: string, tailorId: string): Promise<BriefAttachments | null> {
  const value = await runTransaction<BriefAttachments | undefined>('readonly', (store, resolve) => {
    const request = store.get(attachmentKey(userId, tailorId))
    request.onsuccess = () => resolve(request.result as BriefAttachments | undefined)
  })
  if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > MAX_AGE_MS) return null
  return value
}

export async function clearStudioBriefAttachments(userId: string, tailorId: string) {
  await runTransaction<void>('readwrite', (store, resolve) => {
    const request = store.delete(attachmentKey(userId, tailorId))
    request.onsuccess = () => resolve()
  })
}
