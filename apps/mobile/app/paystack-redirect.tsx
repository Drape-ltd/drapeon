import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'

import { Button } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { confirmOrderPayment } from '@/lib/payments'
import { qk } from '@/lib/queries'
import { queryClient } from '@/lib/queryClient'
import { resetTo } from '@/lib/navigation'
import { Sentry } from '@/lib/sentry'
import { supabase } from '@/lib/supabase'

type ConfirmState = 'checking' | 'confirmed' | 'pending' | 'failed' | 'invalid'

const ORDER_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function extractOrderId(reference: string) {
  return reference.match(ORDER_ID_PATTERN)?.[0] ?? null
}

function isProcessingMessage(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('still processing') || normalized.includes('pull to refresh') ||
    normalized.includes('payment is processing') || normalized.includes('do not pay again') ||
    normalized.includes('signed payment confirmation')
}

export default function PaymentRedirectScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ reference?: string | string[]; trxref?: string | string[]; checkout_id?: string | string[]; status?: string | string[] }>()
  const reference = useMemo(() => {
    return firstParam(params.reference) || firstParam(params.trxref)
  }, [params.reference, params.trxref])
  const checkoutId = useMemo(() => firstParam(params.checkout_id), [params.checkout_id])
  const status = firstParam(params.status)
  const orderIdFromReference = useMemo(() => (reference ? extractOrderId(reference) : null), [reference])
  const [state, setState] = useState<ConfirmState>('checking')
  const [message, setMessage] = useState('Confirming your payment with Drapeon.')
  const [attempt, setAttempt] = useState(0)
  const [resolvedOrderId, setResolvedOrderId] = useState<string | null>(null)
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    async function confirmReturn() {
      const providerReference = reference || checkoutId
      let orderId = orderIdFromReference
      if (!orderId && checkoutId && /^chk_[A-Za-z0-9_-]{1,196}$/u.test(checkoutId)) {
        const { data } = await supabase
          .from('orders')
          .select('id')
          .eq('payment_intent_id', checkoutId)
          .maybeSingle()
        orderId = data?.id ?? null
      }
      setResolvedOrderId(orderId)
      if (!providerReference || !orderId) {
        Sentry.captureMessage('Payment return missing order reference', {
          level: 'warning',
          extra: { reference, checkoutId, status },
        })
        setState('invalid')
        setMessage('We could not match this payment return to an order. Open your orders and pull to refresh.')
        return
      }

      Sentry.addBreadcrumb({
        category: 'payment',
        level: 'info',
        message: 'Payment redirect confirmation started',
        data: { orderId, reference: providerReference, status },
      })

      const result = await confirmOrderPayment(orderId, providerReference)
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.customerOrder(result.orderId) }),
          queryClient.invalidateQueries({ queryKey: ['customer-orders'] }),
        ])
        setState('confirmed')
        setMessage('Payment confirmed. Opening your order now.')
        setTimeout(() => {
          resetTo(router, {
            pathname: '/(customer)/orders/[id]',
            params: { id: result.orderId, paymentReturn: '1' },
          } as never)
        }, 650)
        return
      }

      Sentry.captureMessage('Payment redirect confirmation did not complete', {
        level: isProcessingMessage(result.message) ? 'info' : 'warning',
        extra: { orderId, reference: providerReference, status, reason: result.reason, stage: result.stage, message: result.message },
      })
      setState(isProcessingMessage(result.message) ? 'pending' : 'failed')
      setMessage(result.message)
    }

    void confirmReturn()
  }, [attempt, checkoutId, orderIdFromReference, reference, router, status])

  const iconName = state === 'confirmed' ? 'check-circle' : state === 'checking' ? 'credit-card' : 'alert-circle'
  const iconColor = state === 'confirmed' ? Colors.success : state === 'checking' ? Colors.needleGreen : Colors.warning
  const returnedReference = reference || checkoutId
  const title =
    state === 'checking'
      ? 'Confirming payment'
      : state === 'confirmed'
        ? 'Payment confirmed'
        : state === 'pending'
          ? 'Payment confirmation pending'
          : 'Payment needs a refresh'

  function openOrder() {
    const orderId = resolvedOrderId ?? orderIdFromReference
    if (orderId) {
      resetTo(router, {
        pathname: '/(customer)/orders/[id]',
        params: { id: orderId, paymentReturn: '1' },
      } as never)
    } else {
      resetTo(router, '/(customer)/orders')
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <View style={[styles.iconWrap, { borderColor: iconColor }]}>
          {state === 'checking' ? (
            <ActivityIndicator color={Colors.needleGreen} />
          ) : (
            <Feather name={iconName} size={28} color={iconColor} />
          )}
        </View>
        <Text style={styles.eyebrow}>Secure payment</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>{message}</Text>
        {returnedReference ? (
          <Text style={styles.reference}>
            {checkoutId && !reference ? 'Checkout ID' : 'Reference'}: {returnedReference}
          </Text>
        ) : null}

        {state !== 'checking' && state !== 'confirmed' ? (
          <View style={styles.actions}>
            <Button label={resolvedOrderId || orderIdFromReference ? 'Open order' : 'Open orders'} onPress={openOrder} />
            <Button
              label="Try confirmation again"
              variant="secondary"
              onPress={() => {
                hasRun.current = false
                setState('checking')
                setMessage('Confirming your payment with Drapeon.')
                setAttempt((current) => current + 1)
              }}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bone,
    padding: Spacing.xl,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  eyebrow: {
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  copy: {
    color: Colors.inkLight,
    fontSize: FontSize.md,
    lineHeight: 22,
    textAlign: 'center',
  },
  reference: {
    color: Colors.midGrey,
    fontSize: FontSize.xs,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
})
