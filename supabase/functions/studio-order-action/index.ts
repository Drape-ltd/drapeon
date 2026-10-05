import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { rejectIfBlockedContact } from '../_shared/contact-bypass.ts'
import { queueMediaSafetyReview } from '../_shared/media-safety.ts'
import { audit, log } from '../_shared/logger.ts'
import { sendPushToUser } from '../_shared/notify.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { parseLook, type Look } from '../../../packages/drape-studio/src/studio-state.ts'
import { fabricTargetFingerprint } from '../../../packages/drape-studio/src/studio-sheet.ts'

const FN = 'studio-order-action'
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
const MAX_DESIGN_BYTES = 1_000_000
const MAX_IMAGE_CHARS = 9_000_000
const BodySchema = z.object({
  action: z.literal('revise'),
  orderId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  design: z.unknown(),
  sheetImage: z.string().max(MAX_IMAGE_CHARS),
  note: z.string().trim().min(5).max(500),
})

function response(cors: HeadersInit, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function decodePng(value: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return null
  try {
    const binary = atob(match[1])
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    if (bytes.length < 8 || bytes.length > 6_750_000) return null
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    return signature.every((byte, index) => bytes[index] === byte) ? bytes : null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return response(cors, { error: 'Method not allowed.' }, 405)
  const caller = await getAuthUser(req)
  if (!caller) return response(cors, { error: 'Sign in again to continue.' }, 401)
  const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return response(cors, { error: parsed.error }, 400)
  const body = parsed.data
  let design: Look
  try {
    if (new TextEncoder().encode(JSON.stringify(body.design)).byteLength > MAX_DESIGN_BYTES) throw Error('Too large')
    design = parseLook(body.design)
  } catch {
    return response(cors, { code: 'STUDIO_DESIGN_INVALID', error: 'The Studio design is invalid or too large.' }, 400)
  }
  const image = decodePng(body.sheetImage)
  if (!image) return response(cors, { code: 'STUDIO_SHEET_INVALID', error: 'The Studio sheet must be a PNG image.' }, 400)

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey())
  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id, customer_id, tailor_id, order_kind, stage')
    .eq('id', body.orderId).maybeSingle()
  if (orderError) return response(cors, { error: 'Could not check this order.' }, 500)
  if (!order || order.customer_id?.toString() !== caller.id || order.order_kind !== 'CUSTOM') {
    return response(cors, { error: 'This custom order is unavailable.' }, 404)
  }
  if (!['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING'].includes(order.stage)) {
    return response(cors, { code: 'STUDIO_REVISION_CLOSED', error: 'Design revisions need a tailor discussion after cutting begins.' }, 409)
  }
  const { data: latest, error: latestError } = await supabase.from('order_studio_design_versions')
    .select('version, design').eq('order_id', body.orderId)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  if (latestError) return response(cors, { error: 'Could not check the current Studio version.' }, 500)
  if (!latest || latest.version !== body.expectedVersion) {
    return response(cors, { code: 'STUDIO_VERSION_CHANGED', error: 'The design changed. Reopen the latest version before saving.' }, 409)
  }

  const userText = [design.name, design.notes, ...Object.values(design.directions), ...Object.values(design.colourNames), body.note].join('\n')
  const blocked = await rejectIfBlockedContact({
    supabase, fn: FN, cors, actorId: caller.id, actorRole: 'CUSTOMER',
    surface: 'studio_order_revision', text: userText,
    message: "Contact details can't be included in a Studio revision.", orderId: body.orderId,
  })
  if (blocked) return blocked

  const path = `studio/${body.orderId}/version-${body.expectedVersion + 1}-${crypto.randomUUID()}.png`
  const { error: uploadError } = await supabase.storage.from('order-photos').upload(path, image, {
    contentType: 'image/png', cacheControl: '3600', upsert: false,
  })
  if (uploadError) return response(cors, { error: 'Could not upload the Studio sheet. Try again.' }, 500)
  const { data: publicFile } = supabase.storage.from('order-photos').getPublicUrl(path)
  const sheetPhotoUrl = publicFile.publicUrl

  const previous = parseLook(latest.design)
  const colourChanged = fabricTargetFingerprint(previous) !== fabricTargetFingerprint(design)
  const { data: version, error: revisionError } = await supabase.rpc('append_order_studio_revision', {
    p_order_id: body.orderId,
    p_expected_version: body.expectedVersion,
    p_actor_id: caller.id,
    p_design: design,
    p_sheet_photo_url: sheetPhotoUrl,
    p_note: body.note,
    p_colour_changed: colourChanged,
  })
  if (revisionError) {
    await supabase.storage.from('order-photos').remove([path])
    const conflict = revisionError.message.includes('changed') || revisionError.message.includes('pre-cutting')
    return response(cors, {
      code: conflict ? 'STUDIO_VERSION_CHANGED' : 'STUDIO_REVISION_FAILED',
      error: conflict ? revisionError.message : 'Could not save this Studio revision. Try again.',
    }, conflict ? 409 : 500)
  }

  await queueMediaSafetyReview(supabase, {
    fn: FN, actorId: caller.id, actorRole: 'CUSTOMER', surface: 'studio_order_revision',
    publicUrls: [sheetPhotoUrl], purpose: 'ORDER_REFERENCE', orderId: body.orderId,
    relatedEntityType: 'order', relatedEntityId: body.orderId,
    metadata: { studioVersion: version },
  })
  await audit(supabase, {
    event: 'studio.design_revised', actor_id: caller.id, actor_role: 'CUSTOMER', order_id: body.orderId,
    payload: { version, colour_changed: colourChanged },
  })
  if (order.tailor_id) {
    EdgeRuntime.waitUntil(sendPushToUser(supabase, order.tailor_id.toString(), {
      title: 'Studio design updated',
      body: `Your customer sent version ${version} of their design. Review the new sheet and confirm the details before cutting.`,
      preferenceKey: 'orderUpdates',
      data: { orderId: body.orderId, type: 'studio_design_revision', requiredRole: 'TAILOR' },
      communication: {
        category: 'ORDER',
        purpose: 'TRANSACTIONAL',
        severity: 'NOTICE',
        destinationKey: 'ORDER_DETAIL',
        destinationParams: { orderId: body.orderId, requiredRole: 'TAILOR' },
        deduplicationKey: `studio-revision:${body.orderId}:v${version}`,
      },
    }))
  }
  log('info', FN, 'studio.revised', { actor_id: caller.id, order_id: body.orderId, version })
  return response(cors, { ok: true, version, sheetPhotoUrl, colourTargetsChanged: colourChanged })
})
