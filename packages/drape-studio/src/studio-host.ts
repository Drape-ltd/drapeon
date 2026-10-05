import { parseLook, type Look } from './studio-state'
type BridgeWindow = Window & {
  ReactNativeWebView?: { postMessage: (message: string) => void }
  drapeStudioReceive?: (value: unknown) => void
}
const bridge = window as BridgeWindow
let initial: Look[] = []
let initialDraft: Look | null = null
let initialMode: 'create' | 'reference' | 'saved' = 'create'
let initialCanAttach = false
let initialOrderVersion: number | null = null
let initialSourceVersion: number | null = null
let initialNotice = ''
let seq = 0
const pending = new Map<string, { resolve: (warning?: string) => void; reject: (error: Error) => void }>()
export const native = !!bridge.ReactNativeWebView
function send(value: unknown) {
  const message = { channel: 'drape-studio', ...(value as object) }
  if (native) bridge.ReactNativeWebView!.postMessage(JSON.stringify(message))
  else parent.postMessage(message, '*')
}
export function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); clearInterval(retry) }
    const timer = setTimeout(() => {
      stop()
      reject(Error('Sketch Room could not connect. Go back and reopen it.'))
    }, 15000)
    // An iframe can load before the React host installs its message listener.
    // Repeat ready until init arrives instead of leaving the editor half loaded.
    const retry = setInterval(() => send({ type: 'ready' }), 300)
    bridge.drapeStudioReceive = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const m = raw as Record<string, unknown>
      if (m.channel !== 'drape-studio') return
      if (m.type === 'init') {
        try {
          initial = Array.isArray(m.looks) ? m.looks.slice(0, 12).map(parseLook) : []
          initialDraft = m.draft ? parseLook(m.draft) : null
          initialMode = m.mode === 'reference' || m.mode === 'saved' ? m.mode : 'create'
          initialCanAttach = m.canAttach === true
          initialOrderVersion = Number.isInteger(m.orderVersion) && Number(m.orderVersion) > 0 ? Number(m.orderVersion) : null
          initialSourceVersion = Number.isInteger(m.sourceVersion) && Number(m.sourceVersion) > 0 ? Number(m.sourceVersion) : null
          initialNotice = typeof m.notice === 'string' ? m.notice.slice(0, 240) : ''
          stop()
          resolve()
        } catch {
          stop()
          reject(Error('Saved designs could not be read.'))
        }
      }
      if (m.type === 'result' && typeof m.id === 'string') {
        const waiter = pending.get(m.id)
        if (!waiter) return
        pending.delete(m.id)
        if (m.error) waiter.reject(Error(String(m.error)))
        else waiter.resolve(typeof m.warning === 'string' ? m.warning.slice(0, 240) : undefined)
      }
    }
    window.addEventListener('message', (event) => {
      if (event.source === parent) bridge.drapeStudioReceive?.(event.data)
    })
    send({ type: 'ready' })
  })
}
export function savedLooks() {
  return initial
}
export function recoveredDraft() {
  return initialDraft
}
export function startMode() {
  return initialMode
}
export function canAttachToBrief() {
  return initialCanAttach
}
export function revisingOrderVersion() {
  return initialOrderVersion
}
export function workingFromOrderVersion() {
  return initialSourceVersion
}
export function storageNotice() {
  return initialNotice
}
function request(type: string, payload: Record<string, unknown>) {
  return new Promise<string | undefined>((resolve, reject) => {
    const id = String(++seq)
    pending.set(id, { resolve, reject })
    send({ type, id, ...payload })
    setTimeout(() => {
      if (pending.delete(id)) reject(Error('The operation did not finish. Please try again.'))
    }, 120000)
  })
}
export function saveLooks(looks: Look[]) {
  return request('save', { looks: looks.map(parseLook) })
}
export function saveDraft(draft: Look) {
  return request('draft', { draft: parseLook(draft) })
}
export function exportNative(contents: string, mime: string, extension: string, base64 = false) {
  return request('export', { contents, mime, extension, base64 })
}
export function attachBrief(image: string, notes: string, name: string, design: Look) {
  send({ type: 'attach', image, notes, name, design: parseLook(design) })
}
export function reviseOrder(image: string, design: Look, note: string) {
  return request('revise-order', { image, design: parseLook(design), note })
}
export function proposeStylePlan(image: string, note: string) {
  return request('propose-style-plan', { image, note })
}
