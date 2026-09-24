/** Exercises the one-step profile photo upload, including the HEIC path. */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const notes=[]; const note=(k,v)=>{notes.push(`${k}: ${v}`); console.log(`${k}: ${v}`)}
const b = await chromium.launch()
const p = await (await b.newContext({ viewport:{width:420,height:940}, storageState: path.join(FIX,'tailor-state.json') })).newPage()
const fails=[]; p.on('pageerror', e=>fails.push(String(e).slice(0,90)))
const settle=async()=>{ for(let i=0;i<40;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) return; await p.waitForTimeout(1000) } }
const hide=()=>p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})

await p.goto(`${BASE}/account/profile?setup=1&step=0`, { waitUntil:'domcontentloaded' })
await settle(); await p.waitForTimeout(1500); await hide()

note('old 3-step box', String(await p.getByText(/Profile photo steps/i).count()))
note('old Save button', String(await p.getByRole('button',{name:/Save profile photo/}).count()))
note('one-step CTA', String(await p.getByRole('button',{name:/Add photo|Change photo/}).count()))
await p.screenshot({ path: path.join(OUT,'e2e-50-avatar-before.png'), fullPage:true })

// JPEG: choosing it should save with no second click.
await p.locator('#profile-photo-input').setInputFiles(path.join(FIX,'test-avatar.jpg'))
await p.waitForTimeout(9000)
note('after JPEG choose', (await p.getByRole('status').allInnerTexts().catch(()=>[])).join(' | ').slice(0,120) || 'no status')
note('alerts', (await p.getByRole('alert').allInnerTexts().catch(()=>[])).join(' | ').slice(0,140) || 'none')
await p.screenshot({ path: path.join(OUT,'e2e-51-avatar-saved.png'), fullPage:true })

// HEIC: should explain itself rather than reject with chat-message wording.
await p.locator('#profile-photo-input').setInputFiles(path.join(FIX,'test-avatar.heic'))
await p.waitForTimeout(8000)
note('after HEIC choose', (await p.getByRole('alert').allInnerTexts().catch(()=>[])).join(' | ').slice(0,200) || 'no alert')
await p.screenshot({ path: path.join(OUT,'e2e-52-avatar-heic.png'), fullPage:true })
note('page errors', fails.slice(0,3).join(' || ')||'none')
await b.close()
console.log('\n──── SUMMARY ────\n'+notes.join('\n'))
