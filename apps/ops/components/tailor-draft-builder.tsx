'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

type Profile = { display_name?: string; business_name?: string | null; bio?: string | null; location?: string; languages?:string[]; specialty_tags?:string[]; currency?:string; price_range_min?:number; price_range_max?:number; lifecycle_state?: string }
type Media = { id: string; media_kind: string; content_type: string; sort_order: number; is_cover: boolean; focal_x: number|null; focal_y: number|null; moderation_status: string; confirmed_at: string|null }
type Draft = { id: string; status: string; expires_at: string | null; tailor_profile_id: string; tailor_profiles: Profile | null; tailor_draft_media?: Media[] }
const replay = () => crypto.randomUUID() + crypto.randomUUID()
function claimOrigin() {
  if (typeof window === 'undefined') return ''
  const port = ['3005', '3006'].includes(window.location.port) ? '3004' : window.location.port
  return `${window.location.protocol}//${window.location.hostname}${port ? `:${port}` : ''}`
}
async function sanitized(file:File){
  if(!file.type.startsWith('image/'))return file
  const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas')
  canvas.width=bitmap.width;canvas.height=bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap,0,0);bitmap.close()
  const mime=['image/jpeg','image/png','image/webp'].includes(file.type)?file.type:'image/jpeg'
  const blob=await new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,mime,mime==='image/png'?undefined:.92))
  if(!blob)throw new Error('This image could not be sanitized.')
  return new File([blob],file.name,{type:mime,lastModified:Date.now()})
}
async function digest(file:Blob){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),(byte)=>byte.toString(16).padStart(2,'0')).join('')
}

