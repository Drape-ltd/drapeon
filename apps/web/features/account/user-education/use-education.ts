'use client'
import { useEffect, useState } from 'react'
import {
  EducationStore,
  educationKey,
  type EducationCloud,
  type EducationSnapshot,
} from '@drape/shared/education-state'
import { createClient } from '../../../lib/supabase'
const stores = new Map<string, EducationStore>()
const empty: EducationSnapshot = { data: {}, ready: false, syncing: false, pending: 0, error: '' }
export function useEducation() {
  const [owner, setOwner] = useState<string | undefined>()
  const [store, setStore] = useState<EducationStore | null>(null)
  const [state, setState] = useState(empty)
  useEffect(() => {
    // The public Guide remains useful offline and before Supabase is configured.
    let db: ReturnType<typeof createClient> | null = null
    try {
      db = createClient()
    } catch {
      // A signed-in session will be picked up after a configured deployment.
    }
    let active = true
    let stop: (() => void) | undefined
    const select = (id?: string) => {
      if (!active) return
      stop?.()
      setOwner(id)
      setState(empty)
      const key = educationKey(id)
      let next = stores.get(key)
      if (!next) {
        const client = db
        const cloud: EducationCloud | undefined = id && client
          ? async (body) => {
              const session = await client.auth.getSession()
              if (session.data.session?.user.id !== id) throw Error('Account changed')
              const { data, error } = await client.functions.invoke('education-action', { body })
              if (error) {
                if (error.context?.status === 409) throw Error('EDUCATION_CONFLICT')
                throw error
              }
              if (!data || data.error) throw Error(data?.error || 'Guide sync unavailable')
              return data
            }
          : undefined
        next = new EducationStore(
          key,
          {
            getItem: async (k) => localStorage.getItem(k),
            setItem: async (k, v) => localStorage.setItem(k, v),
          },
          cloud
        )
        stores.set(key, next)
      }
      const current = next
      setStore(current)
      setState(current.snapshot())
      stop = current.subscribe(() => setState(current.snapshot()))
      void current.initialize()
    }
    if (!db) {
      select()
      return () => {
        active = false
        stop?.()
      }
    }
    void db.auth
      .getSession()
      .then(({ data }) => select(data.session?.user.id))
      .catch(() => select())
    const { data: auth } = db.auth.onAuthStateChange((_event, session) => select(session?.user.id))
    return () => {
      active = false
      stop?.()
      auth.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    const retry = () => {
      void store?.sync()
    }
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    return () => {
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
    }
  }, [store])
  return { state, store, owner }
}
