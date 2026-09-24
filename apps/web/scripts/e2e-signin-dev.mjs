/** Signs in an existing DEV tailor and walks the setup screens. */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:420,height:940} })
const p = await ctx.newPage()
const fails=[]; p.on('response', r=>{ if(r.status()>=400) fails.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/,'').slice(0,70)}`) })
const enabled=(l)=>l.isEnabled({timeout:1000}).catch(()=>false)
const hide=()=>p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})

await p.goto(`${BASE}/sign-in`, { waitUntil:'load' })
await p.waitForTimeout(1500)
await p.getByPlaceholder('you@example.com').fill(process.env.TEST_EMAIL)
await p.getByPlaceholder('Your password').fill(process.env.TEST_PASSWORD)
const signIn = p.getByRole('button', { name: /^Sign in$/ })
for(let i=0;i<30;i++){ if(await enabled(signIn)) break; await p.waitForTimeout(500) }
await signIn.click()
await p.waitForTimeout(8000)
console.log('URL after sign-in:', p.url())
console.log('HEADINGS:', (await p.locator('h1,h2').allInnerTexts()).join(' | ').slice(0,200))
const alert = (await p.getByRole('alert').allInnerTexts().catch(()=>[])).join(' | ')
if (alert) console.log('ALERT:', alert.slice(0,200))
await hide(); await p.screenshot({ path: path.join(OUT,'e2e-20-signin.png'), fullPage:true })
console.log('failed:', [...new Set(fails)].slice(0,5).join(' || ')||'none')
await ctx.storageState({ path: path.join(FIX,'tailor-state.json') })
await b.close()
