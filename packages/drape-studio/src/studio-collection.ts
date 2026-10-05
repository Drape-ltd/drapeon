import { parseSavedLooks } from './studio-storage.ts'
import type { Look } from './studio-state.ts'

export type StudioCollection = { revision: number; looks: Look[] }

export function parseStudioCollection(raw: unknown): StudioCollection {
  if (!raw || typeof raw !== 'object') throw Error('Saved sketches could not be read.')
  const value = raw as Record<string, unknown>
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw Error('Saved sketches have an invalid revision.')
  }
  return { revision: Number(value.revision), looks: parseSavedLooks(value.looks) }
}

function copyName(name: string, used: Set<string>) {
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? ' (device copy)' : ` (device copy ${index})`
    const candidate = name.slice(0, 60 - suffix.length) + suffix
    if (!used.has(candidate)) return candidate
  }
  throw Error('Too many versions of this design.')
}

export function mergeStudioCollections(cloudRaw: unknown, deviceRaw: unknown) {
  const cloud = parseSavedLooks(cloudRaw)
  const device = parseSavedLooks(deviceRaw)
  const looks = [...cloud]
  const used = new Set(looks.map((look) => look.name))
  let recoveredCopies = 0
  let omittedCopies = 0

  for (const local of device) {
    const remote = looks.find((look) => look.name === local.name)
    if (remote && JSON.stringify(remote) === JSON.stringify(local)) continue
    if (looks.length >= 12) {
      omittedCopies += 1
      continue
    }
    const name = used.has(local.name) ? copyName(local.name, used) : local.name
    looks.push({ ...local, name })
    used.add(name)
    recoveredCopies += 1
  }

  return { looks, recoveredCopies, omittedCopies }
}
