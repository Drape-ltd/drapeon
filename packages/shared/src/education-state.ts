import { getGuide } from './guide-library'
/** Account-scoped state and a durable offline outbox shared by web and native. */
export type EducationProgress = {
  status: 'started' | 'skipped' | 'dismissed' | 'completed'
  step: number
}
export type GuideCollection = { title: string; guideIds: string[] }
export type EducationValue = boolean | EducationProgress | GuideCollection | null
export type EducationData = Record<string, EducationValue>
export type EducationSnapshot = {
  data: EducationData
  ready: boolean
  syncing: boolean
  pending: number
  error: string
}
export function parseEducationData(value: unknown): EducationData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid guide preferences')
  const entries = Object.entries(value)
  if (entries.length > 256 || JSON.stringify(value).length > 100000)
    throw Error('Guide preferences are too large')
  for (const [key, v] of entries) {
    if (
      key.startsWith('saved:') &&
      getGuide(key.slice(6)) &&
      (typeof v === 'boolean' || v === null)
    )
      continue
    if (
      /^collection:[a-zA-Z0-9-]{1,64}$/.test(key) &&
      (v === null ||
        (typeof v === 'object' &&
          typeof v.title === 'string' &&
          v.title.trim().length > 0 &&
          v.title.length <= 80 &&
          Array.isArray(v.guideIds) &&
          v.guideIds.length <= 8 &&
          v.guideIds.every((id: unknown) => typeof id === 'string' && !!getGuide(id))))
    )
      continue
    if (
      /^progress:(CUSTOMER|TAILOR):(welcome|studio|vision|brief):v1$/.test(key) &&
      v &&
      typeof v === 'object' &&
      ['started', 'skipped', 'dismissed', 'completed'].includes(v.status) &&
      Number.isInteger(v.step) &&
      v.step >= 0 &&
      v.step <= 20
    )
      continue
    throw Error('Invalid guide preference')
  }
  return value as EducationData
}
type LocalState = { data: EducationData; pending: EducationData }
type Storage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}
export type EducationCloud = (
  request: { action: 'load' } | { action: 'save'; expectedRevision: number; data: EducationData }
) => Promise<{ revision: number; data: EducationData }>
export class EducationStore {
  private value: EducationSnapshot = {
    data: {},
    ready: false,
    syncing: false,
    pending: 0,
    error: '',
  }
  private pending: EducationData = {}
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private writes: Promise<void> = Promise.resolve()
  private mutations: Promise<void> = Promise.resolve()
  private initialized: Promise<void> | null = null
  constructor(
    private key: string,
    private storage: Storage,
    private cloud?: EducationCloud
  ) {}
  snapshot = () => this.value
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(patch: Partial<EducationSnapshot>) {
    this.value = { ...this.value, ...patch }
    this.listeners.forEach((fn) => fn())
  }
  private persist() {
    const raw = JSON.stringify({ data: this.value.data, pending: this.pending })
    const write = this.writes.catch(() => {}).then(() => this.storage.setItem(this.key, raw))
    this.writes = write
    return write
  }
  initialize() {
    if (this.initialized) return this.initialized
    this.initialized = (async () => {
      try {
        const raw = await this.storage.getItem(this.key)
        if (raw) {
          const cached = JSON.parse(raw) as LocalState
          if (
            !cached.data ||
            !cached.pending ||
            typeof cached.data !== 'object' ||
            Array.isArray(cached.data) ||
            typeof cached.pending !== 'object' ||
            Array.isArray(cached.pending)
          )
            throw Error('Invalid cache')
          this.pending = parseEducationData(cached.pending)
          this.publish({
            data: parseEducationData(cached.data),
            pending: Object.keys(this.pending).length,
          })
        }
      } catch {
        this.publish({ error: 'Saved guide preferences could not be read on this device.' })
      }
      this.publish({ ready: true })
      await this.sync()
    })()
    return this.initialized
  }
  set(key: string, value: EducationValue) {
    const action = this.mutations.catch(() => {}).then(() => this.apply(key, value))
    this.mutations = action
    return action
  }
  private async apply(key: string, value: EducationValue) {
    if (!this.value.ready) throw Error('Guide preferences are still loading.')
    parseEducationData({ ...this.value.data, [key]: value })
    const previous = this.value.data
    const previousPending = { ...this.pending }
    this.pending = { ...this.pending, [key]: value }
    this.publish({
      data: { ...previous, [key]: value },
      pending: Object.keys(this.pending).length,
      error: '',
    })
    try {
      await this.persist()
    } catch {
      this.pending = previousPending
      this.publish({
        data: previous,
        pending: Object.keys(previousPending).length,
        error: 'Could not save on this device. Free storage and try again.',
      })
      throw Error('Local guide storage failed')
    }
    void this.sync()
  }
  sync() {
    if (!this.cloud) {
      this.publish({ pending: 0 })
      return Promise.resolve()
    }
    if (this.running) return this.running
    this.running = (async () => {
      this.publish({ syncing: true })
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          const remote = await this.cloud!({ action: 'load' })
          remote.data = parseEducationData(remote.data)
          const patch = { ...this.pending }
          let result = remote
          if (Object.keys(patch).length) {
            try {
              result = await this.cloud!({
                action: 'save',
                expectedRevision: remote.revision,
                data: { ...remote.data, ...patch },
              })
            } catch (error) {
              if (String(error).includes('EDUCATION_CONFLICT')) continue
              throw error
            }
          }
          for (const key of Object.keys(patch))
            if (JSON.stringify(this.pending[key]) === JSON.stringify(patch[key]))
              delete this.pending[key]
          this.publish({
            data: { ...result.data, ...this.pending },
            pending: Object.keys(this.pending).length,
            error: '',
          })
          await this.persist()
          if (!Object.keys(this.pending).length) return
        }
        throw Error('Another device is saving. Retry sync.')
      } catch {
        this.publish({
          error: 'Your device copy is kept. Account sync needs a connection or a retry.',
          pending: Object.keys(this.pending).length,
        })
      } finally {
        this.publish({ syncing: false })
        this.running = null
      }
    })()
    return this.running
  }
}
export function collectionsFrom(data: EducationData): [string, GuideCollection][] {
  return Object.entries(data).filter(
    (entry): entry is [string, GuideCollection] =>
      entry[0].startsWith('collection:') &&
      !!entry[1] &&
      typeof entry[1] === 'object' &&
      'guideIds' in entry[1]
  )
}
export const educationKey = (owner?: string) => `drapeon.education.v1.${owner || 'guest'}`
