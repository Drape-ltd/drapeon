type PrivacyCaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>
      }
    }
  }
}

type ExpectedPrivacyCase = {
  dedupeKey: string
  issueType: 'DATA_ACCESS_REQUEST' | 'ACCOUNT_DELETION_REQUEST'
  environment: string
  userId: string
  relatedEntityId?: string
}

/** Recheck after repair so a failed write never becomes a false alreadyPending response. */
export async function ensurePrivacyOpsCase(
  client: unknown,
  expected: ExpectedPrivacyCase,
  repair: () => unknown | Promise<unknown>,
) {
  const lookupClient = client as PrivacyCaseClient
  async function matchingCaseExists() {
    const { data, error } = await lookupClient.from('ops_issues')
      .select('id, issue_type, environment, user_id, related_entity_type, related_entity_id')
      .eq('dedupe_key', expected.dedupeKey)
      .maybeSingle()
    if (error) throw new Error(`Privacy case lookup failed: ${error.message}`)
    return Boolean(data?.id && data.issue_type === expected.issueType
      && data.environment === expected.environment && data.user_id === expected.userId
      && (!expected.relatedEntityId || (data.related_entity_type === 'account_deletion_request'
        && data.related_entity_id === expected.relatedEntityId)))
  }

  if (await matchingCaseExists()) return
  await repair()
  if (!await matchingCaseExists()) throw new Error('Privacy request is recorded, but its Ops case is unavailable.')
}
