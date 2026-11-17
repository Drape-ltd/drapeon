import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { PageHead } from '../../../components/page-head'
import { TailorDraftBuilder } from '../../../components/tailor-draft-builder'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { createServiceRoleClient } from '../../../../web/lib/server-supabase'

export const dynamic='force-dynamic'
export default async function DraftTailorsPage(){
  if(!(await hasOpsAreaAccess('tailors')))return <OpsPermissionRestriction area="Draft tailors"/>
  if(await isRestrictedOpsPhoneRequest())return <OpsPhoneRestriction area="Draft tailors"/>
  const client=createServiceRoleClient();let drafts:unknown[]=[]
  if(client){const result=await client.from('tailor_claim_invites').select('id,status,expires_at,tailor_profile_id,tailor_profiles(display_name,business_name,bio,location,languages,specialty_tags,currency,price_range_min,price_range_max,lifecycle_state),tailor_draft_media(id,media_kind,content_type,sort_order,is_cover,focal_x,focal_y,moderation_status,confirmed_at)').order('created_at',{ascending:false}).order('sort_order',{referencedTable:'tailor_draft_media'}).limit(100);drafts=(result.data??[]).map((draft)=>({...draft,tailor_draft_media:(draft.tailor_draft_media??[]).filter((media)=>Boolean(media.confirmed_at))}))}
  return <><PageHead eyebrow="Marketplace / Acquisition" title="Draft tailors" description="Build a private storefront, capture administrator pre-approval, and issue a single-use preview link. Drafts never enter the public roster."/><TailorDraftBuilder initialDrafts={drafts as never[]}/></>
}
