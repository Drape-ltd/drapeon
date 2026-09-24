/**
 * Triggers the email-code phone confirmation against DEV, using the session
 * saved by e2e-setup-dev.mjs. Stops at "code sent" — the code arrives by email.
 * Pass CODE=123456 to also complete the verification.
 */
import { chromium } from 'playwright'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3004'
const FIX = '/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT = '/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 420, height: 940 },
  storageState: path.join(FIX, 'tailor-state.json'),
})
const page = await context.newPage()
const failed = []
page.on('response', async (r) => {
  if (r.status() < 400) return
  const auth = r.request().headers()['authorization'] ?? ''
  const body = await r.text().catch(() => '')
  failed.push(`${r.status()} auth=${auth ? auth.slice(0, 12) + '…' : 'NONE'} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 70)} :: ${body.slice(0, 120)}`)
})

await page.goto(`${BASE}/account/profile?setup=1&step=0`, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 40; i += 1) {
  if (!(await page.getByText(/Loading (your account|tailor setup)/i).count().catch(() => 0))) break
  await page.waitForTimeout(1000)
}
await page.waitForTimeout(1500)
await page.addStyleTag({ content: 'nextjs-portal,.skip-link{display:none!important}' }).catch(() => {})

const entry = page.getByRole('button', { name: /Add phone number|Change/ })
console.log('entry buttons:', await entry.count())
console.log('phone area text:', (await page.getByText(/Phone number/i).allInnerTexts().catch(() => [])).join(' | ').slice(0, 200))
if (await entry.count()) await entry.first().click({ timeout: 5000 }).catch((e) => console.log('entry click failed:', String(e).slice(0, 120)))
await page.waitForTimeout(800)

const sendBtn = page.getByRole('button', { name: /Email me a code/ })
console.log('send button present:', await sendBtn.count())
if (await sendBtn.count() && !process.env.CODE) {
  await sendBtn.first().click()
  await page.waitForTimeout(9000)
  await page.screenshot({ path: path.join(OUT, 'e2e-11-phone-code-sent.png'), fullPage: true })
  console.log('after send, visible text:', (await page.locator('section, [role=alert]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').slice(0, 400))
}

if (process.env.CODE) {
  // A code is already in flight, so re-enter the existing challenge rather than
  // sending another one (each send retires the previous code).
  if (await sendBtn.count()) {
    await sendBtn.first().click()
    await page.waitForTimeout(8000)
  }
  const codeInput = page.getByLabel(/Six-digit confirmation code/i)
  if (await codeInput.count()) {
    await codeInput.fill(process.env.CODE)
    await page.getByRole('button', { name: /Confirm and save/ }).click()
    await page.waitForTimeout(9000)
    await page.screenshot({ path: path.join(OUT, 'e2e-12-phone-confirmed.png'), fullPage: true })
    console.log('after confirm:', (await page.locator('section').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').slice(0, 300))
  }
}
console.log('failed requests:', [...new Set(failed)].slice(0, 6).join(' || ') || 'none')
await browser.close()
