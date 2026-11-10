import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { presentCustomerRefundReceipt, type CustomerRefundReceipt } from '@drape/shared'
import { supabase } from '@/lib/supabase'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

export function CustomerRefundRecordCard({ orderId }: { orderId: string }) {
  const [records, setRecords] = useState<CustomerRefundReceipt[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.rpc('list_customer_order_refund_receipts', { p_order_id: orderId })
      .then(({ data, error }) => {
        if (!active) return
        // Production web/app can be ahead of its separately approved DB release.
        setFailed(Boolean(error && error.code !== 'PGRST202'))
        setRecords(error ? [] : (data ?? []) as CustomerRefundReceipt[])
      })
    return () => { active = false }
  }, [orderId])

  if (failed) return <Text style={styles.error}>Refund details could not load. Reopen this order to retry.</Text>
  if (records.length === 0) return null
  return (
    <View style={styles.card} accessibilityLabel="Refund records">
      <Text style={styles.heading}>Refund records</Text>
      {records.map((row) => {
        const receipt = presentCustomerRefundReceipt(row)
        return (
          <View key={row.refund_reference} style={styles.record}>
            <Text style={styles.status}>{receipt.status}</Text>
            <Text style={styles.amount}>{receipt.amount}</Text>
            <Text style={styles.detail}>{receipt.date} · {receipt.reference}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.white, borderColor: Colors.lightGrey, borderWidth: 1,
    borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  heading: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  record: { borderTopColor: Colors.lightGrey, borderTopWidth: 1, paddingTop: Spacing.sm, gap: 3 },
  status: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  amount: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  detail: { color: Colors.inkLight, fontSize: FontSize.xs },
  error: { color: Colors.inkLight, fontSize: FontSize.sm },
})
