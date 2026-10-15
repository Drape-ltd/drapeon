import { PageHead } from '../../../../components/page-head'
import { WorkList } from '../../../../components/work-list'
import { loadCanonicalOpsData } from '../../../../lib/data'
import { buildOpsWorkItems, formatEnum } from '../../../../lib/work-items'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function QueuePage({ params, searchParams }: { params: Promise<{ queueKey: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ queueKey }, query] = await Promise.all([params, searchParams])
  if (!['all', 'support', 'trust', 'privacy', 'money', 'delivery', 'reliability', 'operations'].includes(queueKey)) notFound()
  const data = await loadCanonicalOpsData({ queuePage: { ...query, queue: queueKey === 'all' ? query.queue : queueKey } })
  const allItems = buildOpsWorkItems(data)
  const items = queueKey === 'all' ? allItems : allItems.filter((entry) => entry.queueKey === queueKey)
  const title = queueKey === 'all' ? 'All operational queues' : `${formatEnum(queueKey)} queue`

  return (
    <>
      <PageHead eyebrow="Work / Queues" title={title} description="Review cases, claim ownership, and open the related record to take action." />
      <WorkList items={items} query={query.q ?? ''} pageInfo={data.pageInfo} />
    </>
  )
}
