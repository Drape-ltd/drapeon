import {
  EducationStore,
  educationKey,
  parseEducationData,
  type EducationCloud,
  type EducationData,
} from '../src/education-state'
import {
  GUIDE_ARTICLES,
  GUIDE_ROOMS,
  GUIDE_VIDEOS,
  getGuide,
  parseGuideReferences,
  guideShareText,
  guideDraftText,
  updateGuideDraftText,
  removeGuideDraftReference,
} from '../src/guide-library'
function memory() {
  const values = new Map<string, string>()
  return {
    getItem: async (k: string) => values.get(k) || null,
    setItem: async (k: string, v: string) => {
      values.set(k, v)
    },
  }
}
describe('Guide state and links', () => {
  test('guest saved lessons and skipped introductions survive restart', async () => {
    const storage = memory()
    const a = new EducationStore(educationKey(), storage)
    await a.initialize()
    await a.set('saved:measure-yourself', true)
    await a.set('progress:CUSTOMER:welcome:v1', { status: 'skipped', step: 0 })
    const b = new EducationStore(educationKey(), storage)
    await b.initialize()
    expect(b.snapshot().data).toEqual(a.snapshot().data)
    expect(educationKey('a')).not.toBe(educationKey('b'))
  })
  test('offline changes survive restart and merge with another device', async () => {
    const storage = memory()
    let online = false
    let data: EducationData = { 'saved:care-labels': true }
    let revision = 1
    const cloud: EducationCloud = async (request) => {
      if (!online) throw Error('offline')
      if (request.action === 'save') {
        expect(request.expectedRevision).toBe(revision)
        data = request.data
        revision++
      }
      return { revision, data }
    }
    const a = new EducationStore('user', storage, cloud)
    await a.initialize()
    await a.set('saved:measure-yourself', true)
    await a.sync()
    online = true
    const b = new EducationStore('user', storage, cloud)
    await b.initialize()
    expect(b.snapshot().data).toMatchObject({
      'saved:care-labels': true,
      'saved:measure-yourself': true,
    })
    expect(b.snapshot().pending).toBe(0)
  })
  test('CAS conflicts reload and preserve remote changes', async () => {
    let conflict = true
    let data: EducationData = {}
    let revision = 0
    const cloud: EducationCloud = async (req) => {
      if (req.action === 'save') {
        if (conflict) {
          conflict = false
          data = { 'saved:care-labels': true }
          revision = 1
          throw Error('EDUCATION_CONFLICT')
        }
        expect(req.expectedRevision).toBe(revision)
        data = req.data
        revision++
      }
      return { revision, data }
    }
    const store = new EducationStore('a', memory(), cloud)
    await store.initialize()
    await store.set('saved:measure-yourself', true)
    await store.sync()
    expect(store.snapshot().data).toMatchObject({
      'saved:care-labels': true,
      'saved:measure-yourself': true,
    })
    expect(store.snapshot().error).toBe('')
  })
  test('failed local write does not erase a later edit', async () => {
    const storage = memory()
    let fails = true
    const store = new EducationStore('a', {
      ...storage,
      setItem: async (k, v) => {
        if (fails) {
          fails = false
          throw Error('full')
        }
        await storage.setItem(k, v)
      },
    })
    await store.initialize()
    const first = store.set('saved:care-labels', true)
    const second = store.set('saved:measure-yourself', true)
    await expect(first).rejects.toThrow()
    await second
    expect(store.snapshot().data).toEqual({ 'saved:measure-yourself': true })
  })
  test('rejects unknown state and malformed guide values', () => {
    expect(() => parseEducationData({ 'saved:unknown': true })).toThrow()
    expect(() => parseEducationData({ 'saved:care-labels': { title: 'bad' } })).toThrow()
  })
  test('catalogue rooms and related lessons resolve', () => {
    expect(new Set(GUIDE_ARTICLES.map((g) => g.id)).size).toBe(GUIDE_ARTICLES.length)
    expect(new Set(GUIDE_ROOMS.map((r) => r.category)).size).toBe(6)
    for (const g of GUIDE_ARTICLES) {
      expect(GUIDE_ROOMS.some((r) => r.category === g.category)).toBe(true)
      for (const id of g.related) expect(getGuide(id)).toBeTruthy()
    }
    for (const [id, v] of Object.entries(GUIDE_VIDEOS)) {
      expect(getGuide(id)).toBeTruthy()
      expect(v.youtubeId).toMatch(/^[\w-]{11}$/)
    }
  })
  test('message references resolve without turning arbitrary text into cards', () => {
    expect(parseGuideReferences(guideShareText(['measure-yourself']))[0]?.guide.id).toBe(
      'measure-yourself'
    )
    expect(parseGuideReferences('[Drapeon guide: unknown]')).toEqual([])
  })
  test('guide references stay attached while draft text remains readable and removable', () => {
    const reference = guideShareText(['measure-yourself'])
    const body = `Please follow this lesson.\n\n${reference}`
    expect(guideDraftText(body)).toBe('Please follow this lesson.')
    expect(updateGuideDraftText(body, 'Please use this lesson.')).toBe(
      `Please use this lesson.\n\n${reference}`
    )
    expect(removeGuideDraftReference(body, reference)).toBe('Please follow this lesson.')
  })
})
