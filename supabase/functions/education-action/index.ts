import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { getGuide } from '../../../packages/shared/src/guide-library.ts'
const Value = z.union([
  z.boolean(), z.null(),
  z.object({ status: z.enum(['started', 'skipped', 'dismissed', 'completed']), step: z.number().int().min(0).max(20) }).strict(),
  z.object({ title: z.string().trim().min(1).max(80), guideIds: z.array(z.string().refine(id => !!getGuide(id))).max(8) }).strict(),
])
const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('load') }),
  z.object({ action: z.literal('save'), expectedRevision: z.number().int().min(0), data: z.record(Value).refine(data => Object.keys(data).length <= 256 && Object.entries(data).every(([key, value]) => {
    if (key.startsWith('saved:')) return !!getGuide(key.slice(6)) && (typeof value === 'boolean' || value === null)
    if (/^collection:[a-zA-Z0-9-]{1,64}$/.test(key)) return value === null || (typeof value === 'object' && 'guideIds' in value)
    return /^progress:(CUSTOMER|TAILOR):(welcome|studio|vision|brief):v1$/.test(key) && value !== null && typeof value === 'object' && 'status' in value
  })) }),
])
Deno.serve(async req => {
  const cors = getCorsHeaders(req)
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)
  const user = await getAuthUser(req)
  if (!user) return respond({ error: 'Please sign in again.' }, 401)
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > 100000) return respond({ error: 'Guide preferences are too large.' }, 413)
  let body
  try { body = JSON.parse(raw) } catch { return respond({ error: 'Invalid request' }, 400) }
  const parsed = parseBody(Schema, body)
  if (!parsed.ok) return respond({ error: parsed.error }, 400)
  const db = createClient(getSupabaseUrl(), getServiceRoleKey())
  if (parsed.data.action === 'load') {
    const { data, error } = await db.from('education_preferences').select('revision,data').eq('owner_id', user.id).maybeSingle()
    return error ? respond({ error: 'Could not load guide preferences.' }, 500) : respond(data || { revision: 0, data: {} })
  }
  const input = parsed.data
  const record = { owner_id: user.id, revision: input.expectedRevision + 1, data: input.data, updated_at: new Date().toISOString() }
  const query = input.expectedRevision === 0 ? db.from('education_preferences').insert(record) : db.from('education_preferences').update(record).eq('owner_id', user.id).eq('revision', input.expectedRevision)
  const { data, error } = await query.select('revision,data').maybeSingle()
  if (error?.code === '23505' || (!error && !data)) return respond({ error: 'EDUCATION_CONFLICT' }, 409)
  if (error) return respond({ error: 'Could not save guide preferences.' }, 500)
  return respond(data)
})
