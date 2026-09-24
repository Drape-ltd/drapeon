'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StructuredAddressSearch } from '../../../components/structured-address-search'
import { friendlyActionError } from '@drape/shared/action-errors'
import { normalizePhoneForStorage, formatMoney, validatePhoneForProfile } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import type { AccountBenefitReservation, ItemDetailRenderData, ReadyMadeCheckoutPricingPreview, SellerItem } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList } from '../shared/account-data-queries'
import { hasReadyMadeSizeGuide, normalizeWebReadyMadeSizeGuide, readyMadeFitFieldLabel } from '@drape/shared/ready-made-size-guide-editor'
import { ActionNotice, assertNoContactLeak } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { Field } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { NativeSelect } from '../../../components/ui/native-select'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Switch } from '../../../components/ui/switch'
import { readyMadeInventoryCount } from '../shop/account-shop-surface'

export function sizeGuideSummary(
  sizeGuide: Record<string, unknown> | null | undefined,
  sizes: string[] = []
) {
  const guide = normalizeWebReadyMadeSizeGuide(
    sizeGuide,
    sizes.length > 0
      ? sizes
      : Object.keys((sizeGuide?.sizeRanges as Record<string, unknown> | undefined) ?? {})
  )
  if (!hasReadyMadeSizeGuide(guide, sizes))
    return 'Fit guidance is not available for this item yet.'
  const fields = guide.fields
    .slice(0, 4)
    .map((field) => readyMadeFitFieldLabel(field).toLowerCase())
  const sizeCount = Object.keys(guide.sizeRanges).length
  const fieldCopy = fields.length > 0 ? fields.join(', ') : 'saved measurements'
  return `Fit ranges saved for ${fieldCopy} across ${sizeCount} size${sizeCount === 1 ? '' : 's'}.`
}

function readyMadeSizeInventoryMap(item: SellerItem) {
  const sizes = stringList(item.sizes)
  const rawInventory =
    item.size_inventory &&
    typeof item.size_inventory === 'object' &&
    !Array.isArray(item.size_inventory)
      ? item.size_inventory
      : {}
  const fallbackInventoryQuantity =
    typeof item.inventory_quantity === 'number' && Number.isFinite(item.inventory_quantity)
      ? Math.max(0, Math.floor(item.inventory_quantity))
      : 0
  let assignedUnits = 0
  const nextInventory = Object.fromEntries(
    sizes.map((entry) => {
      const rawValue = rawInventory[entry]
      const parsedValue =
        typeof rawValue === 'number'
          ? Math.floor(rawValue)
          : Number.parseInt(typeof rawValue === 'string' ? rawValue : '', 10)
      const quantity = Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0
      assignedUnits += quantity
      return [entry, quantity]
    })
  )

  if (assignedUnits === 0 && fallbackInventoryQuantity > 0 && sizes[0]) {
    nextInventory[sizes[0]] = fallbackInventoryQuantity
  }

  return nextInventory
}

function readyMadeQuantityForSize(item: SellerItem, requestedSize: string | null | undefined) {
  const size = requestedSize?.trim()
  if (!size) return readyMadeInventoryCount(item)
  return Math.max(0, Math.floor(readyMadeSizeInventoryMap(item)[size] ?? 0))
}

type WebBenefitReservation = Pick<
  AccountBenefitReservation,
  'id' | 'total_benefit_amount' | 'customer_due_amount' | 'currency' | 'expires_at'
>

type WebBenefitGrant = {
  id: string
  reason: string
  remaining_amount: number | null
  currency: string | null
}

