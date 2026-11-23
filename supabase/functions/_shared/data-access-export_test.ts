import { buildCustomerExportPackage, buildTailorExportPackage } from './data-access-export.ts'

function database(orderRows = 0) {
  const selected: Array<{ table: string; columns: string }> = []
  return {
    selected,
    from(table: string) {
      let start = 0
      const query = {
        select(columns: string) {
          selected.push({ table, columns })
          if (table === 'reviews' && columns.split(',').map((part) => part.trim()).includes('content')) {
            throw new Error('column reviews.content does not exist')
          }
          return query
        },
        eq() { return query },
        order() { return query },
        limit() { return query },
        range(offset: number) { start = offset; return query },
        maybeSingle() { return Promise.resolve({ data: { id: 'owned-profile' }, error: null }) },
        then(resolve: (value: unknown) => void) {
          const count = table === 'orders' ? Math.max(0, Math.min(500, orderRows - start)) : 0
          resolve({ data: Array.from({ length: count }, (_, index) => ({ id: `order-${start + index}` })), error: null })
        },
      }
      return query
    },
  }
}

Deno.test('tailor export includes reviews using the deployed reviews schema', async () => {
  const client = database()
  const result = await buildTailorExportPackage(client, 'owner', 'profile')
  if (result.generationWarnings.length !== 0) throw new Error('Export must not silently omit reviews')
  const reviews = client.selected.find((entry) => entry.table === 'reviews')
  if (!reviews || !reviews.columns.includes('body') || reviews.columns.includes('content')) {
    throw new Error('Review selection does not match Production schema')
  }
})

Deno.test('customer export is owner-scoped and includes order history', async () => {
  const client = database(501)
  const result = await buildCustomerExportPackage(client, 'owner')
  if (result.scope !== 'ACCOUNT_ACCESS' || result.generationWarnings.length !== 0) {
    throw new Error('Customer account export failed')
  }
  if (!client.selected.some((entry) => entry.table === 'customer_profiles')
    || !client.selected.some((entry) => entry.table === 'users')
    || !client.selected.some((entry) => entry.table === 'orders')) {
    throw new Error('Customer account or order history was omitted')
  }
  if (result.sections.orderHistory.length !== 501) throw new Error('The second page of orders was omitted')
})
