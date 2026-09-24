/** Checks the blocked trust-video state lists every outstanding requirement. */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:420,height:940}, storageState: path.join(FIX,'tailor-state.json') })).newPage()
const fails=[]; p.on('pageerror', e=>fails.push(String(e).slice(0,100)))
const settle=async()=>{ for(let i=0;i<40;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) return; await p.waitForTimeout(1000) } }
await p.goto(`${BASE}/account/profile?setup=1&step=3`, { waitUntil:'domcontentloaded' })
await settle(); await p.waitForTimeout(2000)
await p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})
console.log('old single-sentence box:', await p.getByText(/Save your complete setup first/i).count())
console.log('checklist heading:', (await p.getByText(/Finish these .* before recording/i).allInnerTexts().catch(()=>[])).join(' | ') || 'none')
const items = await p.locator('section button.text-left').allInnerTexts().catch(()=>[])
console.log('outstanding items listed:', items.length)
items.slice(0,6).forEach((t,i)=>console.log(`  ${i+1}. ${t.trim().slice(0,70)}`))
await p.screenshot({ path: path.join(OUT,'e2e-60-trust-blocked.png'), fullPage:true })
console.log('errors:', fails.slice(0,2).join(' || ')||'none')
await b.close()
