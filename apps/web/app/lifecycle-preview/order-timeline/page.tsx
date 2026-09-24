import { notFound } from 'next/navigation'
import { OrderLifecyclePreview } from '../../../components/order-lifecycle-preview'

export const metadata = {
  title: 'Order lifecycle preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function OrderLifecyclePreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <OrderLifecyclePreview />
}
