import { OpsPermissionRestriction } from '../../../components/ops-permission-restriction'
import { OpsPhoneRestriction } from '../../../components/ops-phone-restriction'
import { PageHead } from '../../../components/page-head'
import { TailorDraftBuilder } from '../../../components/tailor-draft-builder'
import { hasOpsAreaAccess } from '../../../lib/route-access'
import { isRestrictedOpsPhoneRequest } from '../../../lib/client-surface'
import { createServiceRoleClient } from '../../../../web/lib/server-supabase'

export const dynamic = 'force-dynamic'
export default async function DraftTailorsPage() {
  if (!(await hasOpsAreaAccess('tailors'))) return <OpsPermissionRestriction area="Draft tailors" />
  if (await isRestrictedOpsPhoneRequest()) return <OpsPhoneRestriction area="Draft tailors" />
  const client = createServiceRoleClient()
  let drafts: unknown[] = []
  if (client) {
    const result = await client
      .from('tailor_claim_invites')
      .select(
        'id,status,created_at,updated_at,expires_at,approved_at,approval_reason,evidence_ref,marketplace_placement,created_by_principal,approved_by_principal,tailor_profile_id,tailor_profiles(display_name,business_name,bio,location,languages,specialty_tags,currency,price_range_min,price_range_max,lifecycle_state),tailor_draft_media(id,media_kind,content_type,storage_path,duration_ms,sort_order,is_cover,focal_x,focal_y,moderation_status,confirmed_at)'
      )
      .order('created_at', { ascending: false })
      .order('sort_order', { referencedTable: 'tailor_draft_media' })
      .limit(100)
    const principalIds = Array.from(
      new Set(
        (result.data ?? []).flatMap((draft) =>
          [draft.created_by_principal, draft.approved_by_principal].filter(Boolean)
        )
      )
    )
    const principals = principalIds.length
      ? await client.from('ops_workforce_principals').select('id,email').in('id', principalIds)
      : { data: [] }
    const principalLabels = new Map((principals.data ?? []).map((item) => [item.id, item.email]))
    drafts = await Promise.all(
      (result.data ?? []).map(async (draft) => ({
        ...draft,
        created_by_label: principalLabels.get(draft.created_by_principal) ?? null,
        approved_by_label: draft.approved_by_principal
          ? (principalLabels.get(draft.approved_by_principal) ?? 'Unknown administrator')
          : null,
        tailor_draft_media: await Promise.all(
          (draft.tailor_draft_media ?? [])
            .filter((media) => Boolean(media.confirmed_at))
            .map(async (media) => {
              const signed = await client.storage
                .from('tailor-draft-media')
                .createSignedUrl(media.storage_path, 3600)
              return { ...media, preview_url: signed.data?.signedUrl ?? null }
            })
        ),
      }))
    )
  }
  return (
    <>
      <PageHead
        eyebrow="Marketplace / Acquisition"
        title="Draft tailors"
        description="Build a private storefront, capture administrator pre-approval, and issue a single-use preview link. Drafts never enter the public roster."
      />
      <TailorDraftBuilder initialDrafts={drafts as never[]} />
    </>
  )
}
