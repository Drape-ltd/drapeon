import { persistLegacyTailorContact } from './onboarding-phone.ts'

for (const [name, account, lookupError, write, expected, writes] of [
  ['empty tailor contact is saved', { role: 'TAILOR', phone: null }, null, { data: { phone: '+12025550134' }, error: null }, true, 1],
  ['legacy empty string is saved', { role: 'TAILOR', phone: '' }, null, { data: { phone: '+12025550134' }, error: null }, true, 1],
  ['existing contact is never replaced', { role: 'TAILOR', phone: '+12025550135' }, null, null, true, 0],
  ['customer contact is not changed', { role: 'CUSTOMER', phone: null }, null, null, true, 0],
  ['missing account fails closed', null, null, null, false, 0],
  ['lookup failure fails closed', null, { message: 'offline' }, null, false, 0],
  ['failed persistence cannot return success', { role: 'TAILOR', phone: null }, null, { data: null, error: null }, false, 1],
] as const) {
  Deno.test(`legacy phone: ${name}`, async () => {
    let writeCount = 0
    let updating = false
    const client: any = {
      from: () => client,
      select: () => client,
      eq: (_key: string, value: string) => { if (_key === 'id' && value !== 'caller-id') throw new Error('Wrong actor'); return client },
      is: () => client,
      update: (values: any) => { writeCount++; updating = true; if (values.phone_verified_at !== null) throw new Error('False ownership verification'); return client },
      maybeSingle: async () => updating ? write : ({ data: account, error: lookupError }),
    }
    if (await persistLegacyTailorContact(client, 'caller-id', '+12025550134') !== expected) throw new Error('Incorrect result')
    if (writeCount !== writes) throw new Error('Incorrect write scope')
  })
}
