import { notFound } from 'next/navigation'
import Image from 'next/image'
import { getOpsSession, hasFreshOpsMfa } from '../../../../web/lib/ops-auth'
import { loadTrustCaseContext } from '../../../lib/domain-data'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { TrustExceptionPanel } from '../../../components/trust-exception-panel'

export const dynamic = 'force-dynamic'
export default async function TrustExceptionsPage({searchParams}:{searchParams:Promise<{profileId?:string;protected?:string}>}) {
  const params = await searchParams
  const session = await getOpsSession()
  if (!session?.allowed || session.role !== 'admin' || await isRestrictedOpsPhoneRequest()) notFound()
  const profileId = params.profileId ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(profileId)) return <p>Open this workspace from an exact tailor profile. A valid profile ID is required.</p>
  const context = await loadTrustCaseContext({tailorProfileId:profileId,userId:null})
  if (!context) notFound()
  const returnTo = `/ops/trust-exceptions?profileId=${encodeURIComponent(profileId)}`
  const checkpoint = `/ops/sensitive/trust-decision?returnTo=${encodeURIComponent(returnTo)}`
  return <><header className="ops-page-head"><h1>Recruitment video exception</h1><p>{context.displayName} · {context.location} · Storefront approval is separate from payment-provider verification.</p></header>
    <section className="ops-panel"><div className="ops-panel-head"><h2>Public evidence to review</h2></div><div className="ops-panel-body">
      <p>{context.specialties.join(', ')}</p><div className="ops-media-grid">{[context.avatarUrl,...context.portfolioPhotoUrls].filter((url):url is string=>Boolean(url)).map((url,index)=><a key={url} href={url} target="_blank" rel="noreferrer" className="ops-media-tile"><Image src={url} alt={index===0?'Profile photo':`Portfolio photo ${index}`} width={480} height={320} unoptimized /><span>{index===0?'Profile photo':`Portfolio photo ${index}`}</span></a>)}</div>
      <p>{context.hasChallengeVideo?'A video exists. Use the normal review path; this waiver is unavailable.':'No challenge video is present.'}</p>
    </div></section>
    {!context.hasChallengeVideo ? <TrustExceptionPanel key={`${profileId}:${params.protected ?? ''}`} profileId={profileId} protectedAccess={params.protected==='verified' && hasFreshOpsMfa(session)} checkpoint={checkpoint} /> : null}
  </>
}
