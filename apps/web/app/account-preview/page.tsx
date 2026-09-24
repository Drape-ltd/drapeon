import { notFound } from 'next/navigation'

import {
  AccountPreviewHarness,
  type AccountPreviewState,
} from '../../features/account/account-preview-harness'

export const metadata = {
  title: 'Account preview | Drapeon',
  robots: { index: false, follow: false },
}

export default async function AccountPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}): Promise<React.JSX.Element> {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { state } = await searchParams
  const initialState: AccountPreviewState =
    state === 'loading' ||
    state === 'messages' ||
    state === 'tailor-order' ||
    state === 'customer-order' ||
    state === 'payout' ||
    state === 'earnings' ||
    state === 'shop' ||
    state === 'identity-approved' ||
    state === 'identity-rejected'
    || state === 'portfolio'
    || state === 'selling-setup'
    || state === 'material-advance'
    || state === 'dispatch'
    || state === 'ready-made-checkout'
    || state === 'profile-overview'
    || state === 'order-resolution'
    || state === 'order-detail'
    || state === 'marketplace-surfaces'
    || state === 'order-list-surfaces'
    || state === 'settings-support'
      ? state
      : 'auth-required'
  return <AccountPreviewHarness initialState={initialState} />
}
