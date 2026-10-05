import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { EducationStore, educationKey, type EducationCloud } from '@drape/shared/education-state'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
const stores = new Map<string, EducationStore>()
export function useEducation() {
  const { user } = useAuth(),
    owner = user?.id
  const store = useMemo(() => {
    const key = educationKey(owner)
    let current = stores.get(key)
    if (!current) {
      const cloud: EducationCloud | undefined = owner
        ? async (body) => {
            const session = await supabase.auth.getSession()
            if (session.data.session?.user.id !== owner) throw Error('Account changed')
            const { data, error } = await supabase.functions.invoke('education-action', { body })
            if (error) {
              if (error.context?.status === 409) throw Error('EDUCATION_CONFLICT')
              throw error
            }
            if (!data || data.error) throw Error(data?.error || 'Guide sync unavailable')
            return data
          }
        : undefined
      current = new EducationStore(key, AsyncStorage, cloud)
      stores.set(key, current)
    }
    return current
  }, [owner])
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  useEffect(() => {
    void store.initialize()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void store.sync()
    })
    return () => {
      sub.remove()
    }
  }, [store])
  return { store, state, owner }
}
