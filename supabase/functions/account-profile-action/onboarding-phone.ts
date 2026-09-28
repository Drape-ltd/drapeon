/** Only fills an empty canonical contact. Never replaces an existing number. */
export async function persistInitialPhone(
  client: any,
  userId: string,
  previousPhone: string | null,
  phone: string,
  verifiedAt: string | null = null,
): Promise<boolean> {
  if (previousPhone !== null && previousPhone.trim() !== '') return false
  let update = client.from('users')
    .update({ phone, phone_verified_at: verifiedAt, updated_at: new Date().toISOString() }).eq('id', userId)
  update = previousPhone === null ? update.is('phone', null) : update.eq('phone', previousPhone)
  const { data, error } = await update.select('phone').maybeSingle()
  return !error && data?.phone === phone
}

/** Legacy clients treat a bypass receipt as setup success. Confirm the initial
 * tailor contact first, without replacing any contact or claiming OTP ownership.
 * The caller must validate format and availability before invoking this helper.
 */
export async function persistLegacyTailorContact(client: any, userId: string, phone: string): Promise<boolean> {
  const { data: account, error } = await client.from('users')
    .select('role, phone').eq('id', userId).maybeSingle()
  if (error || !account) return false
  if (account.role !== 'TAILOR' || (typeof account.phone === 'string' && account.phone.trim())) return true
  return persistInitialPhone(client, userId, account.phone, phone)
}
