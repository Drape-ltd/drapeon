import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeCronRequest } from '../_shared/cron.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { audit, log } from '../_shared/logger.ts'

const FN='purge-tailor-drafts',BATCH=50,RETENTION_DAYS=30
Deno.serve(async request=>{
  const cors=getCorsHeaders(request),unauthorized=await authorizeCronRequest(request,FN,cors)
  if(unauthorized)return unauthorized
  const client=createClient(getSupabaseUrl(),getServiceRoleKey(),{auth:{persistSession:false,autoRefreshToken:false}})
  const cutoff=new Date(Date.now()-RETENTION_DAYS*86400000).toISOString(),now=new Date().toISOString()
  const abandonedCutoff=new Date(Date.now()-86400000).toISOString()
  const {data:abandoned,error:abandonedError}=await client.from('tailor_draft_media').select('id,storage_path').is('confirmed_at',null).lt('created_at',abandonedCutoff).order('created_at').limit(BATCH)
  if(abandonedError)return new Response(JSON.stringify({error:'Abandoned upload lookup failed.'}),{status:500,headers:{...cors,'Content-Type':'application/json'}})
  let abandonedPurged=0
  for(const asset of abandoned??[]){
    const removal=await client.storage.from('tailor-draft-media').remove([asset.storage_path])
    if(removal.error){log('error',FN,'abandoned_media.purge_failed',{asset_id:asset.id,error:removal.error.message});continue}
    const deleted=await client.from('tailor_draft_media').delete().eq('id',asset.id).is('confirmed_at',null)
    if(!deleted.error)abandonedPurged++
  }
  const {data,error}=await client.from('tailor_claim_invites').select('id,tailor_user_id,status,expires_at,updated_at').or(`and(status.in.(INVITED,OPENED),expires_at.lt.${now}),and(status.in.(EXPIRED,REVOKED,DECLINED),updated_at.lt.${cutoff})`).order('updated_at').limit(BATCH)
  if(error)return new Response(JSON.stringify({error:'Purge lookup failed.'}),{status:500,headers:{...cors,'Content-Type':'application/json'}})
  let purged=0,failed=0
  for(const invite of data??[]){
    try{
      if(['INVITED','OPENED'].includes(invite.status)){
        await client.from('tailor_claim_invites').update({status:'EXPIRED',token_hash:null,updated_at:now}).eq('id',invite.id).in('status',['INVITED','OPENED'])
        await client.from('tailor_profiles').update({lifecycle_state:'EXPIRED',updated_at:now}).eq('user_id',invite.tailor_user_id)
        continue
      }
      const {data:assets}=await client.from('tailor_draft_media').select('storage_path,media_asset_id').eq('invite_id',invite.id)
      const paths=(assets??[]).map(item=>item.storage_path).filter(Boolean)
      if(paths.length){const removal=await client.storage.from('tailor-draft-media').remove(paths);if(removal.error)throw removal.error}
      const mediaAssetIds=(assets??[]).map(item=>item.media_asset_id).filter(Boolean)
      if(mediaAssetIds.length){const removedAssets=await client.from('media_assets').delete().in('id',mediaAssetIds);if(removedAssets.error)throw removedAssets.error}
      const removedProfile=await client.from('tailor_profiles').delete().eq('user_id',invite.tailor_user_id)
      if(removedProfile.error)throw removedProfile.error
      const deletion=await client.auth.admin.deleteUser(invite.tailor_user_id)
      if(deletion.error)throw deletion.error
      purged++
      await audit(client,{event:'tailor_draft.purged',actor_id:null,actor_role:'SYSTEM',severity:'info',payload:{invite_id:invite.id,terminal_status:invite.status,retention_days:RETENTION_DAYS}})
    }catch(cause){failed++;log('error',FN,'draft.purge_failed',{invite_id:invite.id,error:cause instanceof Error?cause.message:String(cause)})}
  }
  return new Response(JSON.stringify({ok:failed===0,scanned:(data??[]).length,purged,abandonedPurged,failed,batch:BATCH}),{status:failed?207:200,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
})
