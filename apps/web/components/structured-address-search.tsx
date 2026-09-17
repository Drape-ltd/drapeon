'use client'

import { useEffect, useRef, useState } from 'react'
import { useFieldHelp } from '../features/account/tailor-onboarding/onboarding-field'
import type { OnboardingHelpKey } from '../features/account/tailor-onboarding/help-content'
import {
  parseAddressSearchSuggestion,
  type AddressSearchSuggestion,
  type StructuredAddressFields,
} from '@drape/shared/address'

type Props = {
  onSelect: (address: StructuredAddressFields & { displayValue: string; reference: string }) => void
  label?: string
  placeholder?: string
  value?: string
  allowManualFallback?: boolean
  className?: string
  helpKey?: OnboardingHelpKey
}

export function StructuredAddressSearch({
  value,
  ...props
}: Props) {
  return <StructuredAddressSearchInput key={value ?? ''} {...props} value={value} />
}

function StructuredAddressSearchInput({
  onSelect,
  label = 'Find address',
  placeholder = 'Search address, area, or landmark',
  value,
  allowManualFallback = true,
  className = 'md:col-span-2',
  helpKey,
}: Props) {
  const fieldHelp = useFieldHelp(label, helpKey)
  const [query, setQuery] = useState(value ?? '')
  const [hasEdited, setHasEdited] = useState(false)
  const [results, setResults] = useState<AddressSearchSuggestion[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  const [retryKey, setRetryKey] = useState(0)
  const sequence = useRef(0)

  useEffect(() => {
    const text = query.trim()
    if (!hasEdited || text.length < 5) {
      return
    }
    const request = ++sequence.current
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setState('loading')
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=5`, {
          headers: { 'Accept-Language': 'en' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Address lookup failed with ${response.status}`)
        const payload = await response.json() as unknown
        if (request !== sequence.current) return
        const next = Array.isArray(payload)
          ? payload.filter((item): item is AddressSearchSuggestion => !!item && typeof item === 'object' && typeof item.display_name === 'string')
          : []
        setResults(next)
        setState(next.length ? 'idle' : 'empty')
      } catch {
        if (controller.signal.aborted || request !== sequence.current) return
        setResults([])
        setState('error')
      }
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [hasEdited, query, retryKey])

  return (
    <div className={`grid gap-1.5 ${className}`}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={`${label}-address-input`} className="text-xs font-semibold text-ink">
          {label}
        </label>
        {fieldHelp.button}
      </div>
      {fieldHelp.panel}
      <label className="grid gap-1.5">
        <input
          id={`${label}-address-input`}
          value={query}
          onChange={(event) => {
            const next = event.target.value
            setHasEdited(true)
            sequence.current += 1
            setQuery(next)
            if (next.trim().length < 5) {
              setResults([])
              setState('idle')
            }
          }}
          placeholder={placeholder}
          autoComplete="street-address"
          className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
        />
      </label>
      {state === 'loading' ? <p role="status" className="text-xs text-ink/52">Searching addresses…</p> : null}
      {state === 'empty' ? <p role="status" className="text-xs text-ink/52">No exact match. Try a nearby landmark{allowManualFallback ? ', or enter it manually' : ''}.</p> : null}
      {state === 'error' ? (
        <p role="alert" className="text-xs text-ink/52">
          Suggestions are unavailable. {allowManualFallback ? 'Enter it manually or ' : ''}
          <button type="button" onClick={() => setRetryKey((key) => key + 1)} className="font-semibold text-needle underline">try again</button>.
        </p>
      ) : null}
      {results.length ? (
        <div className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm">
          {results.map((result, index) => (
            <button
              type="button"
              key={`${result.place_id ?? result.display_name ?? index}`}
              onClick={() => {
                const parsed = parseAddressSearchSuggestion(result)
                setQuery(parsed.displayValue)
                setHasEdited(false)
                setResults([])
                setState('idle')
                onSelect({ ...parsed, reference: String(result.place_id ?? result.display_name ?? '') })
              }}
              className="block w-full border-b border-ui-border px-3 py-2 text-left text-sm text-ink last:border-b-0 hover:bg-bone focus:bg-bone focus:outline-none"
            >
              {result.display_name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
