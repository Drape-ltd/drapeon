'use client'

import { useState } from 'react'
import { BriefForm, type BriefRenderData } from '../../features/account/brief/brief-form'

const data: BriefRenderData = {
  userId: null, accountCurrency: 'NGN', customerProfile: null, measurementProfiles: [], existingOrder: null, warning: null,
  tailor: {
    id: '00000000-0000-4000-8000-000000000099', user_id: 'preview-tailor', display_name: 'Fulfillment preview tailor', business_name: null,
    location: 'Lagos', specialty_tags: [], currency: 'NGN', availability: 'OPEN', accepts_custom_orders_now: true,
    shop_paused: false, is_live: true, supports_custom_orders: true, pickup_available: false,
    delivery_available: true, shipping_available: true, portfolio_photo_urls: [], avatar_url: null,
  },
}
export function FulfillmentPreview() {
  const [originReady, setOriginReady] = useState(false)
  return <main className="mx-auto max-w-5xl p-4">
    <p className="mb-3 text-sm">Development-only visual fixture. No draft, order or notification is written.</p>
    <button className="mb-4 rounded border p-2" onClick={() => setOriginReady(value => !value)}>Toggle repaired origin</button>
    <BriefForm data={data} tailorId={data.tailor!.id} onRefresh={() => undefined} developmentFulfillmentPreview={{ originReady }} />
  </main>
}
