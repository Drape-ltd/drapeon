import { notFound } from 'next/navigation'
import { LifecycleOrderPreview } from '../../../components/lifecycle-order-preview'

export const metadata = {
  title: 'Lifecycle order preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function LifecycleOrderPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <LifecycleOrderPreview />
}
