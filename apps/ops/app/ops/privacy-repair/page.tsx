import { notFound } from 'next/navigation'
import { PageHead } from '../../../components/page-head'
import { LegacyPrivacyRepairPanel } from '../../../components/legacy-privacy-repair-panel'
import { getOpsSession, hasFreshOpsMfa } from '../../../lib/ops-session'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { createServiceRoleClient } from '../../../../web/lib/server-supabase'

export const dynamic = 'force-dynamic'

const LEGACY_PRIVACY_CASE_ID = 'c3d227f8-128a-4650-93ff-04a19e66ad02'

export default async function PrivacyRepairPage() {
  const [session, phoneRestricted] = await Promise.all([getOpsSession(), isRestrictedOpsPhoneRequest()])
  if (!session?.allowed || session.role !== 'admin' || !hasFreshOpsMfa(session) || phoneRestricted) notFound()
  const client = createServiceRoleClient()
  if (!client) notFound()
  const { data } = await client.from('ops_issues')
    .select('case_number,record_version,issue_type,source,environment,provenance,canonical_status')
    .eq('id', LEGACY_PRIVACY_CASE_ID)
    .maybeSingle()
  if (!data
    || data.issue_type !== 'DATA_ACCESS_REQUEST'
    || data.source !== 'request-data-access'
    || data.environment !== 'UNKNOWN'
    || data.provenance !== 'UNKNOWN'
    || !Number.isSafeInteger(data.record_version)) notFound()
  return <>
    <PageHead eyebrow="Privacy / Audited repair" title="Restore legacy QA privacy case" description="A narrowly scoped forward repair for the one QA data-access case that predated environment validation." />
    <LegacyPrivacyRepairPanel caseNumber={data.case_number} recordVersion={data.record_version} />
  </>
}
