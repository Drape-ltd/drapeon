import { useCallback, useMemo, useState } from 'react'
import { Alert, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Feather } from '@expo/vector-icons'
import { useSavedTailors, useWishlistCollections } from '@/lib/queries'
import { invokeFunction } from '@/lib/supabase'
import { Colors, Radius } from '@/constants/theme'

type PendingTailor = { id: string; displayName: string }

/**
 * Card-level save. Hearting never files a tailor automatically: the customer always picks
 * an existing wishlist or names a new one, so a save says what it was for ("Birthday",
 * "December wedding") instead of landing in a generic default nobody chose.
 */
export function useSaveTailor(userId: string | undefined) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: savedTailors } = useSavedTailors(userId)
  const { data: collections } = useWishlistCollections(userId)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<PendingTailor | null>(null)
  const [newWishlistName, setNewWishlistName] = useState('')
  const [saving, setSaving] = useState(false)

  const savedTailorIds = useMemo(() => {
    const ids = new Set((savedTailors ?? []).map((entry) => entry.id))
    for (const [id, isSaved] of Object.entries(overrides)) {
      if (isSaved) ids.add(id)
      else ids.delete(id)
    }
    return ids
  }, [savedTailors, overrides])

  const refresh = useCallback(() => {
    if (!userId) return
    void queryClient.invalidateQueries({ queryKey: ['saved-tailors', userId] })
    void queryClient.invalidateQueries({ queryKey: ['wishlist-collections', userId] })
  }, [queryClient, userId])

  const toggleSaveTailor = useCallback((tailorId: string, displayName: string) => {
    if (!userId) {
      router.push('/(auth)/sign-in' as never)
      return
    }
    if (savedTailorIds.has(tailorId)) {
      setOverrides((current) => ({ ...current, [tailorId]: false }))
      void invokeFunction('saved-tailor-action', {
        body: { action: 'unsave-by-profile', tailorProfileId: tailorId },
      })
        .then(({ error }) => {
          if (error) throw error
          refresh()
        })
        .catch(() => {
          setOverrides((current) => ({ ...current, [tailorId]: true }))
          Alert.alert('Could not update saved', 'Please try again in a moment.')
        })
      return
    }
    setNewWishlistName('')
    setPending({ id: tailorId, displayName })
  }, [refresh, router, savedTailorIds, userId])

  const commitSave = useCallback(async (input: { collectionId?: string; collectionName?: string }) => {
    if (!pending || saving) return
    setSaving(true)
    try {
      const { error } = await invokeFunction('saved-tailor-action', {
        body: { action: 'save', tailorProfileId: pending.id, ...input },
      })
      if (error) throw error
      setOverrides((current) => ({ ...current, [pending.id]: true }))
      setPending(null)
      setNewWishlistName('')
      refresh()
    } catch {
      Alert.alert('Could not save', 'Please try again in a moment.')
    } finally {
      setSaving(false)
    }
  }, [pending, refresh, saving])

  return {
    savedTailorIds,
    toggleSaveTailor,
    picker: {
      visible: pending !== null,
      collections: (collections ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        itemCount: entry.itemCount,
      })),
      newWishlistName,
      saving,
      onChangeNewWishlistName: setNewWishlistName,
      onClose: () => setPending(null),
      onSelect: (collectionId: string) => void commitSave({ collectionId }),
      onCreate: () => {
        const name = newWishlistName.trim()
        if (name) void commitSave({ collectionName: name })
      },
    },
  }
}

export function HeartButton({
  saved,
  onPress,
  label,
}: {
  saved: boolean
  onPress: () => void
  label: string
}) {
  return (
    <TouchableOpacity
      style={[styles.heart, saved && styles.heartSaved]}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={saved ? `Remove ${label} from saved` : `Save ${label} to a wishlist`}
      accessibilityState={{ selected: saved }}
      activeOpacity={0.8}
    >
      <Feather name="heart" size={16} color={Colors.textInverse} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  heart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26,26,24,0.42)',
  },
  heartSaved: { backgroundColor: Colors.needleGreen },
})
