import { notFound } from 'next/navigation'
import { LifecycleWelcomePreview } from '../../../components/lifecycle-welcome-preview'

export const metadata = {
  title: 'Lifecycle welcome preview | Drapeon',
  robots: { index: false, follow: false },
}

export default function LifecycleWelcomePreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <LifecycleWelcomePreview />
}
