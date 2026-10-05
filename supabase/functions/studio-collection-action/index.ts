import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { parseSavedLooks } from '../../../packages/drape-studio/src/studio-storage.ts'

const MAX_BYTES = 8_000_000
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('load') }),
  z.object({
    action: z.literal('save'),
    expectedRevision: z.number().int().min(0),
    looks: z.unknown(),
  }),
])

function response(cors: HeadersInit, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response(cors, { error: 'Method not allowed.' }, 405)
  const auth = await getAuthUser(req)
  if (!auth) return response(cors, { error: 'Sign in again to continue.' }, 401)
  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return response(cors, { error: parsed.error }, 400)
  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())

  if (parsed.data.action === 'load') {
    const { data, error } = await supabase.from('studio_collections')
      .select('revision, looks, updated_at').eq('owner_id', auth.id).maybeSingle()
    if (error) return response(cors, { error: 'Could not load saved Studio looks.' }, 500)
    return response(cors, { ok: true, revision: data?.revision ?? 0, looks: data?.looks ?? [], updatedAt: data?.updated_at ?? null })
  }

  let looks
  try {
    looks = parseSavedLooks(parsed.data.looks)
  } catch {
    return response(cors, { error: 'The Studio collection is invalid or too large.' }, 400)
  }
  if (new TextEncoder().encode(JSON.stringify(looks)).byteLength > MAX_BYTES) {
    return response(cors, { error: 'These designs are too large to sync. Remove an unused look and retry.' }, 413)
  }

  const now = new Date().toISOString()
  if (parsed.data.expectedRevision === 0) {
    const { data, error } = await supabase.from('studio_collections').insert({
      owner_id: auth.id, revision: 1, looks, updated_at: now,
    }).select('revision, updated_at').single()
    if (error?.code === '23505') return response(cors, { code: 'STUDIO_SAVE_CONFLICT', error: 'Another device saved first. Your copy is still on this device; reopen Studio to compare the looks.' }, 409)
    if (error || !data) return response(cors, { error: 'Could not sync Studio looks right now.' }, 500)
    return response(cors, { ok: true, revision: data.revision, updatedAt: data.updated_at })
  }

  const { data, error } = await supabase.from('studio_collections').update({
    revision: parsed.data.expectedRevision + 1, looks, updated_at: now,
  }).eq('owner_id', auth.id).eq('revision', parsed.data.expectedRevision)
    .select('revision, updated_at').maybeSingle()
  if (error) return response(cors, { error: 'Could not sync Studio looks right now.' }, 500)
  if (!data) return response(cors, { code: 'STUDIO_SAVE_CONFLICT', error: 'Another device saved first. Your copy is still on this device; reopen Studio to compare the looks.' }, 409)
  return response(cors, { ok: true, revision: data.revision, updatedAt: data.updated_at })
})
