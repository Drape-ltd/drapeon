'use client'

import { useEffect, useState } from 'react'
import { presentCustomerRefundReceipt, type CustomerRefundReceipt } from '@drape/shared'
import { createClient } from '../../../lib/supabase'

export function CustomerRefundRecords({ orderId }: { orderId: string }) {
  const [records, setRecords] = useState<CustomerRefundReceipt[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void createClient().rpc('list_customer_order_refund_receipts', { p_order_id: orderId })
      .then(({ data, error }) => {
        if (!active) return
        setFailed(Boolean(error))
        setRecords(error ? [] : (data ?? []) as CustomerRefundReceipt[])
      })
    return () => { active = false }
  }, [orderId])

  if (failed) return <p className="text-sm text-ink/65">Refund details could not load. Refresh this order to retry.</p>
  if (records.length === 0) return null
  return (
    <section aria-label="Refund records" className="w-full rounded-[8px] border border-ink/10 bg-white p-4">
      <h3 className="text-base font-semibold text-ink">Refund records</h3>
      <div className="mt-3 grid gap-3">
        {records.map((row) => {
          const receipt = presentCustomerRefundReceipt(row)
          return (
            <div key={row.refund_reference} className="border-t border-ink/10 pt-3">
              <p className="text-sm font-semibold text-needle">{receipt.status}</p>
              <p className="text-lg font-semibold text-ink">{receipt.amount}</p>
              <p className="text-xs text-ink/60">{receipt.date} · {receipt.reference}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
