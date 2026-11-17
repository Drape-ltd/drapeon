import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createHash, randomUUID } from 'node:crypto'
import { ShieldCheck, Smartphone } from 'lucide-react'
import { TailorProfileView } from '../../../components/tailor-profile-view'
import type { PublicTailor } from '../../../lib/public-marketplace'
import { getSupabasePublishableKey, getSupabaseUrl } from '../../../lib/supabase-config'
import { createServiceRoleClient } from '../../../lib/server-supabase'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Private shop preview', robots: { index: false, follow: false } }

type PreviewPayload = { ok?: boolean; preview?: Record<string, unknown> }
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

async function resolveDevelopmentPreview(token: string): Promise<Record<string, unknown> | null> {
  if (process.env.NODE_ENV === 'production') return null
  const client=createServiceRoleClient()
  if(!client)return null
  const tokenHash=createHash('sha256').update(token).digest('base64url')
  const {data:invite}=await client.rpc('resolve_tailor_claim_preview',{p_token_hash:tokenHash}).maybeSingle()
  if(!invite)return null
  const resolution=invite as {invite_id:string;profile_id:string;opened_now:boolean}
  const {data:profile}=await client.from('tailor_profiles').select('id,display_name,business_name,bio,location,languages,specialty_tags,price_range_min,price_range_max,currency,seller_type,availability,supports_custom_orders,supports_ready_made,pickup_available,delivery_available,shipping_available').eq('id',resolution.profile_id).eq('lifecycle_state','OPENED').maybeSingle()
  if(!profile)return null
  const {data:media}=await client.from('tailor_draft_media').select('id,media_kind,storage_path,sort_order,is_cover,focal_x,focal_y').eq('invite_id',resolution.invite_id).eq('moderation_status','APPROVED').not('confirmed_at','is',null).order('sort_order')
  const safeMedia:Array<Record<string,unknown>>=[]
  for(const asset of media??[]){const {data}=await client.storage.from('tailor-draft-media').createSignedUrl(asset.storage_path,300);if(data?.signedUrl)safeMedia.push({id:asset.id,kind:asset.media_kind,url:data.signedUrl,sortOrder:asset.sort_order,isCover:asset.is_cover,focalX:asset.focal_x,focalY:asset.focal_y})}
  if(resolution.opened_now)await client.from('audit_logs').insert({actor_role:'SYSTEM',event:'tailor_claim.preview_opened',severity:'info',payload:{invite_id:resolution.invite_id,correlation_id:randomUUID(),broker:'development-web'}})
  return {...profile,id:'private-preview',media:safeMedia}
}

async function resolvePreview(token: string): Promise<PublicTailor | null> {
  const supabaseUrl=getSupabaseUrl(),publishableKey=getSupabasePublishableKey()
  let row:Record<string,unknown>|null=null
  if(supabaseUrl&&publishableKey){
    const response = await fetch(`${supabaseUrl.replace(/\/+$/u,'')}/functions/v1/tailor-draft-action`, {method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',apikey:publishableKey},body:JSON.stringify({action:'RESOLVE_PREVIEW',token})})
    if(response.ok){const payload=await response.json() as PreviewPayload;row=payload.preview??null}
  }
  row=row??await resolveDevelopmentPreview(token)
  if (!row||typeof row.id!=='string'||typeof row.display_name!=='string') return null
  const media=Array.isArray(row.media)?row.media as Array<Record<string,unknown>>:[]
  const normalized=media.flatMap((item,index)=>typeof item.url==='string'?[{id:String(item.id??index),kind:item.kind==='VIDEO'?'VIDEO' as const:'IMAGE' as const,url:item.url,posterUrl:null,width:null,height:null,focalX:typeof item.focalX==='number'?item.focalX:0.5,focalY:typeof item.focalY==='number'?item.focalY:0.5,altText:null,isPrimary:item.isCover===true,position:typeof item.sortOrder==='number'?item.sortOrder:index}]:[])
  const photos=normalized.filter(item=>item.kind==='IMAGE').map(item=>item.url)
  const videos=normalized.filter(item=>item.kind==='VIDEO').map(item=>item.url)
  const avatar=media.find(item=>item.kind==='AVATAR'&&typeof item.url==='string')?.url
  return {id:row.id,displayName:row.display_name,businessName:typeof row.business_name==='string'?row.business_name:null,bio:typeof row.bio==='string'?row.bio:null,location:typeof row.location==='string'?row.location:null,specialties:strings(row.specialty_tags).slice(0,20),availability:typeof row.availability==='string'?row.availability:null,acceptsCustomOrders:row.supports_custom_orders===true,supportsReadyMade:row.supports_ready_made===true,portfolioPhotos:photos,portfolioVideos:videos,coverVideoUrl:videos[0]??null,avatarUrl:typeof avatar==='string'?avatar:photos[0]??null,media:normalized,languages:strings(row.languages),averageRating:0,totalReviews:0,totalOrders:0,responseHours:null,currency:typeof row.currency==='string'?row.currency:null,priceRangeMin:typeof row.price_range_min==='number'?row.price_range_min:null,priceRangeMax:typeof row.price_range_max==='number'?row.price_range_max:null,fulfillment:[...(row.pickup_available===true?['Pickup' as const]:[]),...(row.delivery_available===true?['Local delivery' as const]:[]),...(row.shipping_available===true?['Shipping' as const]:[])],reviews:[]}
}

export default async function ClaimPreviewPage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params
  if(!/^[A-Za-z0-9_-]{40,60}$/u.test(token)) notFound()
  const tailor=await resolvePreview(token)
  if(!tailor) notFound()
  return <main className="min-h-screen bg-ui-canvas px-4 py-6 text-ink sm:px-8"><div className="mx-auto max-w-[92rem]"><aside className="mb-5 flex flex-col gap-4 rounded-[12px] border border-needle/20 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-needle"><ShieldCheck size={15}/>Private until you claim it</p><h1 className="mt-2 text-2xl">This is how your Drapeon shop will look.</h1><p className="mt-1 text-sm text-ink/60">Only someone with your private link can see this preview.</p></div><div className="flex flex-wrap gap-2"><a href={`drapeon://claim/${encodeURIComponent(token)}`} className="inline-flex min-h-11 items-center gap-2 rounded-[9px] bg-needle px-5 text-sm font-semibold text-white"><Smartphone size={16}/>Claim your shop in the app</a><span className="inline-flex min-h-11 items-center rounded-[9px] border border-ink/15 px-4 text-sm font-semibold text-ink/45" aria-label="Available in PR 2">Continue on web · coming next</span></div></aside><TailorProfileView tailor={tailor} preview /></div></main>
}
