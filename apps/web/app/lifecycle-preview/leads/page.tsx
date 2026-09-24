import { notFound } from 'next/navigation'
import { LifecycleLeadPreview } from '../../../components/lifecycle-lead-preview'

export const metadata = {
  title: 'Lifecycle lead preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function LifecycleLeadPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <LifecycleLeadPreview />
}
