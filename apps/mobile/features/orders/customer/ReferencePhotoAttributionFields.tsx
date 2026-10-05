import { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import {
  CUSTOM_ORDER_STYLE_ATTRIBUTES,
  REFERENCE_PHOTO_MAX_ATTRIBUTES,
  REFERENCE_PHOTO_NOTE_MAX_CHARS,
  sanitizeReferencePhotoAttributions,
} from '@drape/shared'
import { Button } from '../../../components/ui/Button'
import { BottomSheetScaffold } from '../../../components/ui/BottomSheetScaffold'
import { RemoteImage } from '../../../components/ui/RemoteImage'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '../../../constants/theme'

export type ReferencePhotoAttributionDraft = { attributes: string[]; note: string }
export type ReferencePhotoAttributionDrafts = Record<string, ReferencePhotoAttributionDraft>
const EMPTY_DRAFT: ReferencePhotoAttributionDraft = { attributes: [], note: '' }

/** Sequential uploads join URI-keyed instructions to their uploaded photo URLs. */
export function referencePhotoAttributionPayload(
  uploadedUrls: string[],
  localUris: string[],
  drafts: ReferencePhotoAttributionDrafts,
) {
  return sanitizeReferencePhotoAttributions(
    uploadedUrls.map((photo, index) => ({ photo, ...(drafts[localUris[index] ?? ''] ?? EMPTY_DRAFT) })),
    uploadedUrls,
  )
}

export function ReferencePhotoAttributionFields({ photos, value, onChange }: {
  photos: string[]
  value: ReferencePhotoAttributionDrafts
  onChange: (next: ReferencePhotoAttributionDrafts) => void
}) {
  const [editingUri, setEditingUri] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReferencePhotoAttributionDraft>(EMPTY_DRAFT)
  const editingIndex = editingUri === null ? -1 : photos.indexOf(editingUri)
  const atLimit = draft.attributes.length >= REFERENCE_PHOTO_MAX_ATTRIBUTES

  function open(uri: string) {
    const entry = value[uri] ?? EMPTY_DRAFT
    setDraft({ attributes: [...entry.attributes], note: entry.note })
    setEditingUri(uri)
  }

  function save() {
    if (editingUri !== null && photos.includes(editingUri)) {
      onChange({ ...value, [editingUri]: { ...draft, note: draft.note.trim() } })
    }
    setEditingUri(null)
  }

  if (photos.length === 0) return null

  return (
    <>
      <View style={styles.block}>
        <Text style={styles.label}>What do you like about each photo?</Text>
        <Text style={styles.hint}>Optional. Point out the details you want your tailor to use.</Text>
        {photos.map((uri, index) => {
          const entry = value[uri] ?? EMPTY_DRAFT
          const hasDetails = entry.attributes.length > 0 || !!entry.note.trim()
          const summary = entry.attributes.join(' · ')
          return (
            <TouchableOpacity
              key={uri}
              style={styles.card}
              onPress={() => open(uri)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${hasDetails ? 'Edit' : 'Add'} details for photo ${index + 1}`}
              accessibilityHint={hasDetails ? [summary, entry.note].filter(Boolean).join('. ') : 'Choose details and add an optional note'}
            >
              <RemoteImage uri={uri} style={styles.thumbnail} transition={0} surface="brief_photo_details" />
              <View style={styles.cardCopy}>
                <Text style={styles.photoLabel}>Photo {index + 1}</Text>
                {summary ? <Text style={styles.summary}>{summary}</Text> : null}
                {entry.note.trim() ? <Text style={styles.hint} numberOfLines={2}>{entry.note}</Text> : null}
                {!hasDetails ? <Text style={styles.hint}>What do you like about this?</Text> : null}
              </View>
              <Text style={styles.edit}>{hasDetails ? 'Edit' : 'Add'}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <BottomSheetScaffold
        visible={editingIndex >= 0}
        title={`Photo ${editingIndex + 1} details`}
        subtitle="What do you like about this?"
        onDismiss={() => setEditingUri(null)}
        scrollable
      >
        {editingUri ? <RemoteImage uri={editingUri} style={styles.sheetPhoto} contentFit="contain" transition={0} surface="brief_photo_details_editor" /> : null}
        <Text style={styles.label}>Note for your tailor (optional)</Text>
        <TextInput
          value={draft.note}
          onChangeText={(note) => setDraft((current) => ({ ...current, note }))}
          maxLength={REFERENCE_PHOTO_NOTE_MAX_CHARS}
          placeholder="e.g. This neckline, with longer sleeves"
          placeholderTextColor={Colors.midGrey}
          style={styles.noteInput}
          accessibilityLabel={`Note for photo ${editingIndex + 1}`}
          multiline
          textAlignVertical="top"
        />
        <View style={styles.detailHeading}>
          <Text style={styles.label}>Details to use</Text>
          <Text style={styles.hint}>{draft.attributes.length}/{REFERENCE_PHOTO_MAX_ATTRIBUTES} selected</Text>
        </View>
        <Text style={styles.hint}>{atLimit ? 'Remove a selected detail to choose another.' : `Choose up to ${REFERENCE_PHOTO_MAX_ATTRIBUTES}, or just leave a note.`}</Text>
        <View style={styles.options}>
        {CUSTOM_ORDER_STYLE_ATTRIBUTES.map((attribute) => {
          const selected = draft.attributes.includes(attribute)
          const disabled = !selected && atLimit
          return (
            <TouchableOpacity
              key={attribute}
              style={[styles.option, disabled && styles.disabled]}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={attribute}
              accessibilityState={{ checked: selected, disabled }}
              onPress={() => setDraft((current) => ({
                ...current,
                attributes: current.attributes.includes(attribute)
                  ? current.attributes.filter((item) => item !== attribute)
                  : current.attributes.length < REFERENCE_PHOTO_MAX_ATTRIBUTES ? [...current.attributes, attribute] : current.attributes,
              }))}
            >
              <Text style={styles.optionText}>{attribute}</Text>
              <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                {selected ? <Feather name="check" size={14} color={Colors.textInverse} /> : null}
              </View>
            </TouchableOpacity>
          )
        })}
        </View>
        <Button label="Save details" onPress={save} style={{ borderRadius: Radius.full }} />
      </BottomSheetScaffold>
    </>
  )
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm, marginTop: Spacing.md },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  hint: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white },
  thumbnail: { width: 56, height: 64, borderRadius: Radius.sm },
  cardCopy: { flex: 1, gap: 4 },
  photoLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.ink },
  summary: { fontSize: FontSize.xs, lineHeight: 18, color: Colors.needleGreenDark },
  edit: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  sheetPhoto: { width: '100%', height: 100, borderRadius: Radius.md, backgroundColor: Colors.bone },
  detailHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  noteInput: { minHeight: 76, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.lightGrey, backgroundColor: Colors.white, padding: 12, fontSize: FontSize.sm, color: Colors.ink },
  options: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.sm },
  option: { width: '48%', minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey, paddingVertical: Spacing.sm },
  optionText: { flex: 1, fontSize: FontSize.sm, color: Colors.ink },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.lightGrey, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: Colors.needleGreen, borderColor: Colors.needleGreen },
  disabled: { opacity: 0.4 },
})
