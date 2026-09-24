import { notFound } from 'next/navigation'
import { LifecycleFitPreview } from '../../../components/lifecycle-fit-preview'

export const metadata = {
  title: 'Lifecycle fit profile preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function LifecycleFitPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <LifecycleFitPreview />
}
