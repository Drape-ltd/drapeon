import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import marketplace from './public-marketplace.ts'

const { getApprovedPublicTailorsForSitemap, getExploreTailorPage, getPublicTailorShopItemCount } = marketplace

const originalFetch = globalThis.fetch
const originalUrl = process.env.DRAPEON_PUBLIC_SUPABASE_URL
const originalKey = process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY

process.env.DRAPEON_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'

after(() => {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.DRAPEON_PUBLIC_SUPABASE_URL
  else process.env.DRAPEON_PUBLIC_SUPABASE_URL = originalUrl
  if (originalKey === undefined) delete process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  else process.env.DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey
})

const seller = {
  id: '10000000-0000-0000-0000-000000000001',
  display_name: 'Custom maker',
  avatar_url: 'https://example.com/portrait.jpg',
  portfolio_photo_urls: [],
  supports_custom_orders: true,
  supports_ready_made: false,
}

test('Ready-made reads the section from the gateway and retains a seller with no item capability', async () => {
  const requests = []
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ ok: true, data: [seller], capabilities: { categories: ['TAILORING', 'READY_TO_WEAR'] } }), { status: 200 })
  }
  const result = await getExploreTailorPage(40, 0, '', 'READY_TO_WEAR')
  assert.deepEqual(requests.map((request) => request.category), ['READY_TO_WEAR'])
  assert.equal(result.readyMadeSupported, true)
  assert.equal(result.tailors.length, 1)
  assert.equal(result.tailors[0].supportsReadyMade, false)
})

test('an old gateway with no category capability cannot fill Ready-made with Tailors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: [seller] }), { status: 200 })
  const result = await getExploreTailorPage(40, 0, '', 'READY_TO_WEAR')
  assert.equal(result.readyMadeSupported, false)
  assert.deepEqual(result.tailors, [])
})

test('a zero-item shop can show the public Custom requests card without a database column read', async () => {
  const requests = []
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ ok: true, data: { items: [] } }), { status: 200 })
  }
  assert.equal(await getPublicTailorShopItemCount(seller.id), 0)
  assert.deepEqual(requests.map((request) => request.action), ['tailor-shop'])
})

test('the sitemap reaches both Explore sections while preserving one profile URL per seller', async () => {
  const categories = []
  globalThis.fetch = async (_url, init) => {
    categories.push(JSON.parse(init.body).category)
    return new Response(JSON.stringify({ ok: true, data: [seller], capabilities: { categories: ['TAILORING', 'READY_TO_WEAR'] } }), { status: 200 })
  }
  const profiles = await getApprovedPublicTailorsForSitemap(10)
  assert.deepEqual(categories, ['TAILORING', 'READY_TO_WEAR'])
  assert.deepEqual(profiles.map((profile) => profile.id), [seller.id])
})
