import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Fonts, FontSize, Radius, Spacing, useDrapeTheme } from '@/constants/theme'
import {
  VisionHeader,
  VisionPrivacyNotice,
  VisionPrimaryButton,
  VisionSectionTitle,
  VisionShell,
} from './DrapeVisionPrimitives'
import type { VisionHubOption } from './DrapeVisionViews'
import type { VisionSurfaceTone } from './presentation'

function VisionEngineTile({ option }: { option: VisionHubOption }) {
  const { colors } = useDrapeTheme()
  const recommended = option.recommended === true
  const tileDescription = recommended
    ? 'Chest, waist, hips and shoulders'
    : option.hint ?? option.body
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${option.title}. ${recommended ? 'Recommended first. ' : ''}${option.status}. ${option.body}`}
      accessibilityState={{ disabled: option.disabled === true }}
      disabled={option.disabled}
      onPress={option.onPress}
      style={({ pressed }) => [
        styles.engineTile,
        {
          backgroundColor: colors.surface,
          borderColor: recommended ? colors.needleGreen : colors.lightGrey,
        },
        recommended && styles.engineTileRecommended,
        option.disabled && styles.engineTileDisabled,
        pressed && !option.disabled && styles.engineTilePressed,
      ]}
    >
      <View style={styles.engineTileTop}>
        <Text style={[styles.engineEyebrow, { color: colors.needleGreenDark }]}>
          {recommended ? 'START HERE' : option.status.toUpperCase()}
        </Text>
      </View>
      <Text numberOfLines={2} style={[styles.engineTitle, { color: colors.ink }]}>{option.title}</Text>
      <Text numberOfLines={2} style={[styles.engineBody, { color: colors.inkLight }]}>
        {tileDescription}
      </Text>
      {recommended ? <Text style={[styles.recommendedNote, { color: colors.needleGreenDark }]}>Core fit profile</Text> : null}
    </Pressable>
  )
}

export function VisionHubView({
  status,
  statusTone,
  onClose,
  closeDisabled,
  savedHeight,
  hasSavedHeight,
  onChangeHeight,
  options,
  manualLabel,
  onManual,
}: {
  status: string
  statusTone: VisionSurfaceTone
  onClose: () => void
  closeDisabled: boolean
  savedHeight: string
  hasSavedHeight: boolean
  onChangeHeight: () => void
  options: VisionHubOption[]
  privacyPoints: readonly string[]
  manualLabel: string
  onManual: () => void
}) {
  const { colors } = useDrapeTheme()
  const [beforeScanExpanded, setBeforeScanExpanded] = useState(false)
  const fit360Option = options.find((option) => option.id === 'fit_360')
  const toolOrder = ['hand_wrist', 'headwear', 'bodice_corset', 'lower_body_detail']
  const otherOptions = options
    .filter((option) => option.id !== 'fit_360')
    .sort((a, b) => {
      const indexA = toolOrder.indexOf(a.id)
      const indexB = toolOrder.indexOf(b.id)
      return (indexA < 0 ? toolOrder.length : indexA) - (indexB < 0 ? toolOrder.length : indexB)
    })
  const startableOption = fit360Option?.disabled === false
    ? fit360Option
    : options.find((option) => !option.disabled)
  const scanUnavailableReason = startableOption
    ? undefined
    : (fit360Option?.status ?? 'Camera scanning is not available on this device yet.')

  return (
    <VisionShell
      testID="vision-hub"
      header={(
        <VisionHeader
          status={status}
          tone={statusTone}
          onClose={onClose}
          disabled={closeDisabled}
        />
      )}
      footer={startableOption
        ? <VisionPrimaryButton label={`Start ${startableOption.title}`} onPress={startableOption.onPress} />
        : <VisionPrimaryButton label={manualLabel} onPress={onManual} />}
    >
      <VisionSectionTitle
        eyebrow="Drapeon Vision"
        title="Choose what to measure"
        body="Choose a scan for the area you want to measure."
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Height. ${hasSavedHeight ? savedHeight : 'Add when needed'}. Needed for Fit 360, bodice and lower-body scans. Change height.`}
        onPress={onChangeHeight}
        style={({ pressed }) => [
          styles.heightRow,
          { backgroundColor: colors.surface, borderColor: colors.lightGrey },
          pressed && styles.engineTilePressed,
        ]}
      >
        <View style={styles.heightCopy}>
          <Text style={[styles.heightLabel, { color: colors.inkLight }]}>HEIGHT</Text>
          <Text style={[styles.heightValue, { color: colors.ink }]}>{hasSavedHeight ? savedHeight : 'Add when needed'}</Text>
        </View>
        <Text style={[styles.heightHint, { color: colors.inkLight }]}>Fit 360, bodice & lower body</Text>
        <Text style={[styles.heightAction, { color: colors.needleGreenDark }]}>{hasSavedHeight ? 'Change' : 'Set'}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: beforeScanExpanded }}
        accessibilityLabel={beforeScanExpanded ? 'Hide scan preparation steps' : 'Before you scan. Fitted clothes, even light, phone at waist-to-chest height. Tap to see all steps.'}
        onPress={() => setBeforeScanExpanded((expanded) => !expanded)}
        style={({ pressed }) => [
          styles.beforeScanRow,
          { backgroundColor: colors.needleGreenLight, borderColor: colors.needleGreen },
          pressed && styles.engineTilePressed,
        ]}
      >
        <View style={styles.beforeScanCopy}>
          <View style={styles.beforeScanHeader}>
            <Text
              numberOfLines={1}
              style={[styles.beforeScanTitle, { color: colors.needleGreenDark }]}
            >
              Before you scan · fitted clothes, even light, phone at waist-to-chest height
            </Text>
            <Text style={[styles.beforeScanAction, { color: colors.needleGreenDark }]}>
              {beforeScanExpanded ? 'Hide' : 'Tips'}
            </Text>
          </View>
          {beforeScanExpanded ? (
            <View style={styles.beforeScanSteps}>
              <Text style={[styles.beforeScanStep, { color: colors.inkLight }]}>Wear one fitted, lightweight layer.</Text>
              <Text style={[styles.beforeScanStep, { color: colors.inkLight }]}>Use bright, even front light and a plain background.</Text>
              <Text style={[styles.beforeScanStep, { color: colors.inkLight }]}>Set the phone upright on a stable surface around waist-to-chest height.</Text>
              <Text style={[styles.beforeScanStep, { color: colors.inkLight }]}>Step back until your full body, head to ankles, stays in frame.</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {fit360Option ? <VisionEngineTile option={fit360Option} /> : null}

      <Text style={[styles.enginesTitle, { color: colors.ink }]}>More measurement tools</Text>
      <View style={styles.engineGrid}>
        {otherOptions.map((option) => <VisionEngineTile key={option.id} option={option} />)}
      </View>

      {startableOption ? (
        <Pressable
          accessibilityRole="button"
          onPress={onManual}
          style={({ pressed }) => [styles.manualEntry, { borderColor: colors.lightGrey }, pressed && styles.engineTilePressed]}
        >
          <Text style={[styles.manualEntryEyebrow, { color: colors.inkLight }]}>Prefer to type them?</Text>
          <Text style={[styles.manualEntryTitle, { color: colors.needleGreenDark }]}>{manualLabel}</Text>
          <Text style={[styles.engineBody, { color: colors.inkLight }]}>Scan later and it updates the same profile.</Text>
        </Pressable>
      ) : (
        <View style={[styles.unavailableNotice, { backgroundColor: colors.surface, borderColor: colors.lightGrey }]}>
          <Text style={[styles.unavailableTitle, { color: colors.ink }]}>Camera scanning is not ready on this device</Text>
          <Text style={[styles.engineBody, { color: colors.inkLight }]}>{scanUnavailableReason}</Text>
        </View>
      )}

      <VisionPrivacyNotice />
    </VisionShell>
  )
}

