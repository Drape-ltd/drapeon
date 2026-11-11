import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PUBLIC_PAGE_CACHE_HEADER,
  PUBLIC_PAGE_CACHE_TTL_SECONDS,
  isStorablePublicResponse,
  publicPageCacheKey,
  withPublicPageCache,
} from './public-page-cache.mjs'

const PROFILE = '/tailors/ca8b2deb-cccd-4550-9ee5-9ed651989c7a'
const req = (path, init = {}) => new Request(`https://drapeon.co${path}`, init)
const html = (body = '<html>ok</html>', init = {}) =>
  new Response(body, {
    status: 200,
    ...init,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', vary: 'RSC', ...(init.headers ?? {}) },
  })

class MemoryCache {
  constructor() { this.store = new Map(); this.puts = [] }
  async match(request) { const hit = this.store.get(request.url); return hit ? hit.clone() : undefined }
  async put(request, response) { this.puts.push({ url: request.url, cacheControl: response.headers.get('cache-control'), vary: response.headers.get('vary') }); this.store.set(request.url, new Response(await response.text(), response)) }
}

function harness(render = () => html()) {
  const cache = new MemoryCache()
  let renders = 0
  const waits = []
  const worker = withPublicPageCache({ fetch: async (request) => { renders++; return render(request) } }, { getCache: () => cache })
  const ctx = { waitUntil: (p) => waits.push(p) }
  return { cache, worker, ctx, waits, renders: () => renders }
}

test('only query-free default Explore and UUID profile GETs are cacheable', () => {
  assert.equal(publicPageCacheKey(req('/explore')), 'https://drapeon.co/explore')
  assert.equal(publicPageCacheKey(req(PROFILE)), `https://drapeon.co${PROFILE}`)
  for (const path of ['/explore?q=agbada', '/explore?page=2', `${PROFILE}?_rsc=abc`, '/tailors', '/tailors/not-a-uuid', `${PROFILE}/extra`, '/', '/account/explore', '/TAILORS/x']) {
    assert.equal(publicPageCacheKey(req(path)), null, path)
  }
  assert.equal(publicPageCacheKey(req('/explore', { method: 'HEAD' })), null)
  assert.equal(publicPageCacheKey(req('/explore', { method: 'POST' })), null)
  for (const header of ['RSC', 'Next-Router-Prefetch', 'Next-Router-State-Tree', 'Next-Action', 'Authorization']) {
    assert.equal(publicPageCacheKey(req(PROFILE, { headers: { [header]: '1' } })), null, header)
  }
})

test('only 200 HTML without cookies is storable', () => {
  assert.equal(isStorablePublicResponse(html()), true)
  assert.equal(isStorablePublicResponse(html('x', { status: 404 })), false)
  assert.equal(isStorablePublicResponse(new Response('x', { status: 500, headers: { 'content-type': 'text/html' } })), false)
  assert.equal(isStorablePublicResponse(html('x', { headers: { 'set-cookie': 'a=b' } })), false)
  assert.equal(isStorablePublicResponse(new Response('{}', { headers: { 'content-type': 'application/json' } })), false)
})

test('miss renders and stores with the hard TTL; hit skips the renderer', async () => {
  const h = harness()
  const first = await h.worker.fetch(req(PROFILE), {}, h.ctx)
  assert.equal(await first.text(), '<html>ok</html>')
  assert.equal(first.headers.get(PUBLIC_PAGE_CACHE_HEADER), 'MISS')
  assert.match(first.headers.get('cache-control'), /no-store/)
  await Promise.all(h.waits)
  assert.deepEqual(h.cache.puts, [{ url: `https://drapeon.co${PROFILE}`, cacheControl: `public, max-age=${PUBLIC_PAGE_CACHE_TTL_SECONDS}`, vary: null }])

  const second = await h.worker.fetch(req(PROFILE), {}, h.ctx)
  assert.equal(await second.text(), '<html>ok</html>')
  assert.equal(second.headers.get(PUBLIC_PAGE_CACHE_HEADER), 'HIT')
  assert.match(second.headers.get('cache-control'), /no-store/, 'browsers must not cache')
  assert.equal(h.renders(), 1)
})

test('uncacheable requests and responses pass straight through', async () => {
  const h = harness((request) => new URL(request.url).pathname.endsWith('404') ? html('nf', { status: 404 }) : html())
  const filtered = await h.worker.fetch(req('/explore?q=x'), {}, h.ctx)
  assert.equal(filtered.headers.get(PUBLIC_PAGE_CACHE_HEADER), null)
  const notFound = await h.worker.fetch(req('/tailors/00000000-0000-0000-0000-000000000404'), {}, h.ctx)
  assert.equal(notFound.status, 404)
  await Promise.all(h.waits)
  assert.equal(h.cache.puts.length, 0)
  assert.equal(h.renders(), 2)
})

test('cache failures fall back to rendering', async () => {
  let renders = 0
  const broken = { match: async () => { throw new Error('down') }, put: async () => { throw new Error('down') } }
  const worker = withPublicPageCache({ fetch: async () => { renders++; return html() } }, { getCache: () => broken })
  const waits = []
  const response = await worker.fetch(req('/explore'), {}, { waitUntil: (p) => waits.push(p) })
  await Promise.all(waits)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '<html>ok</html>')
  assert.equal(renders, 1)
})

test('no Cache API (e.g. workers.dev preview) means no caching', async () => {
  let renders = 0
  const worker = withPublicPageCache({ fetch: async () => { renders++; return html() } }, { getCache: () => null })
  await worker.fetch(req('/explore'), {}, {})
  await worker.fetch(req('/explore'), {}, {})
  assert.equal(renders, 2)
})
