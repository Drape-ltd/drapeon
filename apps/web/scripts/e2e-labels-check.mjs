/** Checks the (i) help disclosures on the live setup steps. */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:420,height:940}, storageState: path.join(FIX,'tailor-state.json') })).newPage()
const fails=[]; p.on('pageerror', e=>fails.push(String(e).slice(0,90)))
const settle=async()=>{ for(let i=0;i<40;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) return; await p.waitForTimeout(1000) } }
const STEP = process.env.STEP ?? '0'
await p.goto(`${BASE}/account/profile?setup=1&step=${STEP}`, { waitUntil:'domcontentloaded' })
await settle(); await p.waitForTimeout(1500)
await p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})
const toggles = p.locator('button[aria-label^="About "]')
console.log(`help toggles on step ${STEP}:`, await toggles.count())
for (let i=0;i<10;i++){ const n=p.locator('button[aria-expanded="false"][aria-label^="About "]').first(); if(!(await n.count())) break; await n.click() }
await p.waitForTimeout(600)
console.log('open panels:', await p.locator('button[aria-expanded="true"][aria-label^="About "]').count())
await p.screenshot({ path: path.join(OUT,`e2e-40-labels-step${STEP}.png`), fullPage:true })
console.log('errors:', fails.slice(0,3).join(' || ')||'none')
await b.close()
