import type { ReactNode } from 'react'
import { RequestBoundaryLayout } from '../../components/request-boundary-layout'

export const dynamic = 'force-dynamic'

export default RequestBoundaryLayout as ({ children }: { children: ReactNode }) => Promise<ReactNode>
