import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MarketingTopicsPreview } from '../../components/marketing-topics-preview'

export const metadata: Metadata = {
  title: 'Marketing topics preview',
  robots: { index: false, follow: false },
}

export default function MarketingTopicsPreviewPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <MarketingTopicsPreview role="CUSTOMER" />
}