export function CommercialBenefitControl({
  orderId,
  compact = false,
  initialCode = '',
  onChanged,
  onMutation,
}: {
  orderId: string
  compact?: boolean
  initialCode?: string
  onChanged?: (reservation: WebBenefitReservation | null) => void
  onMutation?: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const onChangedRef = useRef(onChanged)
  const [code, setCode] = useState(() => initialCode.trim().toUpperCase())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [active, setActive] = useState<WebBenefitReservation | null>(null)
  const [grants, setGrants] = useState<WebBenefitGrant[]>([])
  const mutationInFlightRef = useRef(false)

  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  const refresh = useCallback(async () => {
    const { data: row } = await supabase
      .from('commercial_benefit_reservations')
      .select('id,total_benefit_amount,customer_due_amount,currency,expires_at')
      .eq('order_id', orderId)
      .eq('status', 'RESERVED')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const next = (row ?? null) as WebBenefitReservation | null
    setActive(next)
    onChangedRef.current?.(next)
    return next
  }, [orderId, supabase])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refresh()
      void invokeAccountFunction<{ grants?: WebBenefitGrant[] }>('commercial-benefit-action', {
        action: 'list',
      })
        .then((result) => setGrants(result.grants ?? []))
        .catch(() => setGrants([]))
    }, 0)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(refreshWhenVisible, 60_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refresh])

  async function reserve(source: { code?: string; grantId?: string }) {
    if (mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('commercial-benefit-action', {
        action: 'reserve',
        orderId,
        ...source,
        idempotencyKey: `web:benefit:${orderId}:${source.code ?? source.grantId}:${Date.now()}`,
      })
      setCode('')
      await refresh()
      setSuccess('Applied. Your payment total has been updated.')
      onMutation?.()
    } catch (cause) {
      setError(friendlyActionError(cause, 'This promotion could not be applied.'))
    } finally {
      mutationInFlightRef.current = false
      setBusy(false)
    }
  }

  async function release() {
    if (!active || mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('commercial-benefit-action', {
        action: 'release',
        reservationId: active.id,
      })
      await refresh()
      setSuccess('Promotion removed. Your payment total has been restored.')
      onMutation?.()
    } catch (cause) {
      setError(friendlyActionError(cause, 'This promotion could not be removed.'))
    } finally {
      mutationInFlightRef.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className={`grid gap-3 ${compact ? 'rounded-[8px] border border-ink/8 bg-bone/55 p-4' : ''}`}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-needle">
          Promotion or Drapeon credit
        </p>
        <p className="mt-1 text-sm text-ink/58">Add it before payment.</p>
      </div>
      <ActionNotice error={error} success={success} />
      {active ? (
        <div className="grid gap-3 rounded-[8px] border border-needle/14 bg-needle/7 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <strong className="text-lg text-ink">
                {formatMoney(active.total_benefit_amount, active.currency)} covered
              </strong>
              <p className="mt-1 text-sm text-ink/62">
                {active.customer_due_amount === 0
                  ? 'No payment is due.'
                  : `${formatMoney(active.customer_due_amount, active.currency)} remains to pay.`}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void release()
              }}
              className="rounded-full border border-ink/12 bg-white px-4 py-2 text-sm font-semibold"
            >
              {busy ? 'Updating…' : 'Remove'}
            </button>
          </div>
          <p className="text-xs leading-5 text-ink/48">
            The tailor still receives the full protected seller amount.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Promotion code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="Promotion code"
            />
            <Button
              disabled={busy || code.trim().length < 3}
              onClick={() => {
                void reserve({ code: code.trim() })
              }}
            >
              {busy ? 'Applying…' : 'Apply'}
            </Button>
          </div>
          {grants.map((grant) => (
            <button
              type="button"
              key={grant.id}
              disabled={busy}
              onClick={() => {
                void reserve({ grantId: grant.id })
              }}
              className="flex items-center justify-between rounded-[8px] border border-ink/10 bg-white p-4 text-left"
            >
              <span>
                <strong className="block text-ink">{grant.reason}</strong>
                <span className="mt-1 block text-sm text-ink/58">Available to this account</span>
              </span>
              <span className="font-semibold text-needle">
                {grant.remaining_amount != null && grant.currency != null
                  ? formatMoney(grant.remaining_amount, grant.currency)
                  : 'Apply'}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

export function ReadyMadeCheckoutForm({
  item,
  data,
  onRefresh,
}: {
  item: SellerItem
  data: Pick<ItemDetailRenderData, 'userId'>
  onRefresh: () => void
}) {
  const sizes = stringList(item.sizes)
  const [size, setSize] = useState(sizes[0] ?? '')
  const [quantity, setQuantity] = useState('1')
  const [fulfillment, setFulfillment] = useState(
    item.pickup_available
      ? 'PICKUP'
      : item.delivery_available
        ? 'DELIVERY'
        : item.shipping_available
          ? 'SHIPPING'
          : 'SHIPPING'
  )
  const [pickupBlocked, setPickupBlocked] = useState(false)
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [ack, setAck] = useState(false)
  const [fitAck, setFitAck] = useState(false)
  const [addressVerificationSource, setAddressVerificationSource] = useState<string | null>(null)
  const [addressVerificationReference, setAddressVerificationReference] = useState<string | null>(
    null
  )
  const [addressVerifiedAt, setAddressVerifiedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingPreview, setPricingPreview] = useState<ReadyMadeCheckoutPricingPreview | null>(null)
  const [pricingKey, setPricingKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(null)
  const [checkoutBenefit, setCheckoutBenefit] = useState<WebBenefitReservation | null>(null)
  const [promotionCode, setPromotionCode] = useState('')
  const selectedSizeInventory = readyMadeQuantityForSize(item, size || null)
  const maxCheckoutQuantity =
    sizes.length > 0 && size
      ? Math.min(3, selectedSizeInventory)
      : Math.min(3, readyMadeInventoryCount(item))
  const parsedQty = Number.parseInt(quantity, 10)
  const quantityInvalid =
    quantity.trim() !== '' &&
    (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > maxCheckoutQuantity)
  const hasFulfillmentOption = Boolean(
    (item.pickup_available && !pickupBlocked) || item.delivery_available || item.shipping_available
  )
  const needsAddress = fulfillment !== 'PICKUP'
  const fallbackFulfillment =
    fulfillment === 'PICKUP'
      ? item.delivery_available
        ? 'DELIVERY'
        : item.shipping_available
          ? 'SHIPPING'
          : null
      : null
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        itemId: item.id,
        size: size || '',
        quantity,
        fulfillment,
        address: needsAddress ? address.trim() : '',
        city: needsAddress ? city.trim() : '',
        region: needsAddress ? region.trim() : '',
        postalCode: needsAddress ? postalCode.trim() : '',
        countryCode: needsAddress ? countryCode.trim().toUpperCase() : '',
      }),
    [
      address,
      city,
      countryCode,
      fulfillment,
      item.id,
      needsAddress,
      postalCode,
      quantity,
      region,
      size,
    ]
  )
  const previewIsFresh = Boolean(pricingPreview && pricingKey === previewKey)

  function markAddressManuallyConfirmed() {
    setAddressVerificationSource('CUSTOMER_CONFIRMED_STRUCTURED')
    setAddressVerificationReference(null)
    setAddressVerifiedAt(new Date().toISOString())
  }

  function validateCheckoutInput() {
    setError(null)
    setSuccess(null)
    if (!hasFulfillmentOption) {
      setError(
        'This item is not ready for checkout yet. Ask the seller to finish fulfillment setup.'
      )
      return null
    }
    const leak = assertNoContactLeak(
      [address, city, region, recipientName].join('\n'),
      "Checkout delivery details can't include off-platform contact details."
    )
    if (leak) {
      setError(leak)
      return null
    }
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 3) {
      setError('Choose a quantity between 1 and 3.')
      return null
    }
    if (sizes.length > 0 && !size.trim()) {
      setError('Choose a size before checkout.')
      return null
    }
    if (sizes.length > 0 && selectedSizeInventory <= 0) {
      setError(`Size ${size} is sold out right now. Choose another size before continuing.`)
      return null
    }
    const maxQuantity = Math.min(3, selectedSizeInventory)
    if (maxQuantity < 1) {
      setError('This item just sold out. Please choose another piece.')
      return null
    }
    if (parsedQuantity > maxQuantity) {
      setError(
        `For now, you can check out up to ${maxQuantity} unit${maxQuantity === 1 ? '' : 's'} for this item.`
      )
      return null
    }
    if (
      needsAddress &&
      (!address.trim() || !city.trim() || !region.trim() || !countryCode.trim())
    ) {
      setError(
        'Add the full delivery address before continuing. Street, city, region, and country are required.'
      )
      return null
    }
    if (needsAddress && !recipientName.trim()) {
      setError('Enter the recipient name before continuing.')
      return null
    }
    const normalizedRecipientPhone = normalizePhoneForStorage(recipientPhone)
    const recipientPhoneError = needsAddress
      ? validatePhoneForProfile(normalizedRecipientPhone)
      : null
    if (needsAddress && recipientPhoneError) {
      setError(recipientPhoneError)
      return null
    }
    return parsedQuantity
  }

  function handlePickupSetupFallback(message: string) {
    if (!/pickup details|finished pickup details/iu.test(message)) {
      return false
    }
    setPickupBlocked(true)
    if (fallbackFulfillment) {
      setFulfillment(fallbackFulfillment)
    }
    setPricingPreview(null)
    setPricingKey('')
    setSuccess(null)
    setError(
      fallbackFulfillment
        ? `Pickup is not ready for this seller yet. Checkout has been switched to ${fallbackFulfillment.toLowerCase()}. Add recipient details and preview tax again.`
        : 'Pickup is not ready for this seller yet. Ask the seller to finish pickup setup before checkout.'
    )
    return true
  }

  async function previewCheckout() {
    const parsedQuantity = validateCheckoutInput()
    if (!parsedQuantity) return

    setPricingBusy(true)
    try {
      const result = await invokeAccountFunction<{ pricing?: ReadyMadeCheckoutPricingPreview }>(
        'ready-made-order-action',
        {
          action: 'preview-checkout',
          sellerItemId: item.id,
          size: size || undefined,
          quantity: parsedQuantity,
          fulfillment,
          address: needsAddress ? address.trim() : undefined,
          city: needsAddress ? city.trim() : undefined,
          region: needsAddress ? region.trim() : undefined,
          postalCode: needsAddress ? postalCode.trim() : undefined,
          countryCode: needsAddress ? countryCode.trim().toUpperCase() : undefined,
          addressVerificationSource: needsAddress
            ? (addressVerificationSource ?? undefined)
            : undefined,
          addressVerificationReference: needsAddress
            ? (addressVerificationReference ?? undefined)
            : undefined,
          addressVerifiedAt: needsAddress ? (addressVerifiedAt ?? undefined) : undefined,
        }
      )
      setPricingPreview(result.pricing ?? null)
      setPricingKey(previewKey)
      setSuccess('Tax and total are ready for review.')
    } catch (previewError) {
      setPricingPreview(null)
      setPricingKey('')
      const message = friendlyActionError(
        previewError,
        'We could not calculate tax and totals for this checkout right now.'
      )
      if (!handlePickupSetupFallback(message)) {
        setError(message)
      }
    } finally {
      setPricingBusy(false)
    }
  }

  async function startCheckout() {
    const parsedQuantity = validateCheckoutInput()
    if (!parsedQuantity) return
    if (!fitAck) {
      setError('Review the fit guidance and confirm your selected size before payment.')
      return
    }
    if (!previewIsFresh) {
      setError('Review the latest tax and total before creating checkout.')
      return
    }
    if (!ack) {
      setError('Acknowledge the cancellation policy before checkout.')
      return
    }
    setBusy(true)
    try {
      const result = await invokeAccountFunction<{ orderId?: string }>('ready-made-order-action', {
        action: 'create-checkout',
        sellerItemId: item.id,
        size: size || undefined,
        quantity: parsedQuantity,
        fulfillment,
        address: needsAddress ? address.trim() : undefined,
        city: needsAddress ? city.trim() : undefined,
        region: needsAddress ? region.trim() : undefined,
        postalCode: needsAddress ? postalCode.trim() : undefined,
        countryCode: needsAddress ? countryCode.trim().toUpperCase() : undefined,
        addressVerificationSource: needsAddress
          ? (addressVerificationSource ?? undefined)
          : undefined,
        addressVerificationReference: needsAddress
          ? (addressVerificationReference ?? undefined)
          : undefined,
        addressVerifiedAt: needsAddress ? (addressVerifiedAt ?? undefined) : undefined,
        recipientName: needsAddress ? recipientName.trim() : undefined,
        recipientPhone: needsAddress ? normalizePhoneForStorage(recipientPhone) : undefined,
        cancellationPolicyAcknowledged: true,
        fitGuidanceAcknowledged: true,
      })
      onRefresh()
      if (result.orderId) {
        setCheckoutOrderId(result.orderId)
        const normalizedCode = promotionCode.trim().toUpperCase()
        if (normalizedCode) {
          try {
            await invokeAccountFunction('commercial-benefit-action', {
              action: 'reserve',
              orderId: result.orderId,
              code: normalizedCode,
              idempotencyKey: `web:ready-made:${result.orderId}:promotion:${normalizedCode}`,
            })
            const supabase = createClient()
            const { data: reservation } = await supabase
              .from('commercial_benefit_reservations')
              .select('id,total_benefit_amount,customer_due_amount,currency,expires_at')
              .eq('order_id', result.orderId)
              .eq('status', 'RESERVED')
              .gt('expires_at', new Date().toISOString())
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            setCheckoutBenefit((reservation ?? null) as WebBenefitReservation | null)
            setPromotionCode('')
            setSuccess(
              'Stock is held and the discount is applied. Review the new total before payment.'
            )
          } catch (promotionError) {
            setError(
              friendlyActionError(
                promotionError,
                'Stock is held, but this discount code could not be applied. Check it below and try again.'
              )
            )
            setSuccess('Stock is held. Review the discount and total before payment.')
          }
        } else {
          setSuccess('Stock is held. Add a promotion or continue to secure payment.')
        }
        return
      }
      setSuccess('Checkout order created. Open Orders to continue payment.')
    } catch (checkoutError) {
      const message = friendlyActionError(
        checkoutError,
        'Ready-made checkout could not start. Refresh and try again.'
      )
      if (!handlePickupSetupFallback(message)) {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function continuePreparedCheckout() {
    if (!checkoutOrderId) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: row } = await supabase
        .from('commercial_benefit_reservations')
        .select('id,total_benefit_amount,customer_due_amount,currency,expires_at')
        .eq('order_id', checkoutOrderId)
        .eq('status', 'RESERVED')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const current = (row ?? null) as WebBenefitReservation | null
      if (checkoutBenefit && !current) {
        setCheckoutBenefit(null)
        setError(
          'That promotion expired before payment opened. Your total has been restored; review it and continue again.'
        )
        return
      }
      window.location.assign(`/account/checkout/${checkoutOrderId}`)
    } finally {
      setBusy(false)
    }
  }

  if (checkoutOrderId && pricingPreview) {
    const amountDue = checkoutBenefit?.customer_due_amount ?? pricingPreview.totalAmount
    return (
      <Surface id="ready-made-checkout" className="scroll-mt-28 overflow-hidden">
        <SurfaceHeader
          eyebrow="Payment review"
          title="Stock held for checkout"
          description="Apply a promotion before opening secure payment. Inventory stays reserved on this order while payment is pending."
        />
        <div className="grid gap-4 p-5">
          <ActionNotice error={error} success={success} />
          <div className="grid gap-2 rounded-[8px] border border-ink/8 bg-white p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-ink/58">Item subtotal</span>
              <span className="font-semibold text-ink">
                {formatMoney(pricingPreview.subtotalAmount, pricingPreview.currency)}
              </span>
            </div>
            {pricingPreview.shippingAmount > 0 ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">Drapeon fulfillment</span>
                <span className="font-semibold text-ink">
                  {formatMoney(pricingPreview.shippingAmount, pricingPreview.currency)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <span className="text-ink/58">{pricingPreview.taxLabel || 'Tax'}</span>
              <span className="font-semibold text-ink">
                {formatMoney(pricingPreview.taxAmount, pricingPreview.currency)}
              </span>
            </div>
            {checkoutBenefit ? (
              <div className="flex items-center justify-between gap-4 text-needle">
                <span>Promotion</span>
                <span className="font-semibold">
                  −{formatMoney(checkoutBenefit.total_benefit_amount, checkoutBenefit.currency)}
                </span>
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-4 border-t border-ink/8 pt-3">
              <span className="font-semibold text-ink">Pay now</span>
              <span className="text-xl font-semibold text-needle">
                {formatMoney(amountDue, pricingPreview.currency)}
              </span>
            </div>
          </div>
          <CommercialBenefitControl
            orderId={checkoutOrderId}
            compact
            initialCode={promotionCode}
            onChanged={setCheckoutBenefit}
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => window.location.assign(`/account/orders/${checkoutOrderId}`)}
            >
              View saved order
            </Button>
            <Button
              onClick={() => {
                void continuePreparedCheckout()
              }}
              disabled={busy}
            >
              {busy
                ? 'Checking total…'
                : amountDue === 0
                  ? 'Complete covered order'
                  : 'Continue securely'}
            </Button>
          </div>
        </div>
      </Surface>
    )
  }

  return (
    <Surface id="ready-made-checkout" className="scroll-mt-28 overflow-hidden">
      <SurfaceHeader
        eyebrow="Checkout"
        title="Start ready-made checkout"
        description="Confirm size, fulfillment, recipient details, tax, and total before payment starts."
      />
      <div className="grid gap-4 p-5">
        <ActionNotice error={error} success={success} />
        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="Size"
            hint={
              sizes.length > 0 && size
                ? `${selectedSizeInventory} left in ${size}`
                : `${readyMadeInventoryCount(item)} ready now`
            }
          >
            <NativeSelect
              value={size}
              onChange={(event) => {
                setSize(event.target.value)
                setFitAck(false)
              }}
            >
              {sizes.length === 0 ? (
                <option value="">One size</option>
              ) : (
                sizes.map((entry) => {
                  const remaining = readyMadeQuantityForSize(item, entry)
                  return (
                    <option key={entry} value={entry} disabled={remaining <= 0}>
                      {remaining <= 0 ? `${entry} · sold out` : entry}
                    </option>
                  )
                })
              )}
            </NativeSelect>
          </Field>
          <Field
            label="Quantity"
            error={quantityInvalid ? `Enter 1–${maxCheckoutQuantity}` : undefined}
            hint={!quantityInvalid ? `Max ${maxCheckoutQuantity}` : undefined}
          >
            <Input
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={
                quantityInvalid ? 'border-rust/60 focus:border-rust focus:ring-rust/10' : undefined
              }
            />
          </Field>
          <Field label="Fulfillment">
            <NativeSelect
              value={fulfillment}
              onChange={(event) => setFulfillment(event.target.value)}
            >
              {item.pickup_available ? (
                <option value="PICKUP" disabled={pickupBlocked}>
                  {pickupBlocked ? 'Pickup not ready' : 'Pickup'}
                </option>
              ) : null}
              {item.delivery_available ? <option value="DELIVERY">Delivery</option> : null}
              {item.shipping_available ? <option value="SHIPPING">Shipping</option> : null}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-3 rounded-[8px] border border-ui-border bg-white p-4">
          <div>
            <p className="text-sm font-semibold text-ink">Confirm the fit</p>
            <p className="mt-1 text-sm leading-6 text-ink/62">
              {sizes.length > 0
                ? sizeGuideSummary(item.size_guide, sizes)
                : 'Review the listing measurements and fit notes for this one-size item.'}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-[8px] bg-bone/70 px-4 py-3 text-sm leading-6 text-ink/72">
            <span>
              I reviewed the fit guidance and confirm {size || 'this one-size fit'} is the size I
              want.
            </span>
            <Switch
              checked={fitAck}
              onCheckedChange={setFitAck}
              aria-label="Confirm ready-made fit review"
            />
          </div>
        </div>
        {fulfillment === 'PICKUP' ? (
          <p className="text-sm leading-6 text-ink/58">
            Exact pickup details are shared only after the seller marks the order ready for
            collection.
          </p>
        ) : null}
        {needsAddress ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Recipient name"
            />
            <PhoneNumberField
              value={recipientPhone}
              onValueChange={setRecipientPhone}
              placeholder="Recipient phone for courier only"
            />
            <StructuredAddressSearch
              onSelect={(selected) => {
                setAddress(selected.line1)
                setCity(selected.city)
                setRegion(selected.stateRegion)
                setPostalCode(selected.postcode)
                setCountryCode((selected.countryCode || selected.country).toUpperCase())
                setAddressVerificationSource('NOMINATIM')
                setAddressVerificationReference(selected.reference)
                setAddressVerifiedAt(new Date().toISOString())
              }}
            />
            <Input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
                markAddressManuallyConfirmed()
              }}
              placeholder="Address"
              className="md:col-span-2"
            />
            <Input
              value={city}
              onChange={(event) => {
                setCity(event.target.value)
                markAddressManuallyConfirmed()
              }}
              placeholder="City"
            />
            <Input
              value={region}
              onChange={(event) => {
                setRegion(event.target.value)
                markAddressManuallyConfirmed()
              }}
              placeholder="Region/state"
            />
            <Input
              value={postalCode}
              onChange={(event) => {
                setPostalCode(event.target.value)
                markAddressManuallyConfirmed()
              }}
              placeholder="Postal code"
            />
            <Input
              value={countryCode}
              onChange={(event) => {
                setCountryCode(event.target.value.toUpperCase())
                markAddressManuallyConfirmed()
              }}
              placeholder="Country code"
              maxLength={2}
            />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4 rounded-[8px] border border-ui-border bg-ui-muted/45 px-4 py-3 text-sm leading-6 text-ink/70">
          <span>I understand cancellation and handoff reviews stay inside Drapeon.</span>
          <Switch
            checked={ack}
            onCheckedChange={setAck}
            aria-label="Acknowledge cancellation policy"
          />
        </div>
        <div className="rounded-[8px] border border-ink/8 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">
            Tax and total
          </p>
          {pricingPreview ? (
            <div className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">Item subtotal</span>
                <span className="font-semibold text-ink">
                  {formatMoney(pricingPreview.subtotalAmount, pricingPreview.currency)}
                </span>
              </div>
              {pricingPreview.shippingAmount > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-ink/58">Drapeon fulfillment</span>
                  <span className="font-semibold text-ink">
                    {formatMoney(pricingPreview.shippingAmount, pricingPreview.currency)}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <span className="text-ink/58">
                  {pricingPreview.taxFallback ? 'Estimated tax' : pricingPreview.taxLabel || 'Tax'}
                </span>
                <span className="font-semibold text-ink">
                  {formatMoney(pricingPreview.taxAmount, pricingPreview.currency)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 border-t border-ink/8 pt-3">
                <span className="font-semibold text-ink">Total</span>
                <span className="text-lg font-semibold text-needle">
                  {formatMoney(pricingPreview.totalAmount, pricingPreview.currency)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 border-t border-ink/8 pt-3">
                <label
                  htmlFor={`ready-made-promotion-${item.id}`}
                  className="text-sm font-semibold text-ink"
                >
                  Discount code
                </label>
                <Input
                  id={`ready-made-promotion-${item.id}`}
                  value={promotionCode}
                  onChange={(event) => setPromotionCode(event.target.value.toUpperCase())}
                  placeholder="Enter code (optional)"
                  autoComplete="off"
                />
                <p className="text-xs leading-5 text-ink/52">
                  We apply it after stock is held and show the new total before secure payment
                  opens. Available Drapeon credits appear there too.
                </p>
              </div>
              {pricingPreview.taxFallback ? (
                <p className="text-xs leading-5 text-rust">
                  Tax is estimated because live tax lookup was unavailable for this address.
                </p>
              ) : null}
              {!previewIsFresh ? (
                <p className="text-xs leading-5 text-rust">
                  Checkout details changed. Refresh the tax preview before creating checkout.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink/62">
              Calculate the checkout preview to see locked tax and total before payment starts.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="secondary"
            onClick={() => {
              void previewCheckout()
            }}
            disabled={pricingBusy || busy || !data.userId || !hasFulfillmentOption}
          >
            {pricingBusy ? 'Calculating...' : 'Preview tax and total'}
          </Button>
          <Button
            onClick={startCheckout}
            disabled={
              busy ||
              pricingBusy ||
              !data.userId ||
              !hasFulfillmentOption ||
              !previewIsFresh ||
              !fitAck ||
              !ack
            }
          >
            {busy ? 'Holding stock…' : 'Review payment'}
          </Button>
        </div>
      </div>
    </Surface>
  )
}
