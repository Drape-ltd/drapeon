import { createClient } from './supabase'

/**
 * Reads the current tailor's private profile projection through the
 * auth.uid()-scoped database RPC. Do not replace this with a direct
 * `tailor_profiles` select: authenticated customers can read live rows under
 * the public catalogue policy.
 */
export async function fetchOwnTailorAccountProfile<T>() {
  const { data, error } = await createClient().rpc('get_my_tailor_account_profile')
  return { data: (data ?? null) as T | null, error }
}
