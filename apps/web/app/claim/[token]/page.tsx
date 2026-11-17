import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { TailorProfileView } from '../../../components/tailor-profile-view'
import type { PublicTailor } from '../../../lib/public-marketplace'
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '../../../lib/supabase-config'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Private shop preview', robots: { index: false, follow: false } }

type PreviewPayload = { ok?: boolean; preview?: Record<string, unknown> }
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

async function resolvePreview(token: string, clientIp:string): Promise<PublicTailor | null> {
  const supabaseUrl=getSupabaseUrl(),serviceRoleKey=getSupabaseServiceRoleKey()
  let row:Record<string,unknown>|null=null
  if(supabaseUrl&&serviceRoleKey&&clientIp){
    const response = await fetch(`${supabaseUrl.replace(/\/+$/u,'')}/functions/v1/tailor-draft-action`, {method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,'x-drape-client-ip':clientIp},body:JSON.stringify({action:'RESOLVE_PREVIEW',token})})
    if(response.ok){const payload=await response.json() as PreviewPayload;row=payload.preview??null}
  }
  if (!row||typeof row.id!=='string'||typeof row.display_name!=='string') return null
  const media=Array.isArray(row.media)?row.media as Array<Record<string,unknown>>:[]
  const normalized=media.flatMap((item,index)=>item.kind!=='AVATAR'&&typeof item.url==='string'?[{id:String(item.id??index),kind:item.kind==='VIDEO'?'VIDEO' as const:'IMAGE' as const,url:item.url,posterUrl:null,width:null,height:null,focalX:typeof item.focalX==='number'?item.focalX:0.5,focalY:typeof item.focalY==='number'?item.focalY:0.5,altText:null,isPrimary:item.isCover===true,position:typeof item.sortOrder==='number'?item.sortOrder:index}]:[])
  const photos=normalized.filter(item=>item.kind==='IMAGE').map(item=>item.url)
  const videos=normalized.filter(item=>item.kind==='VIDEO').map(item=>item.url)
  const avatar=media.find(item=>item.kind==='AVATAR'&&typeof item.url==='string')?.url
  return {id:row.id,displayName:row.display_name,businessName:typeof row.business_name==='string'?row.business_name:null,bio:typeof row.bio==='string'?row.bio:null,location:typeof row.location==='string'?row.location:null,specialties:strings(row.specialty_tags).slice(0,20),availability:typeof row.availability==='string'?row.availability:null,acceptsCustomOrders:row.supports_custom_orders===true,supportsReadyMade:row.supports_ready_made===true,portfolioPhotos:photos,portfolioVideos:videos,coverVideoUrl:videos[0]??null,avatarUrl:typeof avatar==='string'?avatar:photos[0]??null,media:normalized,languages:strings(row.languages),averageRating:0,totalReviews:0,totalOrders:0,responseHours:null,currency:typeof row.currency==='string'?row.currency:null,priceRangeMin:typeof row.price_range_min==='number'?row.price_range_min:null,priceRangeMax:typeof row.price_range_max==='number'?row.price_range_max:null,fulfillment:[...(row.pickup_available===true?['Pickup' as const]:[]),...(row.delivery_available===true?['Local delivery' as const]:[]),...(row.shipping_available===true?['Shipping' as const]:[])],reviews:[]}
}

export default async function ClaimPreviewPage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params
  if(!/^[A-Za-z0-9_-]{40,60}$/u.test(token)) notFound()
  const requestHeaders=await headers()
  const clientIp=requestHeaders.get('cf-connecting-ip')?.trim()||(process.env.NODE_ENV!=='production'?(requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()||'127.0.0.1'):'')
  const tailor=await resolvePreview(token,clientIp)
  if(!tailor) notFound()
  return <main className="min-h-screen bg-[#f4f0e8] text-ink"><div className="mx-auto max-w-[92rem]"><header className="px-4 pb-2 pt-5 text-center sm:px-8"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/45">A private preview shared with you by Drapeon</p><h1 className="mt-2 font-serif text-3xl italic sm:text-4xl">Meet your new shop.</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink/58">Your work takes the lead. Only someone with this private link can see the preview.</p></header><div className="px-3 pb-8 sm:px-8"><TailorProfileView tailor={tailor} preview /></div></div></main>
}
