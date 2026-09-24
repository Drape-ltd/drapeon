'use client'

import Link from 'next/link'
import { useState } from 'react'

import { AccountContextProvider } from '../../components/account-context'
import {
  AccountAuthRequiredState,
  AccountRouteLoadingState,
} from './shared/account-route-states'
import { RenderMessages } from './messages/account-messages-surface'
import { CustomerOrderActions, TailorOrderActions } from './orders/account-order-actions'
import { MaterialAdvancePanel } from './orders/material-advance-panel'
import { AccountDrapeonDispatchCard } from './orders/account-dispatch-card'
import { RenderOrderDetail } from './orders/account-order-detail-surface'
import {
  RenderCheckout,
  RenderOrders,
  RenderWork,
} from './orders/account-order-list-surfaces'
import {
  RenderSettings,
  RenderSupport,
} from './settings/account-settings-support-surfaces'
import {
  RenderExplore,
  RenderItemDetail,
  RenderSaved,
  RenderTailorDetail,
} from './marketplace/account-marketplace-surfaces'
import {
  CommercialAdjustmentPanel,
  OpsRefundStatusPanel,
  OrderReviewPanel,
  OrderTipPanel,
  ReturnResolutionPanel,
} from './orders/order-resolution-panels'
import { ReadyMadeCheckoutForm } from './checkout/ready-made-checkout-form'
import { RenderEarnings, RenderPayout } from './payouts/account-payout-surfaces'
import { IdentityHandoffCard } from './profile/identity-handoff-card'
import { PortfolioManager } from './profile/portfolio-manager'
import { TailorSellingSetupEditor } from './profile/tailor-selling-setup-editor'
import { RenderProfile } from './profile/account-profile-surface'
import { RenderShop } from './shop/account-shop-surface'
import {
  previewCustomerOrderData,
  previewEarningsData,
  previewDispatchState,
  previewMessagesData,
  previewMaterialAdvanceData,
  previewOrder,
  previewPayoutData,
  previewPortfolioData,
  previewSellingSetupData,
  previewShopData,
  previewTailorOrderData,
  previewRejectedIdentityProfile,
  previewVerifiedIdentityProfile,
} from './preview/account-preview-fixtures'

export type AccountPreviewState =
  | 'auth-required'
  | 'loading'
  | 'messages'
  | 'tailor-order'
  | 'customer-order'
  | 'payout'
  | 'earnings'
  | 'shop'
  | 'identity-approved'
  | 'identity-rejected'
  | 'portfolio'
  | 'selling-setup'
  | 'material-advance'
  | 'dispatch'
  | 'ready-made-checkout'
  | 'profile-overview'
  | 'order-resolution'
  | 'order-detail'
  | 'marketplace-surfaces'
  | 'order-list-surfaces'
  | 'settings-support'

