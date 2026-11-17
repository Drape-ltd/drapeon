import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { getClientIp, rateLimit } from '../_shared/rateLimit.ts'
import { audit } from '../_shared/logger.ts'

const FN = 'tailor-claim-action'
const tokenPattern = /^[A-Za-z0-9_-]{40,60}$/u
const encoder = new TextEncoder()

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64url(new Uint8Array(digest))
}

Deno.serve(async (request) => {
  const cors = getCorsHeaders(request)
  const json = (body: unknown, status = 200, retryAfter?: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    })

  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ actionable: false }, 405)

  const raw = await request.text()
  if (raw.length > 2_000) return json({ actionable: false }, 400)

  let body: { action?: unknown; token?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ actionable: false }, 400)
  }
  if (body.action !== 'RESOLVE' || typeof body.token !== 'string' || !tokenPattern.test(body.token))
    return json({ actionable: false })

  const client = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ip = getClientIp(request)
  const hash = await tokenHash(body.token)
  const ipLimit = await rateLimit(client, ip, `${FN}:resolve:ip`, 30, 10 * 60_000, { ip })
  if (!ipLimit.allowed) return json({ actionable: false }, 429, ipLimit.retryAfter)
  const tokenLimit = await rateLimit(client, hash, `${FN}:resolve:token`, 20, 10 * 60_000, { ip })
  if (!tokenLimit.allowed) return json({ actionable: false }, 429, tokenLimit.retryAfter)

  const { data, error } = await client
    .rpc('resolve_tailor_claim_preview', { p_token_hash: hash })
    .maybeSingle()
  if (error || !data) return json({ actionable: false })

  const resolution = data as { invite_id: string; opened_now: boolean }
  if (resolution.opened_now) {
    await audit(client, {
      event: 'tailor_claim.app_link_opened',
      actor_role: 'SYSTEM',
      severity: 'info',
      payload: { invite_id: resolution.invite_id },
    })
  }
  return json({ actionable: true })
})
