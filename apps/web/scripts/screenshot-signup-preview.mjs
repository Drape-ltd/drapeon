/**
 * Renders every tailor-onboarding harness state at every supported viewport and
 * writes PNGs to qa-artifacts/signup/<date>/ for visual review.
 *
 * Usage: node ./scripts/screenshot-signup-preview.mjs [--states=a,b] [--base=http://127.0.0.1:3004]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const baseUrl = argValue('base', process.env.PREVIEW_BASE_URL ?? 'http://127.0.0.1:3004')
const viewports = [
  { name: 'mobile-375', width: 375, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
]

const allStates = [
  'step1-empty',
  'step1-errors',
  'step1-help-open',
  'phone-missing',
  'phone-editing',
  'phone-code-sent',
  'phone-code-wrong',
  'phone-password',
  'phone-saved',
  'portfolio-empty',
  'portfolio-uploading',
  'portfolio-mixed',
  'portfolio-failed',
  'portfolio-at-cap',
  'whats-left',
  'whats-left-clear',
  'trust-blocked',
]
const requested = argValue('states', '')
const states = requested ? requested.split(',').filter(Boolean) : allStates

const stamp = new Date().toISOString().slice(0, 10)
const outDir = path.resolve(process.cwd(), '../../qa-artifacts/signup', stamp)
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
let written = 0

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  for (const state of states) {
    const url = `${baseUrl}/signup-preview?state=${state}`
    // Next's dev server holds an HMR socket open, so `networkidle` never settles.
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' })
    if (!response || response.status() !== 200) {
      console.error(`FAILED ${state} @ ${viewport.name}: status ${response?.status()}`)
      continue
    }
    // Open every help disclosure for the state that exists to inspect them.
    if (state === 'step1-help-open') {
      // Re-query after each click: toggling one disclosure re-renders the list,
      // so a batch of stale handles ends up closing what it just opened.
      for (let guard = 0; guard < 12; guard += 1) {
        const next = page.locator('button[aria-expanded="false"]').first()
        if ((await next.count()) === 0) break
        await next.click()
      }
    }
    // The Next dev-tools badge floats over the bottom-left of every capture.
    // Hide chrome that is not part of the design: the Next dev badge, and the
    // fixed skip link, which an element screenshot composites into the frame.
    await page.addStyleTag({
      content:
        'nextjs-portal, #__next-build-watcher, .skip-link { display: none !important } *, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important }',
    })
    const target = page.locator('[data-preview-state]')
    await target.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForLoadState('load')
    const file = path.join(outDir, `${state}__${viewport.name}.png`)
    await target.screenshot({ path: file })
    written += 1
  }
  await context.close()
}

await browser.close()
console.log(`Wrote ${written} screenshots to ${outDir}`)
