'use client'

import { useState } from 'react'
import { MARKETING_TOPIC_KEYS, canUseMarketingTopic, getMarketingTopic, type MarketingTopicKey } from '@drape/shared/marketing-topics'
import { MarketingShell } from './marketing-shell'
import { Switch } from './ui/switch'

type Props = {
  role?: 'CUSTOMER' | 'TAILOR'
}

const CHANNELS = [
  { key: 'EMAIL' as const, label: 'Email' },
  { key: 'PUSH' as const, label: 'Device' },
]

export function MarketingTopicsPreview({ role = 'CUSTOMER' }: Props): React.JSX.Element {
  const [choices, setChoices] = useState<Record<string, boolean>>({})
  const topics = MARKETING_TOPIC_KEYS.filter((topicKey) => CHANNELS.some(({ key }) => canUseMarketingTopic(topicKey, role, key)))
  const storiesEnabled = choices['DRAPEON_STORIES:EMAIL'] === true

  function toggle(topicKey: MarketingTopicKey, channel: 'EMAIL' | 'PUSH', enabled: boolean) {
    setChoices((current) => ({ ...current, [`${topicKey}:${channel}`]: enabled }))
  }

  return (
    <MarketingShell
      eyebrow="Development preview"
      title="Choose the stories you want."
      description="Optional marketing topics stay separate from account and order messages. Production records each channel choice only after explicit consent."
    >
      <div className="mx-auto max-w-4xl py-8">
        <div className="rounded-[20px] border border-ui-border bg-white p-5 shadow-[0_12px_34px_rgba(39,52,45,0.06)] sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ui-border pb-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-drape-green">Marketing topics</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">Optional, specific, and easy to change.</h2>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Role: {role.toLowerCase()}</p>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {topics.map((topicKey) => {
              const topic = getMarketingTopic(topicKey)
              return (
                <div key={topicKey} data-testid={`marketing-topic-${topicKey.toLowerCase()}`} className="rounded-[14px] border border-ui-border bg-bone/35 p-4">
                  <p className="text-sm font-semibold text-ink">{topic.label}</p>
                  <p className="mt-1 text-xs leading-5 text-ink/55">{topic.description}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {CHANNELS.filter(({ key }) => topic.channels.includes(key)).map(({ key, label }) => {
                      const choiceKey = `${topicKey}:${key}`
                      return (
                        <div key={key} className="flex min-h-11 items-center justify-between gap-2 rounded-[9px] bg-white px-3">
                          <span className="text-xs font-semibold text-ink">{label}</span>
                          <Switch
                            checked={choices[choiceKey] ?? false}
                            onCheckedChange={(enabled) => toggle(topicKey, key, enabled)}
                            aria-label={`${topic.label}: ${label}`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mt-5 rounded-[10px] bg-ui-muted px-3 py-2 text-xs leading-5 text-ink/55">
            Preview behavior is local only. In production, enabling a topic first records the channel-level marketing consent, then persists the topic choice in Drapeon’s control plane.
          </p>

          <div className="mt-4 rounded-[14px] border border-dashed border-drape-green/35 bg-drape-green/5 p-4" data-testid="marketing-campaign-binding-preview">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-drape-green">Campaign snapshot</p>
                <p className="mt-1 text-sm font-semibold text-ink">Drapeon stories · Email</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-drape-green">{storiesEnabled ? 'Eligible' : 'Skipped'}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink/55">
              {storiesEnabled ? 'The topic choice is captured with the recipient snapshot before a provider send is queued.' : 'No topic choice means no optional email channel is queued; the campaign remains auditable without enrolling the user.'}
            </p>
            <p className="mt-2 text-[11px] font-semibold text-ink/45">Provider alias: drapeon-stories · no email is sent from this preview.</p>
          </div>
        </div>
      </div>
    </MarketingShell>
  )
}
