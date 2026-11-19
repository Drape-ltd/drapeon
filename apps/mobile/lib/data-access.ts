import { invokeFunction } from './supabase'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'

export type DataAccessStatus = { id: string | null; status: string; createdAt: string; exportId?: string | null; generationWarnings?: number }

export async function getDataAccessStatus(): Promise<DataAccessStatus | null> {
  const { data, error } = await invokeFunction<{ request?: DataAccessStatus | null }>('request-data-access', { body: { action: 'STATUS', source: 'MOBILE_APP' } })
  if (error) throw new Error(await readFunctionErrorMessage(error, 'We could not check your data request.'))
  return data?.request ?? null
}

export async function refreshDataAccessExport(): Promise<void> {
  const { error } = await invokeFunction('request-data-access', { body: { action: 'REFRESH_EXPORT', source: 'MOBILE_APP' } })
  if (error) throw new Error(await readFunctionErrorMessage(error, 'We could not refresh your export.'))
}

export async function downloadDataAccessExport(): Promise<unknown> {
  const { data, error } = await invokeFunction<{ exportPackage?: unknown }>('request-data-access', { body: { action: 'DOWNLOAD', source: 'MOBILE_APP' } })
  if (error) throw new Error(await readFunctionErrorMessage(error, 'We could not download your export.'))
  if (!data?.exportPackage) throw new Error('The export response was incomplete.')
  return data.exportPackage
}

export async function requestDataAccess(note?: string): Promise<{
  error: string | null
  alreadyPending?: boolean
  tailorExportId?: string | null
}> {
  const payload = note?.trim() ? { note: note.trim() } : {}
  const { data, error } = await invokeFunction<{ ok?: boolean; alreadyPending?: boolean; tailorExportId?: string | null }>(
    'request-data-access',
    { body: payload }
  )

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not submit your data request yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not submit your data request right now.'),
    }
  }

  return {
    error: null,
    alreadyPending: data?.alreadyPending === true,
    tailorExportId: data?.tailorExportId ?? null,
  }
}
