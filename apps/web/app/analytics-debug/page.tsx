import { notFound } from 'next/navigation'
import { AnalyticsDebugPanel } from './panel'

export default function AnalyticsDebugPage(): React.JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <AnalyticsDebugPanel />
}
