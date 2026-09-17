/**
 * Shared helpers for six-digit email challenge codes.
 *
 * Codes are never stored: only an HMAC of `${challengeId}:${userId}:${code}`
 * under a server-side pepper, compared in constant time.
 */

import { getServiceRoleKey } from './env.ts'

export const CHALLENGE_CODE_LENGTH = 6

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomChallengeCode() {
  const values = crypto.getRandomValues(new Uint32Array(1))
  return String((values[0] ?? 0) % 1_000_000).padStart(CHALLENGE_CODE_LENGTH, '0')
}

export function isChallengeCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/u.test(value.trim())
}

export async function challengeCodeHash(challengeId: string, userId: string, code: string) {
  const pepper = Deno.env.get('DEVICE_TRUST_PEPPER')?.trim() || getServiceRoleKey()
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${challengeId}:${userId}:${code}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export function maskEmailAddress(value: string) {
  const [local = '', domain = ''] = value.toLowerCase().split('@')
  // Cap the stars: a 16-character local part turned into a wall of asterisks
  // that was harder to recognise than the address it was hiding.
  const visible = local.slice(0, 2)
  const hidden = '*'.repeat(Math.min(4, Math.max(2, local.length - visible.length)))
  return `${visible}${hidden}@${domain}`
}
