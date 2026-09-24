/**
 * Development end-to-end walk of tailor signup and studio setup.
 *
 * Signs up a fresh tailor against the DEV Supabase project, then drives the
 * setup steps that matter: profile photo, portfolio image, portfolio video, the
 * oversized-video rejection, and the phone verification panel. Screenshots every
 * stop into qa-artifacts/signup/<date>/e2e.
 *
 * Usage:
 *   TEST_EMAIL=you+tag@example.com TEST_PASSWORD=… node ./scripts/e2e-setup-dev.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3004'
const EMAIL = process.env.TEST_EMAIL
const PASSWORD = process.env.TEST_PASSWORD
const FIX = process.env.FIXTURE_DIR ?? '/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT = '/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
await mkdir(OUT, { recursive: true })

const notes = []
const note = (label, detail) => {
  notes.push(`${label}: ${detail}`)
  console.log(`${label}: ${detail}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 420, height: 940 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`))
const failedRequests = []
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}`)
})

async function waitForSetupReady(label) {
  for (let i = 0; i < 40; i += 1) {
    const loading = await page.getByText(/Loading tailor setup/i).count().catch(() => 0)
    if (!loading) return true
    await page.waitForTimeout(1000)
  }
  note(label, 'still showing "Loading tailor setup…" after 40s')
  return false
}

const hide = () => page.addStyleTag({ content: 'nextjs-portal,.skip-link{display:none!important}' }).catch(() => {})
const shot = async (name) => { await hide(); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }) }
const enabled = (loc) => loc.isEnabled({ timeout: 1000 }).catch(() => false)

// ── Sign up ────────────────────────────────────────────────────────────────
const hydrationMismatches = []
page.on('pageerror', (e) => { if (String(e).includes('Hydration')) hydrationMismatches.push(1) })
await page.goto(`${BASE}/sign-up?role=tailor`, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.getByPlaceholder('e.g. John Doe').fill('Ope Tailor')
await page.getByPlaceholder('Phone number').fill(process.env.TEST_PHONE ?? '8025550134')
await page.getByPlaceholder('you@example.com').fill(EMAIL)
await page.getByPlaceholder('10+ characters').fill(PASSWORD)
await page.getByPlaceholder('Enter it again').fill(PASSWORD)
await page.waitForTimeout(2500)
note('hydration mismatches', String(hydrationMismatches.length))
note('values survived', JSON.stringify({
  name: await page.getByPlaceholder('e.g. John Doe').inputValue(),
  email: await page.getByPlaceholder('you@example.com').inputValue(),
}))
await page.getByRole('button', { name: 'Continue', exact: true }).click()
await page.waitForTimeout(1500)

const tailorCard = page.getByRole('button', { name: /Tailor Build your storefront/ })
if (await tailorCard.count()) await tailorCard.click({ timeout: 5000 })
const createBtn = page.getByRole('button', { name: /Create account/ })
for (let i = 0; i < 30; i += 1) {
  if (await enabled(createBtn)) break
  await page.waitForTimeout(500)
}
if (!(await enabled(createBtn))) {
  note('SIGNUP', 'create button never enabled')
  await shot('e2e-00-signup-blocked')
  await browser.close()
  process.exit(1)
}
await createBtn.click()
await page.waitForTimeout(5000)
const createAlert = (await page.getByRole('alert').allInnerTexts().catch(() => [])).join(' | ')
if (createAlert) note('create account alert', createAlert.slice(0, 200))

// ── Land in setup ──────────────────────────────────────────────────────────
await page.waitForURL(/account\/profile/, { timeout: 60_000 }).catch(() => {})
await page.waitForTimeout(3000)
await waitForSetupReady('step 0 load')
await page.waitForTimeout(1500)
note('URL after signup', page.url())
await shot('e2e-01-setup-step0')

// ── Profile photo ──────────────────────────────────────────────────────────
const fileInputs = page.locator('input[type="file"]')
note('file inputs on step 0', String(await fileInputs.count()))
if (await fileInputs.count()) {
  await fileInputs.first().setInputFiles(path.join(FIX, 'test-avatar.jpg'))
  await page.waitForTimeout(1500)
  await shot('e2e-02-avatar-selected')
  const saveBtn = page.getByRole('button', { name: /Save profile photo/ })
  if (await saveBtn.count()) {
    await saveBtn.click()
    await page.waitForTimeout(6000)
    await shot('e2e-03-avatar-saved')
    note('avatar save', (await page.getByRole('status').allInnerTexts().catch(() => [])).join(' | ').slice(0, 160) || 'no status text')
  } else {
    note('avatar save', 'no "Save profile photo" button found')
  }
}

// ── Phone panel (the new component) ────────────────────────────────────────
const phoneBtn = page.getByRole('button', { name: /Add phone number|Change/ })
note('phone panel entry buttons', String(await phoneBtn.count()))
note('location placeholder present', String(await page.locator('input').evaluateAll((els) => els.filter((el) => el.value === 'Not set').length)))
note('false draft notice', String(await page.getByText(/saved setup draft was restored/i).count()))
if (await phoneBtn.count()) {
  await phoneBtn.first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await shot('e2e-04-phone-editing')
}

// ── Portfolio step ─────────────────────────────────────────────────────────
await page.goto(`${BASE}/account/profile?setup=1&step=2`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await waitForSetupReady('portfolio step load')
await page.waitForTimeout(1500)
await shot('e2e-05-portfolio-step')
const portfolioInputs = page.locator('input[type="file"]')
note('file inputs on portfolio step', String(await portfolioInputs.count()))

const titleField = page.getByPlaceholder('Title')
if (await titleField.count()) await titleField.fill('Navy agbada')
if ((await portfolioInputs.count()) > 0) {
  await portfolioInputs.first().setInputFiles(path.join(FIX, 'test-portfolio.jpg'))
  await page.waitForTimeout(1200)
  await shot('e2e-06-portfolio-image-selected')
  const addItem = page.getByRole('button', { name: /Add portfolio item/ })
  if (await addItem.count()) {
    await addItem.click()
    await page.waitForTimeout(9000)
    await shot('e2e-07-portfolio-image-saved')
    note('portfolio image', (await page.getByRole('status').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200) || 'no status')
    note('portfolio alert', (await page.getByRole('alert').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200) || 'none')
  }
}

// Oversized video must be rejected with a usable message.
const videoInput = page.locator('input[type="file"][accept*="video"]')
note('video inputs', String(await videoInput.count()))
if (await videoInput.count()) {
  await videoInput.first().setInputFiles(path.join(FIX, 'test-video-45s.mp4'))
  await page.waitForTimeout(3000)
  note('45s video response', (await page.getByRole('alert').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200) || 'no alert')
  await shot('e2e-08-video-too-long')

  await videoInput.first().setInputFiles(path.join(FIX, 'test-video-12s.mp4'))
  await page.waitForTimeout(3000)
  const addVideo = page.getByRole('button', { name: /Add video/ })
  if (await addVideo.count() && await enabled(addVideo)) {
    await addVideo.click()
    await page.waitForTimeout(12000)
    await shot('e2e-09-video-saved')
    note('12s video', (await page.getByRole('status').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200) || 'no status')
    note('12s video alert', (await page.getByRole('alert').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200) || 'none')
  } else {
    note('12s video', 'Add video button missing or disabled')
    await shot('e2e-09-video-blocked')
  }
}

// ── Cropping / presentation controls ───────────────────────────────────────
await page.waitForTimeout(1500)
const cropText = await page.getByText(/crop|focal|presentation/i).allInnerTexts().catch(() => [])
note('cropping controls', cropText.join(' | ').slice(0, 220) || 'none found')
await shot('e2e-10-presentation')

note('console errors', consoleErrors.slice(0, 4).join(' || ') || 'none')
note('failed requests', [...new Set(failedRequests)].slice(0, 10).join(' || ') || 'none')
await context.storageState({ path: path.join(FIX, 'tailor-state.json') })
await browser.close()
console.log('\n──── SUMMARY ────\n' + notes.join('\n'))