const styles = StyleSheet.create({
  heightRow: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heightCopy: { minWidth: 74 },
  heightLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 9, lineHeight: 12, letterSpacing: 0.6 },
  heightValue: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 18 },
  heightHint: { flex: 1, fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 16 },
  heightAction: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 18 },
  beforeScanRow: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    shadowColor: '#398357',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  beforeScanCopy: { flex: 1, gap: 1 },
  beforeScanHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  beforeScanTitle: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.xs, lineHeight: 18 },
  beforeScanAction: { fontFamily: Fonts.bodySemiBold, fontSize: 9, lineHeight: 12 },
  beforeScanSteps: { gap: 3, paddingTop: Spacing.xs },
  beforeScanStep: { fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 17 },
  engineGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  engineTile: {
    width: '48%',
    minHeight: 112,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.sm,
    gap: 2,
  },
  engineTileRecommended: { borderWidth: 1.5 },
  engineTileDisabled: { opacity: 0.58 },
  engineTilePressed: { opacity: 0.76 },
  engineTileTop: { minHeight: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  engineEyebrow: { fontFamily: Fonts.bodySemiBold, fontSize: 8, lineHeight: 11, letterSpacing: 0.45 },
  engineTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  engineBody: { fontFamily: Fonts.body, fontSize: FontSize.xs, lineHeight: 15, flexGrow: 1 },
  recommendedNote: { fontFamily: Fonts.bodySemiBold, fontSize: 9, lineHeight: 12 },
  manualEntry: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.md, gap: 2 },
  manualEntryEyebrow: { fontFamily: Fonts.bodySemiBold, fontSize: 9, lineHeight: 12, letterSpacing: 0.3 },
  manualEntryTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
  enginesTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md, lineHeight: 20, paddingTop: Spacing.xs },
  unavailableNotice: { borderRadius: Radius.md, borderWidth: 1, padding: Spacing.md, gap: Spacing.xs },
  unavailableTitle: { fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm, lineHeight: 19 },
})