export function TailorDraftBuilder({ initialDrafts }: { initialDrafts: Draft[] }) {
  const [drafts, setDrafts] = useState(initialDrafts)
  const [selected, setSelected] = useState(initialDrafts[0]?.id ?? '')
  const [message, setMessage] = useState('')
  const [rawToken, setRawToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useMemo(() => drafts.find((item) => item.id === selected) ?? null, [drafts, selected])

  async function act(payload: Record<string, unknown>) {
    setBusy(true); setMessage(''); setRawToken(null)
    try {
      const response = await fetch('/api/actions/tailor-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, idempotencyKey: replay() }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Action failed')
      if (data.token) setRawToken(data.token)
      setMessage(data.correlationId ? `Saved · ${data.correlationId}` : 'Saved')
      return data
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed')
      return null
    } finally { setBusy(false) }
  }

  async function create(form: FormData) {
    const data = await act({ action: 'CREATE', displayName: form.get('displayName'), location: form.get('location'), bio: form.get('bio'), languages:String(form.get('languages')??'').split(',').map(value=>value.trim()).filter(Boolean), specialties: String(form.get('specialties') ?? '').split(',').map((value) => value.trim()).filter(Boolean),currency:form.get('currency'),priceMin:Number(form.get('priceMin')),priceMax:Number(form.get('priceMax')), sourceHandle: form.get('sourceHandle'), sourceUrl: form.get('sourceUrl') })
    if (!data?.inviteId) return
    const next: Draft = { id: data.inviteId, status: 'DRAFT', expires_at: null, tailor_profile_id: data.profileId, tailor_profiles: { display_name: String(form.get('displayName')), location: String(form.get('location')), bio: String(form.get('bio') ?? ''), languages: String(form.get('languages') ?? '').split(',').map((value) => value.trim()).filter(Boolean), specialty_tags: String(form.get('specialties') ?? '').split(',').map((value) => value.trim()).filter(Boolean), currency: String(form.get('currency')), price_range_min: Number(form.get('priceMin')), price_range_max: Number(form.get('priceMax')), lifecycle_state: 'DRAFT' } }
    setDrafts((current) => [next, ...current]); setSelected(next.id)
  }

  async function edit(form: FormData) {
    if (!active) return
    const patch = { displayName: form.get('draftDisplayName'), businessName: form.get('businessName'), bio: form.get('draftBio'), location: form.get('draftLocation'),languages:String(form.get('draftLanguages')??'').split(',').map(value=>value.trim()).filter(Boolean),specialties:String(form.get('draftSpecialties')??'').split(',').map(value=>value.trim()).filter(Boolean),currency:form.get('draftCurrency'),priceMin:Number(form.get('draftPriceMin')),priceMax:Number(form.get('draftPriceMax')) }
    if (await act({ action: 'EDIT', inviteId: active.id, ...patch })) setDrafts((items) => items.map((item) => item.id === active.id ? { ...item, tailor_profiles: { ...item.tailor_profiles, display_name: String(patch.displayName), business_name: String(patch.businessName ?? ''), bio: String(patch.bio ?? ''), location: String(patch.location),languages:patch.languages,specialty_tags:patch.specialties,currency:String(patch.currency),price_range_min:patch.priceMin,price_range_max:patch.priceMax } } : item))
  }

  async function upload(form:FormData){
    if(!active)return
    const input=form.get('media')
    if(!(input instanceof File)||!input.size)return
    setBusy(true);setMessage('')
    try{
      const file=await sanitized(input),kind=String(form.get('mediaKind')??'PHOTO')
      const registered=await act({action:'REGISTER_MEDIA',inviteId:active.id,mediaKind:kind,contentType:file.type,byteSize:file.size,sha256:await digest(file),sortOrder:active.tailor_draft_media?.length??0,isCover:(active.tailor_draft_media?.length??0)===0})
      if(!registered?.assetId||!registered.uploadToken||!registered.storagePath)throw new Error('Private upload could not be prepared.')
      const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if(!url||!key)throw new Error('Private upload client is unavailable.')
      const uploaded=await createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).storage.from('tailor-draft-media').uploadToSignedUrl(registered.storagePath,registered.uploadToken,file,{contentType:file.type,cacheControl:'0'})
      if(uploaded.error)throw uploaded.error
      const confirmed=await act({action:'CONFIRM_MEDIA',inviteId:active.id,assetId:registered.assetId})
      if(!confirmed)throw new Error('Private upload validation failed.')
      const item:Media={id:registered.assetId,media_kind:kind,content_type:file.type,sort_order:active.tailor_draft_media?.length??0,is_cover:(active.tailor_draft_media?.length??0)===0,focal_x:.5,focal_y:.5,moderation_status:'PENDING',confirmed_at:new Date().toISOString()}
      setDrafts((items)=>items.map((draft)=>draft.id===active.id?{...draft,tailor_draft_media:[...(draft.tailor_draft_media??[]),item]}:draft))
    }catch(error){setMessage(error instanceof Error?error.message:'Private upload failed.')}finally{setBusy(false)}
  }

  async function mediaAction(item:Media,payload:Record<string,unknown>){
    if(!active)return
    if(await act({inviteId:active.id,assetId:item.id,...payload})){
      if(payload.action==='DELETE_MEDIA')setDrafts((items)=>items.map((draft)=>draft.id===active.id?{...draft,tailor_draft_media:(draft.tailor_draft_media??[]).filter((media)=>media.id!==item.id)}:draft))
      else setDrafts((items)=>items.map((draft)=>draft.id===active.id?{...draft,tailor_draft_media:(draft.tailor_draft_media??[]).map((media)=>media.id===item.id?{...media,sort_order:Number(payload.sortOrder??media.sort_order),is_cover:payload.isCover===true,focal_x:Number(payload.focalX??media.focal_x),focal_y:Number(payload.focalY??media.focal_y),moderation_status:payload.action==='MODERATE_MEDIA'?(payload.decision==='APPROVE'?'APPROVED':'BLOCKED'):media.moderation_status}:payload.isCover===true?{...media,is_cover:false}:media)}:draft))
    }
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(19rem,0.8fr)_minmax(24rem,1.2fr)]">
    <section className="ops-section-block">
      <div className="ops-section-head"><div><p className="ops-action-label">New private storefront</p><h2>Create draft</h2></div></div>
      <form action={create} className="ops-form-grid">
        <label>Display name<input name="displayName" required minLength={2} /></label>
        <label>Location<input name="location" required /></label>
        <label>Languages<input name="languages" placeholder="English, French" required /></label>
        <label>Specialties<input name="specialties" placeholder="Alterations, Bridal" required /></label>
        <label>Currency<select name="currency" required defaultValue=""><option value="" disabled>Choose currency</option>{['NGN','GHS','KES','USD','GBP','EUR','CAD'].map(code=><option key={code}>{code}</option>)}</select></label>
        <label>Minimum price<input name="priceMin" type="number" min="1" required /></label>
        <label>Maximum price<input name="priceMax" type="number" min="1" required /></label>
        <label>Instagram handle<input name="sourceHandle" /></label>
        <label>Source URL<input name="sourceUrl" type="url" /></label>
        <label className="ops-field-span">Bio<textarea name="bio" rows={4} minLength={80} required /></label>
        <button className="ops-button ops-button-primary" disabled={busy}>Create private draft</button>
      </form>
    </section>
    <section className="ops-section-block">
      <div className="ops-section-head"><div><p className="ops-action-label">Draft tracker</p><h2>Private claim profiles</h2></div></div>
      {drafts.length ? <><select value={selected} onChange={(event) => setSelected(event.target.value)}>{drafts.map((item) => <option key={item.id} value={item.id}>{item.tailor_profiles?.display_name ?? item.id} · {item.status}</option>)}</select>
        {active ? <div className="mt-4 grid gap-4">
          <div className="ops-status-banner"><strong>{active.tailor_profiles?.display_name}</strong> · {active.tailor_profiles?.location} · {active.status}</div>
          <form key={active.id} action={edit} className="ops-form-grid">
            <label>Draft display name<input name="draftDisplayName" defaultValue={active.tailor_profiles?.display_name} required /></label>
            <label>Business name<input name="businessName" defaultValue={active.tailor_profiles?.business_name ?? ''} /></label>
            <label>Draft location<input name="draftLocation" defaultValue={active.tailor_profiles?.location} required /></label>
            <label>Languages<input name="draftLanguages" defaultValue={(active.tailor_profiles?.languages??[]).join(', ')} required /></label>
            <label>Specialties<input name="draftSpecialties" defaultValue={(active.tailor_profiles?.specialty_tags??[]).join(', ')} required /></label>
            <label>Currency<select name="draftCurrency" defaultValue={active.tailor_profiles?.currency??''} required><option value="" disabled>Choose currency</option>{['NGN','GHS','KES','USD','GBP','EUR','CAD'].map(code=><option key={code}>{code}</option>)}</select></label>
            <label>Minimum price<input name="draftPriceMin" type="number" min="1" defaultValue={active.tailor_profiles?.price_range_min} required /></label>
            <label>Maximum price<input name="draftPriceMax" type="number" min="1" defaultValue={active.tailor_profiles?.price_range_max} required /></label>
            <label className="ops-field-span">Draft bio<textarea name="draftBio" defaultValue={active.tailor_profiles?.bio ?? ''} rows={3} minLength={80} required /></label>
            <button className="ops-button" disabled={busy}>Save draft details</button>
          </form>
          <div className="ops-form-grid">
            <form action={upload} className="ops-form-grid ops-field-span">
              <label>Private media<input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" required /></label>
              <label>Media role<select name="mediaKind"><option value="PHOTO">Portfolio photo</option><option value="AVATAR">Avatar</option><option value="VIDEO">Portfolio video</option></select></label>
              <button className="ops-button" disabled={busy}>Sanitize and upload</button>
            </form>
            {(active.tailor_draft_media??[]).map((item,index)=><div className="ops-status-banner ops-field-span" key={item.id}>
              <div><strong>{item.media_kind} · {item.moderation_status}</strong><p>{item.content_type} · position {item.sort_order+1}{item.is_cover?' · cover':''}</p></div>
              <form action={async(form)=>mediaAction(item,{action:'UPDATE_MEDIA',sortOrder:item.sort_order,isCover:item.is_cover,focalX:Number(form.get('focalX')),focalY:Number(form.get('focalY'))})} className="ops-section-actions">
                <label>Focal X<input name="focalX" type="number" min="0" max="1" step="0.05" defaultValue={item.focal_x??.5}/></label>
                <label>Focal Y<input name="focalY" type="number" min="0" max="1" step="0.05" defaultValue={item.focal_y??.5}/></label>
                <button className="ops-button" disabled={busy}>Save focal point</button>
              </form>
              <div className="ops-section-actions">
                <button className="ops-button" disabled={busy||index===0} onClick={()=>mediaAction(item,{action:'UPDATE_MEDIA',sortOrder:Math.max(0,item.sort_order-1),isCover:item.is_cover,focalX:item.focal_x??.5,focalY:item.focal_y??.5})}>Move up</button>
                <button className="ops-button" disabled={busy||index===(active.tailor_draft_media?.length??1)-1} onClick={()=>mediaAction(item,{action:'UPDATE_MEDIA',sortOrder:item.sort_order+1,isCover:item.is_cover,focalX:item.focal_x??.5,focalY:item.focal_y??.5})}>Move down</button>
                <button className="ops-button" disabled={busy} onClick={()=>mediaAction(item,{action:'UPDATE_MEDIA',sortOrder:item.sort_order,isCover:true,focalX:item.focal_x??.5,focalY:item.focal_y??.5})}>Set cover</button>
                {item.moderation_status==='PENDING'?<button className="ops-button" disabled={busy} onClick={()=>mediaAction(item,{action:'MODERATE_MEDIA',decision:'APPROVE',reason:'Staff reviewed private storefront media.'})}>Approve media</button>:null}
                <button className="ops-button" disabled={busy} onClick={()=>mediaAction(item,{action:'DELETE_MEDIA'})}>Delete</button>
              </div>
            </div>)}
          </div>
          <form action={async (form) => { await act({ action: 'PREAPPROVE', inviteId: active.id, reason: form.get('reason'), evidenceRef: form.get('evidenceRef'), placement: form.get('placement'), publicEvidenceReviewed: true, videoWaiverAcknowledged: true }) }} className="ops-form-grid">
            <label>Approval reason<textarea name="reason" minLength={20} required rows={3} /></label>
            <label>Evidence reference<input name="evidenceRef" minLength={8} required /></label>
            <label>Explore placement<select name="placement"><option value="TAILORING">Tailoring</option><option value="READY_TO_WEAR">Ready to wear</option></select></label>
            <button className="ops-button" disabled={busy||active.status!=='DRAFT'}>{active.status==='DRAFT'?'Capture admin pre-approval':'Pre-approval frozen'}</button>
          </form>
          <div className="ops-section-actions">
            <button className="ops-button ops-button-primary" disabled={busy} onClick={async () => { const data = await act({ action: 'ISSUE', inviteId: active.id }); if (data?.token) setDrafts((items) => items.map((item) => item.id === active.id ? { ...item, status: 'INVITED', expires_at: data.expiresAt } : item)) }}>Generate private link</button>
            <button className="ops-button" disabled={busy} onClick={async () => { if (await act({ action: 'REVOKE', inviteId: active.id })) setDrafts((items) => items.map((item) => item.id === active.id ? { ...item, status: 'REVOKED' } : item)) }}>Revoke</button>
            <button className="ops-button" disabled={busy} onClick={async () => { if (await act({ action: 'DECLINE', inviteId: active.id })) setDrafts((items) => items.map((item) => item.id === active.id ? { ...item, status: 'DECLINED' } : item)) }}>Decline and schedule purge</button>
          </div>
          {rawToken ? <div className="ops-status-banner" data-tone="warning"><div><strong>Copy now — shown once</strong><p className="break-all">{claimOrigin()}/claim/{rawToken}</p><div className="ops-section-actions"><button className="ops-button" onClick={()=>navigator.clipboard.writeText(`${claimOrigin()}/claim/${rawToken}`)}>Copy private link</button><a className="ops-button" href={`${claimOrigin()}/claim/${rawToken}`} target="_blank" rel="noreferrer">Open exact preview</a></div></div></div> : null}
        </div> : null}</> : <div className="ops-empty"><h2>No draft tailors</h2><p>Create the first staff-built shop.</p></div>}
      {message ? <p className="mt-4 text-sm" role="status">{message}</p> : null}
    </section>
  </div>
}
