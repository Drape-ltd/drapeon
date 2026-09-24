/** Checks the presentation editor labels video assets correctly. */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:1280,height:1000}, storageState: path.join(FIX,'tailor-state.json') })).newPage()
const settle=async()=>{ for(let i=0;i<40;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) return; await p.waitForTimeout(1000) } }
await p.goto(`${BASE}/account/profile?setup=1&step=2`, { waitUntil:'domcontentloaded' })
await settle(); await p.waitForTimeout(2500)
await p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})
const badges = await p.locator('[aria-label="Portfolio media"] button span').allInnerTexts().catch(()=>[])
console.log('tile badges:', badges.join(' | '))
console.log('video badge present:', badges.some(t=>t.trim()==='Video'))
console.log('video elements in picker:', await p.locator('[aria-label="Portfolio media"] video').count())
console.log('subtitle:', (await p.getByText(/which frame of a video/i).allInnerTexts().catch(()=>[])).join('') || 'missing')
await p.screenshot({ path: path.join(OUT,'e2e-70-presentation-desktop.png'), fullPage:true })
await b.close()
