/** Drives the redesigned portfolio step on DEV using the saved session. */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const notes=[]; const note=(k,v)=>{notes.push(`${k}: ${v}`); console.log(`${k}: ${v}`)}
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:420,height:940}, storageState: path.join(FIX,'tailor-state.json') })
const p = await ctx.newPage()
const fails=[]; p.on('response', r=>{ if(r.status()>=400) fails.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/,'').slice(0,70)}`) })
p.on('pageerror', e=>fails.push('pageerror '+String(e).slice(0,90)))
const hide=()=>p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})
const settle=async()=>{ for(let i=0;i<40;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) return; await p.waitForTimeout(1000) } }

await p.goto(`${BASE}/account/profile?setup=1&step=2`, { waitUntil:'domcontentloaded' })
await settle(); await p.waitForTimeout(2000)
await hide(); await p.screenshot({ path: path.join(OUT,'e2e-30-portfolio-redesign.png'), fullPage:true })

note('old 3-step box', String(await p.getByText(/Add a portfolio item in 3 steps/i).count()))
note('old "Step 1 · Portfolio item image"', String(await p.getByText(/Step 1 · Portfolio item image/i).count()))
note('old "Add portfolio item" button', String(await p.getByRole('button',{name:/Add portfolio item/}).count()))
note('old "Add video" button', String(await p.getByRole('button',{name:/^Add video$/}).count()))
note('file inputs', String(await p.locator('input[type=file]').count()))
note('single uploader CTA', String(await p.getByRole('button',{name:/Choose photos or videos/}).count()))
note('requirement counter', (await p.getByText(/required item/i).allInnerTexts().catch(()=>[])).join(' | ').slice(0,90))

// Upload an image and a video through the one picker.
const input = p.locator('input[type=file]').first()
await input.setInputFiles([path.join(FIX,'test-portfolio.jpg'), path.join(FIX,'test-video-12s.mp4')])
await p.waitForTimeout(3000)
await hide(); await p.screenshot({ path: path.join(OUT,'e2e-31-uploading.png'), fullPage:true })
note('uploading tiles', String(await p.getByText(/Uploading/i).count()))
await p.waitForTimeout(16000)
await hide(); await p.screenshot({ path: path.join(OUT,'e2e-32-uploaded.png'), fullPage:true })
note('counter after upload', (await p.getByText(/required item/i).allInnerTexts().catch(()=>[])).join(' | ').slice(0,110))
note('tiles', String(await p.locator('li').count()))
note('presentation below grid', String(await p.getByText(/Choose the best frame/i).count()))
note('failures', [...new Set(fails)].slice(0,5).join(' || ')||'none')
await b.close()
console.log('\n──── SUMMARY ────\n'+notes.join('\n'))
