/** Captures the tailor account surfaces for a navigation/UX audit. */
import { chromium } from 'playwright'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/nav-audit/2026-09-17'
await mkdir(OUT, { recursive: true })
const ROUTES = [
  ['work','/account/work'], ['orders','/account/orders'], ['messages','/account/messages'],
  ['clients','/account/clients'], ['shop','/account/shop'], ['earnings','/account/earnings'],
  ['payout','/account/payout'], ['profile','/account/profile'],
  ['notifications','/account/notifications'], ['settings','/account/settings'], ['support','/account/support'],
]
const b = await chromium.launch()
for (const [vpName, w, h] of [['desktop',1440,1000],['mobile',390,900]]) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, storageState: path.join(FIX,'tailor-state.json') })
  const p = await ctx.newPage()
  for (const [name, route] of ROUTES) {
    const notes = { route, status: null, heading: '', navItems: 0, failures: [] }
    p.removeAllListeners('response')
    p.on('response', r => { if (r.status() >= 400) notes.failures.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/,'').slice(0,60)}`) })
    const res = await p.goto(`${BASE}${route}`, { waitUntil:'domcontentloaded' }).catch(()=>null)
    notes.status = res?.status() ?? 'ERR'
    for (let i=0;i<30;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) break; await p.waitForTimeout(1000) }
    await p.waitForTimeout(1200)
    await p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})
    notes.heading = (await p.locator('h1').first().innerText().catch(()=>'')) || '(none)'
    notes.navItems = await p.locator('nav[aria-label="Account navigation"] a').count().catch(()=>0)
    notes.finalUrl = p.url().replace(BASE,'')
    await p.screenshot({ path: path.join(OUT, `${vpName}-${name}.png`), fullPage: vpName==='mobile' })
    console.log(`${vpName.padEnd(8)} ${name.padEnd(14)} ${String(notes.status).padEnd(4)} nav:${String(notes.navItems).padEnd(3)} "${notes.heading.replace(/\n/g,' ').slice(0,42)}" ${notes.finalUrl !== route ? '→ '+notes.finalUrl : ''} ${notes.failures.length? '⚠ '+notes.failures[0]:''}`)
  }
  await ctx.close()
}
await b.close()
