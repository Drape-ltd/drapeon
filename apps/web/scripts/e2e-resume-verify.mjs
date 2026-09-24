/**
 * Resumes the pending device-verification challenge using the session already
 * saved by the sign-in run, so entering a code does NOT mint a new one.
 *
 * Usage: CODE=123456 node ./scripts/e2e-resume-verify.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'
const BASE='http://127.0.0.1:3004'
const FIX='/private/tmp/claude-501/-Users-onaopemipodimowo-drape/bde2e37d-a93b-4ac4-a38b-619e2ca1e6d3/scratchpad'
const OUT='/Users/onaopemipodimowo/drape/qa-artifacts/signup/2026-09-16/e2e'
const notes=[]; const note=(k,v)=>{notes.push(`${k}: ${v}`); console.log(`${k}: ${v}`)}
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:420,height:940}, storageState: path.join(FIX,'tailor-state.json') })
const p = await ctx.newPage()
const hide=()=>p.addStyleTag({content:'nextjs-portal,.skip-link{display:none!important}'}).catch(()=>{})
const settle=async()=>{ for(let i=0;i<40;i++){ if(!(await p.getByText(/Loading (your account|tailor setup)/i).count().catch(()=>0))) return; await p.waitForTimeout(1000) } }

await p.goto(`${BASE}/sign-in?device=verify`, { waitUntil:'load' })
await p.waitForTimeout(4000)
const codeBox = p.getByPlaceholder('000000')
note('resume screen showing code box', String(await codeBox.count()))
if (await codeBox.count()) {
  await codeBox.fill(process.env.CODE)
  await p.getByRole('button', { name: /Verify and continue/ }).click()
  await p.waitForTimeout(9000)
  const alert=(await p.getByRole('alert').allInnerTexts().catch(()=>[])).join(' | ')
  if (alert) note('verify alert', alert.slice(0,160))
}
note('URL after verification', p.url())
await settle(); await p.waitForTimeout(1500)
note('placeholder "Not set" inputs', String(await p.locator('input').evaluateAll((els)=>els.filter((el)=>el.value==='Not set').length)))
note('false draft notice', String(await p.getByText(/saved setup draft was restored/i).count()))
await hide(); await p.screenshot({ path: path.join(OUT,'e2e-21-setup-verified.png'), fullPage:true })

await p.goto(`${BASE}/account/profile?setup=1&step=2`, { waitUntil:'domcontentloaded' })
await settle(); await p.waitForTimeout(1500)
const videoInput = p.locator('input[type="file"][accept*="video"]')
if (await videoInput.count()) {
  await videoInput.first().setInputFiles(path.join(FIX,'test-video-45s.mp4'))
  await p.waitForTimeout(3500)
  note('45s video message', (await p.getByRole('alert').allInnerTexts().catch(()=>[])).join(' | ').slice(0,160) || 'none')
  const box = await p.getByRole('alert').first().boundingBox().catch(()=>null)
  const picker = await videoInput.first().boundingBox().catch(()=>null)
  note('error-to-picker distance px', box && picker ? String(Math.round(Math.abs(box.y - picker.y))) : 'n/a')
  await hide(); await p.screenshot({ path: path.join(OUT,'e2e-22-video-error-placement.png'), fullPage:true })
}
note('video elements rendered', String(await p.locator('video').count()))
await hide(); await p.screenshot({ path: path.join(OUT,'e2e-23-portfolio.png'), fullPage:true })
await ctx.storageState({ path: path.join(FIX,'tailor-state.json') })
await b.close()
console.log('\n──── SUMMARY ────\n'+notes.join('\n'))
