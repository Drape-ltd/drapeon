import { notFound } from 'next/navigation'
import { FulfillmentRoleHandoff } from '../../../features/account/account-route-runtime'

export default function FulfillmentRolePreview() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <FulfillmentRoleHandoff />
}
