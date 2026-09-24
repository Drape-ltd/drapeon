import { chromium } from 'playwright'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const BASE = 'http://127.0.0.1:3004'
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
const OUT = '/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

const shot = async (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })

await page.goto(`${BASE}/sign-up?role=tailor`, { waitUntil: 'domcontentloaded' })
await page.addStyleTag({ content: 'nextjs-portal,.skip-link{display:none!important}' })

// The signup form hydrates a saved draft from localStorage after mount and
// overwrites whatever is in the fields. Typing before that lands silently wipes
// the input, so wait for hydration (the provider buttons enable with it).
const googleBtn = page.getByRole('button', { name: /Continue with Google/ })
for (let i = 0; i < 30; i += 1) {
  if (await googleBtn.isEnabled({ timeout: 1000 }).catch(() => false)) break
  await page.waitForTimeout(300)
}
console.log('hydrated:', await googleBtn.isEnabled({ timeout: 1000 }).catch(() => false))

await page.getByPlaceholder('e.g. John Doe').fill('Ope Test Tailor')
await page.getByPlaceholder('Phone number').fill('8025550134')
await page.waitForTimeout(400)
console.log('values stuck ->', JSON.stringify({
  name: await page.getByPlaceholder('e.g. John Doe').inputValue(),
  phone: await page.getByPlaceholder('Phone number').inputValue(),
}))
await page.getByPlaceholder('you@example.com').fill(EMAIL)
await page.getByPlaceholder('10+ characters').fill(PASSWORD)
await page.getByPlaceholder('Enter it again').fill(PASSWORD)
await shot('01-step1-filled')

await page.getByRole('button', { name: 'Continue', exact: true }).click()
await page.waitForTimeout(1200)
await shot('02-step2-role')

const tailorCard = page.getByRole('button', { name: /Tailor Build your storefront/ })
console.log('tailor card count:', await tailorCard.count())
if (await tailorCard.count()) await tailorCard.click({ timeout: 5000 })

// Wait for the Turnstile token so the submit button enables.
const createBtn = page.getByRole('button', { name: /Create account/ })
console.log('create button count:', await createBtn.count())
for (let i = 0; i < 30; i += 1) {
  if (await createBtn.isEnabled({ timeout: 1000 }).catch(() => false)) break
  await page.waitForTimeout(500)
}
const enabled = await createBtn.isEnabled({ timeout: 1000 }).catch(() => false)
console.log('create button enabled:', enabled)
await shot('03-step2-ready')

if (enabled) {
  await createBtn.click()
  await page.waitForTimeout(6000)
  await shot('04-after-submit')
  const heading = await page.locator('h2, h1').allInnerTexts()
  console.log('HEADINGS:', heading.join(' | ').slice(0, 300))
  const alert = await page.getByRole('alert').allInnerTexts().catch(() => [])
  if (alert.length) console.log('ALERT:', alert.join(' | ').slice(0, 300))
}
console.log('CONSOLE ERRORS:', errors.slice(0, 5))
await browser.close()
