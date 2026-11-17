import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOpsSession, hasFreshOpsMfa } from '../../../../lib/ops-session'
import { isRestrictedOpsPhoneHeaders } from '../../../../lib/client-surface'
import { resolveLocalWorkforcePrincipal } from '../../../../lib/local-workforce-principal'
import { validateOpsMutationOrigin } from '../../../../../web/lib/ops-request-security'
import { getSupabaseServiceRoleKey } from '../../../../../web/lib/supabase-config'
import { validateServiceRoleTarget } from '../../../../../web/lib/supabase-environment'
import { inspectDraftMedia } from '../../../../../../supabase/functions/_shared/draft-media-validation'

export const dynamic='force-dynamic'
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}})
const value=(input:unknown,max=500)=>typeof input==='string'?input.trim().slice(0,max):''
const hash=(token:string)=>createHash('sha256').update(token).digest('base64url')
const allowedMime=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])

export async function POST(request:Request){
  if(!validateOpsMutationOrigin(request).ok||isRestrictedOpsPhoneHeaders(request.headers))return json({error:'Protected desktop origin required.'},403)
  const session=await getOpsSession(request)
  if(!session?.allowed||!hasFreshOpsMfa(session)||!['admin','trust'].includes(session.role))return json({error:'Fresh protected trust session required.'},401)
  const raw=await request.text()
  if(raw.length>64_000)return json({error:'Request too large.'},413)
  let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return json({error:'Invalid request.'},400)}
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()??process.env.SUPABASE_URL?.trim(),key=getSupabaseServiceRoleKey()
  if(!url||!key||!validateServiceRoleTarget(url,key,process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF).isValid)return json({error:'Draft broker unavailable.'},503)
  if(session.mode!=='local-workforce'){
    const assertion=request.headers.get('cf-access-jwt-assertion');if(!assertion)return json({error:'Signed workforce assertion required.'},401)
    const response=await fetch(`${url.replace(/\/+$/u,'')}/functions/v1/tailor-draft-action`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-drape-ops-access-assertion':assertion},body:raw,cache:'no-store',signal:AbortSignal.timeout(20_000)})
    return json(await response.json(),response.status)
  }
  if(process.env.NODE_ENV==='production')return json({error:'Development bridge unavailable.'},403)
  const local=await resolveLocalWorkforcePrincipal(session)
  if(!local||!local.principal.roles.some(role=>['admin','trust'].includes(role)))return json({error:'Development trust identity unavailable.'},403)
  const action=value(body.action,40).toUpperCase(),correlationId=randomUUID(),idempotencyKey=value(body.idempotencyKey,180)
  if(idempotencyKey.length<16)return json({error:'A replay key is required.'},400)
  const prepared=await local.client.from('tailor_draft_action_receipts').insert({actor_principal_id:local.principal.id,action_key:action,idempotency_key:idempotencyKey}).select('id').single()
  let receiptId=prepared.data?.id
  if(prepared.error){
    if(prepared.error.code!=='23505')return json({error:'The action receipt could not be prepared.'},409)
    const existing=await local.client.from('tailor_draft_action_receipts').select('id,action_key,outcome,response,http_status').eq('actor_principal_id',local.principal.id).eq('idempotency_key',idempotencyKey).maybeSingle()
    if(!existing.data||existing.data.action_key!==action)return json({error:'The replay key is already bound to another action.'},409)
    if(['SUCCEEDED','FAILED'].includes(existing.data.outcome)&&existing.data.response)return json(existing.data.response,existing.data.http_status??(existing.data.outcome==='SUCCEEDED'?200:409))
    return json({error:'This action is already being processed.',correlationId},409)
  }
  const succeed=async(response:Record<string,unknown>)=>{
    const stored={...response};delete stored.token;delete stored.signedUploadUrl;delete stored.uploadToken
    await local.client.from('tailor_draft_action_receipts').update({outcome:'SUCCEEDED',response:stored,http_status:200,completed_at:new Date().toISOString()}).eq('id',receiptId!)
    return json(response)
  }
  const rejected=async(response:Record<string,unknown>,status:number,failureCode:string)=>{
    await local.client.from('tailor_draft_action_receipts').update({outcome:'FAILED',response,http_status:status,failure_code:failureCode,completed_at:new Date().toISOString()}).eq('id',receiptId!)
    return json(response,status)
  }
  try{
    if(action==='CREATE'){
      const displayName=value(body.displayName,80),location=value(body.location,120)
      if(displayName.length<2||!location)return await rejected({error:'Display name and location are required.'},400,'INVALID_CREATE')
      const userId=randomUUID(),email=`draft+${userId}@claim.drapeon.invalid`
      const created=await local.client.auth.admin.createUser({id:userId,email,email_confirm:false,ban_duration:'876000h',user_metadata:{role:'TAILOR',account_origin:'STAFF_DRAFT',display_name:displayName}})
      if(created.error)throw created.error
      const profile=await local.client.from('tailor_profiles').insert({user_id:userId,display_name:displayName,business_name:value(body.businessName,120)||null,bio:value(body.bio,2000)||null,location,languages:Array.isArray(body.languages)?body.languages:[],specialty_tags:Array.isArray(body.specialties)?body.specialties:[],currency:value(body.currency,3)||'USD',seller_type:'TAILOR',supports_custom_orders:true,supports_ready_made:false,pickup_available:false,delivery_available:false,shipping_available:false,is_live:false,is_verified:false,lifecycle_state:'DRAFT'}).select('id').single()
      if(profile.error||!profile.data){await local.client.auth.admin.deleteUser(userId);throw profile.error??new Error('Profile failed')}
      const invite=await local.client.from('tailor_claim_invites').insert({tailor_user_id:userId,tailor_profile_id:profile.data.id,created_by_principal:local.principal.id,source_handle:value(body.sourceHandle,120)||null,source_url:value(body.sourceUrl,500)||null,correlation_id:correlationId}).select('id').single()
      if(invite.error||!invite.data){await local.client.auth.admin.deleteUser(userId);throw invite.error??new Error('Invite failed')}
      await local.client.from('audit_logs').insert({actor_role:'OPS',event:'tailor_draft.created',severity:'info',payload:{invite_id:invite.data.id,profile_id:profile.data.id,principal_id:local.principal.id,correlation_id:correlationId,idempotency_key:idempotencyKey}})
      return await succeed({ok:true,inviteId:invite.data.id,profileId:profile.data.id,correlationId})
    }
    const inviteId=value(body.inviteId,40)
    const lookup=await local.client.from('tailor_claim_invites').select('id,status,tailor_user_id,tailor_profile_id,approved_at').eq('id',inviteId).maybeSingle()
    if(lookup.error||!lookup.data)return await rejected({error:'Draft not found.'},404,'DRAFT_NOT_FOUND')
    if(action==='EDIT'){
      if(!['DRAFT','INVITED','OPENED'].includes(lookup.data.status))return await rejected({error:'Draft is no longer editable.'},409,'DRAFT_NOT_EDITABLE')
      const patch:Record<string,unknown>={updated_at:new Date().toISOString()}
      for(const [input,column,max] of [['displayName','display_name',80],['businessName','business_name',120],['bio','bio',2000],['location','location',120],['currency','currency',3]] as const)if(input in body)patch[column]=value(body[input],max)||null
      if(Array.isArray(body.languages))patch.languages=body.languages
      if(Array.isArray(body.specialties))patch.specialty_tags=body.specialties
      if('priceMin' in body)patch.price_range_min=body.priceMin
      if('priceMax' in body)patch.price_range_max=body.priceMax
      const update=await local.client.from('tailor_profiles').update(patch).eq('id',lookup.data.tailor_profile_id);if(update.error)throw update.error
    }else if(action==='PREAPPROVE'){
      if(!local.principal.roles.includes('admin'))return await rejected({error:'Administrator approval required.'},403,'ADMIN_REQUIRED')
      const reason=value(body.reason,1000),evidence=value(body.evidenceRef,500),placement=value(body.placement,30)
      if(reason.length<20||evidence.length<8||!['TAILORING','READY_TO_WEAR'].includes(placement)||body.publicEvidenceReviewed!==true||body.videoWaiverAcknowledged!==true)return await rejected({error:'Reason, evidence, placement and acknowledgements are required.'},400,'INVALID_PREAPPROVAL')
      const update=await local.client.from('tailor_claim_invites').update({approved_by_principal:local.principal.id,approval_reason:reason,evidence_ref:evidence,public_evidence_reviewed:true,video_waiver_acknowledged:true,marketplace_placement:placement,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',inviteId);if(update.error)throw update.error
    }else if(action==='ISSUE'){
      if(!lookup.data.approved_at)return await rejected({error:'Admin pre-approval is required before issuing a link.'},409,'PREAPPROVAL_REQUIRED')
      const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+30*86400000).toISOString()
      const update=await local.client.from('tailor_claim_invites').update({token_hash:hash(token),status:'INVITED',expires_at:expiresAt,revoked_at:null,updated_at:new Date().toISOString()}).eq('id',inviteId).in('status',['DRAFT','INVITED','OPENED','REVOKED','EXPIRED']).select('id').maybeSingle();if(update.error)throw update.error
      if(!update.data)return await rejected({error:'This draft cannot receive a new link.'},409,'INVALID_INVITE_STATE')
      await local.client.from('tailor_profiles').update({lifecycle_state:'INVITED',updated_at:new Date().toISOString()}).eq('id',lookup.data.tailor_profile_id)
      await local.client.from('audit_logs').insert({actor_role:'OPS',event:'tailor_draft.invite_issued',severity:'warn',payload:{invite_id:inviteId,principal_id:local.principal.id,expires_at:expiresAt,correlation_id:correlationId,idempotency_key:idempotencyKey}})
      return await succeed({ok:true,token,expiresAt,correlationId})
    }else if(action==='REVOKE'||action==='DECLINE'){
      const state=action==='REVOKE'?'REVOKED':'DECLINED',now=new Date().toISOString()
      await local.client.from('tailor_claim_invites').update({status:state,token_hash:null,revoked_at:action==='REVOKE'?now:null,declined_at:action==='DECLINE'?now:null,updated_at:now}).eq('id',inviteId)
      await local.client.from('tailor_profiles').update({lifecycle_state:state,updated_at:now}).eq('id',lookup.data.tailor_profile_id)
    }else if(action==='REGISTER_MEDIA'){
      const kind=value(body.mediaKind,10),mime=value(body.contentType,80),bytes=Number(body.byteSize),sha=value(body.sha256,100)
      if(!['AVATAR','PHOTO','VIDEO'].includes(kind)||!allowedMime.has(mime)||!Number.isInteger(bytes)||bytes<1||bytes>52428800||!/^[a-f0-9]{64}$/iu.test(sha))return await rejected({error:'Invalid media metadata.'},400,'INVALID_MEDIA')
      const assetId=randomUUID(),extension=mime==='image/png'?'png':mime==='image/webp'?'webp':mime==='image/jpeg'?'jpg':mime==='video/quicktime'?'mov':'mp4'
      const path=`drafts/${lookup.data.tailor_user_id}/${inviteId}/${assetId}.${extension}`
      const signed=await local.client.storage.from('tailor-draft-media').createSignedUploadUrl(path)
      if(signed.error||!signed.data)throw signed.error??new Error('Upload URL failed')
      const inserted=await local.client.from('tailor_draft_media').insert({id:assetId,invite_id:inviteId,storage_path:path,media_kind:kind,content_type:mime,byte_size:bytes,sha256:sha,sort_order:Number(body.sortOrder)||0,is_cover:body.isCover===true,focal_x:body.focalX??null,focal_y:body.focalY??null})
      if(inserted.error)throw inserted.error
      return await succeed({ok:true,assetId,signedUploadUrl:signed.data.signedUrl,uploadToken:signed.data.token,storagePath:path,correlationId})
    }else if(action==='CONFIRM_MEDIA'){
      const assetId=value(body.assetId,40)
      const asset=await local.client.from('tailor_draft_media').select('id,storage_path,content_type,byte_size,sha256,media_kind').eq('id',assetId).eq('invite_id',inviteId).maybeSingle()
      if(!asset.data)return await rejected({error:'Draft media was not found.'},404,'MEDIA_NOT_FOUND')
      const download=await local.client.storage.from('tailor-draft-media').download(asset.data.storage_path)
      if(download.error||!download.data)return await rejected({error:'The private upload did not finish.'},409,'UPLOAD_INCOMPLETE')
      const bytes=new Uint8Array(await download.data.arrayBuffer()),inspection=inspectDraftMedia(bytes,asset.data.content_type)
      const digest=createHash('sha256').update(bytes).digest('hex')
      if(bytes.byteLength!==Number(asset.data.byte_size)||digest!==asset.data.sha256||!inspection||inspection.width>12000||inspection.height>12000||(inspection.durationMs??0)>300000){
        await local.client.storage.from('tailor-draft-media').remove([asset.data.storage_path])
        await local.client.from('tailor_draft_media').delete().eq('id',assetId)
        return await rejected({error:'The uploaded bytes failed private media validation.'},415,'MEDIA_VALIDATION_FAILED')
      }
      const mediaAsset=await local.client.rpc('upsert_media_asset',{p_bucket_id:'tailor-draft-media',p_object_path:asset.data.storage_path,p_owner_user_id:lookup.data.tailor_user_id,p_order_id:null,p_tailor_profile_id:lookup.data.tailor_profile_id,p_purpose:asset.data.media_kind,p_mime_type:inspection.mimeType,p_byte_size:bytes.byteLength,p_width:inspection.width,p_height:inspection.height,p_duration_ms:inspection.durationMs,p_checksum_sha256:asset.data.sha256,p_public_url:null,p_metadata:{private:true,surface:'tailor_draft.private',relatedEntityId:assetId}})
      if(mediaAsset.error||typeof mediaAsset.data!=='string')throw mediaAsset.error??new Error('Media safety record failed')
      const update=await local.client.from('tailor_draft_media').update({width:inspection.width,height:inspection.height,duration_ms:inspection.durationMs,media_asset_id:mediaAsset.data,confirmed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',assetId)
      if(update.error)throw update.error
      return await succeed({ok:true,assetId,moderationStatus:'PENDING',correlationId})
    }else if(action==='MODERATE_MEDIA'){
      if(!local.principal.roles.includes('admin'))return await rejected({error:'Administrator approval required.'},403,'ADMIN_REQUIRED')
      const assetId=value(body.assetId,40),decision=value(body.decision,20).toUpperCase(),reason=value(body.reason,500)
      if(!['APPROVE','BLOCK'].includes(decision)||reason.length<12)return await rejected({error:'A media decision and reason are required.'},400,'INVALID_MEDIA_DECISION')
      const asset=await local.client.from('tailor_draft_media').select('id,media_asset_id').eq('id',assetId).eq('invite_id',inviteId).not('confirmed_at','is',null).maybeSingle()
      if(!asset.data?.media_asset_id)return await rejected({error:'Confirmed draft media was not found.'},404,'MEDIA_NOT_FOUND')
      const status=decision==='APPROVE'?'APPROVED':'BLOCKED'
      const moderation=await local.client.rpc('set_media_asset_moderation_status',{p_media_asset_id:asset.data.media_asset_id,p_status:status,p_risk_level:decision==='APPROVE'?'LOW':'HIGH',p_reasons:decision==='APPROVE'?[]:[`OPS_BLOCK:${reason}`],p_reviewed_by:local.principal.email})
      if(moderation.error)throw moderation.error
      await local.client.from('tailor_draft_media').update({moderation_status:status,updated_at:new Date().toISOString()}).eq('id',assetId)
    }else if(action==='DELETE_MEDIA'){
      const assetId=value(body.assetId,40)
      const asset=await local.client.from('tailor_draft_media').select('storage_path,media_asset_id').eq('id',assetId).eq('invite_id',inviteId).maybeSingle()
      if(asset.data){const removal=await local.client.storage.from('tailor-draft-media').remove([asset.data.storage_path]);if(removal.error)throw removal.error;await local.client.from('tailor_draft_media').delete().eq('id',assetId);if(asset.data.media_asset_id)await local.client.from('media_assets').delete().eq('id',asset.data.media_asset_id)}
    }else if(action==='UPDATE_MEDIA'){
      const assetId=value(body.assetId,40),sortOrder=Number(body.sortOrder),focalX=Number(body.focalX),focalY=Number(body.focalY)
      if(!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>1000||!Number.isFinite(focalX)||focalX<0||focalX>1||!Number.isFinite(focalY)||focalY<0||focalY>1)return await rejected({error:'Invalid media layout.'},400,'INVALID_MEDIA_LAYOUT')
      const updated=await local.client.rpc('update_tailor_draft_media_layout',{p_invite_id:inviteId,p_asset_id:assetId,p_sort_order:sortOrder,p_is_cover:body.isCover===true,p_focal_x:focalX,p_focal_y:focalY})
      if(updated.error)throw updated.error
      if(updated.data!==true)return await rejected({error:'Draft media was not found.'},404,'MEDIA_NOT_FOUND')
    }else return await rejected({error:'Unsupported action.'},400,'UNSUPPORTED_ACTION')
    await local.client.from('audit_logs').insert({actor_role:'OPS',event:`tailor_draft.${action.toLowerCase()}`,severity:'info',payload:{invite_id:inviteId,principal_id:local.principal.id,correlation_id:correlationId,idempotency_key:idempotencyKey}})
    return await succeed({ok:true,correlationId})
  }catch(error){return await rejected({error:error instanceof Error?error.message:'Draft action failed.',correlationId},409,'ACTION_FAILED')}
}
