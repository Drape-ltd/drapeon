import type { Metadata } from 'next'
import { ShopWorkspace } from '../../../features/account/shop/shop-workspace'
import { buildMetadata } from '../../../lib/metadata'

export const metadata: Metadata = buildMetadata({
  title: 'Your shop',
  description: 'Manage your ready-made pieces, drafts, and stock.',
  path: '/account/shop',
})

export default function AccountShopPage(): React.JSX.Element {
  return <ShopWorkspace />
}