export function AccountPreviewHarness({
  initialState = 'auth-required',
}: {
  initialState?: AccountPreviewState
}): React.JSX.Element {
  const [state, setState] = useState<AccountPreviewState>(initialState)

  return (
    <div className="min-h-screen bg-ui-canvas">
      <nav
        aria-label="Account preview controls"
        className="sticky top-0 z-50 flex flex-wrap items-center gap-2 border-b border-ui-border bg-white/95 px-4 py-3 backdrop-blur"
      >
        <strong className="mr-2 text-sm text-ink">Account preview</strong>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'auth-required'}
          onClick={() => setState('auth-required')}
        >
          Signed out
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'loading'}
          onClick={() => setState('loading')}
        >
          Loading
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'messages'}
          onClick={() => setState('messages')}
        >
          Messages
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'tailor-order'}
          onClick={() => setState('tailor-order')}
        >
          Tailor order
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'customer-order'}
          onClick={() => setState('customer-order')}
        >
          Customer order
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'payout'}
          onClick={() => setState('payout')}
        >
          Payout
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'earnings'}
          onClick={() => setState('earnings')}
        >
          Earnings
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'shop'}
          onClick={() => setState('shop')}
        >
          Shop
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'identity-approved'}
          onClick={() => setState('identity-approved')}
        >
          Trust approved
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'identity-rejected'}
          onClick={() => setState('identity-rejected')}
        >
          Trust rejected
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'portfolio'}
          onClick={() => setState('portfolio')}
        >
          Portfolio
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'selling-setup'}
          onClick={() => setState('selling-setup')}
        >
          Selling setup
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'material-advance'}
          onClick={() => setState('material-advance')}
        >
          Material advance
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'dispatch'}
          onClick={() => setState('dispatch')}
        >
          Dispatch
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'ready-made-checkout'}
          onClick={() => setState('ready-made-checkout')}
        >
          Ready-made checkout
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'profile-overview'}
          onClick={() => setState('profile-overview')}
        >
          Profile overview
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'order-resolution'}
          onClick={() => setState('order-resolution')}
        >
          Order resolution
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'order-detail'}
          onClick={() => setState('order-detail')}
        >
          Order detail
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'marketplace-surfaces'}
          onClick={() => setState('marketplace-surfaces')}
        >
          Marketplace surfaces
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'order-list-surfaces'}
          onClick={() => setState('order-list-surfaces')}
        >
          Order lists
        </button>
        <button
          type="button"
          className="rounded-full border border-ui-border px-3 py-1.5 text-sm text-ink"
          aria-pressed={state === 'settings-support'}
          onClick={() => setState('settings-support')}
        >
          Settings and support
        </button>
        <Link className="ml-auto text-sm font-semibold text-needle" href="/account/orders">
          Live route
        </Link>
      </nav>

      {state === 'loading' ? (
        <AccountRouteLoadingState />
      ) : state === 'messages' ? (
        <main className="mx-auto w-full max-w-[96rem] p-4 md:p-6">
          <AccountContextProvider
            value={{
              userId: 'preview-customer',
              role: 'CUSTOMER',
              defaultCurrency: 'NGN',
              customerProfile: {
                userId: 'preview-customer',
                displayName: 'Amara Okafor',
                avatarUrl: null,
              },
              tailorProfile: null,
            }}
          >
            <RenderMessages data={previewMessagesData} onRefresh={() => undefined} />
          </AccountContextProvider>
        </main>
      ) : state === 'tailor-order' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <section className="rounded-[12px] border border-ui-border bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">
              Tailor order preview
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{previewOrder.reference}</h1>
            <TailorOrderActions
              order={previewOrder}
              data={previewTailorOrderData}
              onRefresh={() => undefined}
            />
          </section>
        </main>
      ) : state === 'customer-order' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <section className="rounded-[12px] border border-ui-border bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">
              Customer order preview
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{previewOrder.reference}</h1>
            <CustomerOrderActions
              order={previewOrder}
              data={previewCustomerOrderData}
              onRefresh={() => undefined}
            />
          </section>
        </main>
      ) : state === 'payout' ? (
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <RenderPayout data={previewPayoutData} onRefresh={() => undefined} />
        </main>
      ) : state === 'earnings' ? (
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <RenderEarnings data={previewEarningsData} />
        </main>
      ) : state === 'shop' ? (
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <RenderShop data={previewShopData} onRefresh={() => undefined} />
        </main>
      ) : state === 'identity-approved' ? (
        <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
          <IdentityHandoffCard
            userId={null}
            profile={previewVerifiedIdentityProfile}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'identity-rejected' ? (
        <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
          <IdentityHandoffCard
            userId={null}
            profile={previewRejectedIdentityProfile}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'portfolio' ? (
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <PortfolioManager data={previewPortfolioData} onRefresh={() => undefined} />
        </main>
      ) : state === 'selling-setup' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <TailorSellingSetupEditor
            data={previewSellingSetupData}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'material-advance' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <MaterialAdvancePanel
            order={previewOrder}
            data={previewMaterialAdvanceData}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'dispatch' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <AccountDrapeonDispatchCard
            order={previewOrder}
            viewerRole="CUSTOMER"
            previewState={previewDispatchState}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'ready-made-checkout' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <ReadyMadeCheckoutForm
            item={previewShopData.sellerItems[0]!}
            data={{ userId: 'preview-customer' }}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'profile-overview' ? (
        <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <RenderProfile
            data={{ ...previewPortfolioData, userId: null }}
            session={null}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'order-resolution' ? (
        <main className="mx-auto grid w-full max-w-5xl gap-5 p-4 md:p-6">
          <section className="rounded-[12px] border border-ui-border bg-white p-4 shadow-sm md:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">
              Delivered order preview
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{previewOrder.reference}</h1>
          </section>
          <ReturnResolutionPanel
            order={{ ...previewOrder, stage: 'DELIVERED' }}
            data={previewCustomerOrderData}
            onRefresh={() => undefined}
          />
          <OpsRefundStatusPanel
            order={{ ...previewOrder, stage: 'DELIVERED' }}
            data={previewCustomerOrderData}
            previewResolution={{
              id: 'preview-refund-resolution',
              amount: 25000,
              currency: 'NGN',
              status: 'PROCESSING',
              order_outcome: 'CONTINUE_ORDER',
              resume_stage: 'DELIVERED',
              failure_summary: null,
            }}
          />
          <CommercialAdjustmentPanel
            order={{ ...previewOrder, stage: 'DELIVERED' }}
            data={previewCustomerOrderData}
            onRefresh={() => undefined}
          />
          <OrderReviewPanel
            order={{ ...previewOrder, stage: 'DELIVERED' }}
            data={previewCustomerOrderData}
            onRefresh={() => undefined}
          />
          <OrderTipPanel
            order={{ ...previewOrder, stage: 'DELIVERED' }}
            data={previewCustomerOrderData}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'order-detail' ? (
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <AccountContextProvider
            value={{
              userId: 'preview-customer',
              role: 'CUSTOMER',
              defaultCurrency: 'NGN',
              customerProfile: {
                userId: 'preview-customer',
                displayName: 'Amara Okafor',
                avatarUrl: null,
              },
              tailorProfile: null,
            }}
          >
            <RenderOrderDetail data={previewCustomerOrderData} onRefresh={() => undefined} />
          </AccountContextProvider>
        </main>
      ) : state === 'marketplace-surfaces' ? (
        <main className="mx-auto grid min-w-0 w-full max-w-6xl gap-10 p-4 md:p-6">
          <AccountContextProvider
            value={{
              userId: 'preview-customer',
              role: 'CUSTOMER',
              defaultCurrency: 'NGN',
              customerProfile: {
                userId: 'preview-customer',
                displayName: 'Amara Okafor',
                avatarUrl: null,
              },
              tailorProfile: null,
            }}
          >
            <RenderExplore
              data={{
                userId: 'preview-customer',
                accountCurrency: 'NGN',
                exploreTailors: previewPortfolioData.tailorProfile
                  ? [previewPortfolioData.tailorProfile]
                  : [],
                exploreItems: previewShopData.sellerItems,
                warning: null,
              }}
            />
            <RenderSaved
              data={{
                wishlistCollections: [],
                wishlistItems: [],
                savedTailors: previewPortfolioData.tailorProfile
                  ? [previewPortfolioData.tailorProfile]
                  : [],
                savedItems: previewShopData.sellerItems,
                warning: null,
              }}
            />
            <RenderTailorDetail
              data={{
                tailor: previewPortfolioData.tailorProfile,
                readyMade: previewShopData.sellerItems,
                tailorReviews: [],
                isSaved: true,
                warning: null,
              }}
              onRefresh={() => undefined}
            />
            <RenderItemDetail
              data={{
                item: previewShopData.sellerItems[0] ?? null,
                userId: 'preview-customer',
                tailorProfile: null,
                warning: null,
              }}
              onRefresh={() => undefined}
            />
          </AccountContextProvider>
        </main>
      ) : state === 'order-list-surfaces' ? (
        <main className="mx-auto grid min-w-0 w-full max-w-6xl gap-10 p-4 md:p-6">
          <RenderOrders
            data={{
              userId: 'preview-customer',
              tailorProfile: null,
              orders: [previewOrder],
              payments: [],
              messages: [],
              consultationAttendanceReviews: [],
              warning: null,
            }}
          />
          <RenderWork
            data={{
              userId: 'preview-tailor-user',
              tailorProfile: previewPortfolioData.tailorProfile,
              orders: [previewOrder],
              payments: [],
              sellerItems: previewShopData.sellerItems,
              warning: null,
            }}
            onRefresh={() => undefined}
          />
          <RenderCheckout
            data={{
              userId: 'preview-customer',
              orders: [{ ...previewOrder, stage: 'PAYMENT_PENDING' }],
              payments: [],
              receipts: [],
              quotes: [],
              warning: null,
            }}
            orderId={previewOrder.id}
            onRefresh={() => undefined}
          />
        </main>
      ) : state === 'settings-support' ? (
        <main className="mx-auto grid min-w-0 w-full max-w-5xl gap-10 p-4 md:p-6">
          <RenderSettings
            data={{
              userId: 'preview-customer',
              accountCurrency: 'NGN',
              customerProfile: previewCustomerOrderData.customerProfile,
              tailorProfile: null,
              orderCurrencies: ['NGN'],
              warning: null,
            }}
            session={null}
            onRefresh={() => undefined}
          />
          <RenderSupport
            data={{
              userId: 'preview-customer',
              tailorProfile: null,
              orders: [previewOrder],
              warning: null,
            }}
            onRefresh={() => undefined}
          />
        </main>
      ) : (
        <AccountAuthRequiredState pathname="/account/orders" />
      )}
    </div>
  )
}
