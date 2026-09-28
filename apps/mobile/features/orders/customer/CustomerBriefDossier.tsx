import { useState, type ReactNode } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import { decodeDisplayText } from '@drape/shared/display-text'
import {
  DrapeMediaMosaic,
  type DrapeMediaMosaicItem,
  type MediaLightboxItem,
} from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

function dossierMediaItems(label: string, mediaUrls: string[]): MediaLightboxItem[] {
  return mediaUrls.map((uri, index) => ({
    uri,
    label: `${label} ${index + 1}`,
    kind: /\.(mp4|mov|webm)(?:$|[?#])/iu.test(uri) ? 'video' : 'photo',
  }))
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLineLabel}>{label}</Text>
      <Text style={styles.summaryLineValue}>{decodeDisplayText(value)}</Text>
    </View>
  )
}

function BriefDossierRowView({
  row,
  onOpenLink,
  onOpenMedia,
}: {
  row: BriefDossierRow
  onOpenLink: (href: string) => void
  onOpenMedia: (items: MediaLightboxItem[], index: number) => void
}) {
  if (row.presentation === 'chips' && row.values?.length) {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.summaryLineLabel}>{row.label}</Text>
        <View style={styles.styleChipRow}>
          {row.values.map((value) => (
            <View key={value} style={styles.styleChip}>
              <Text style={styles.styleChipText}>{decodeDisplayText(value)}</Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  if (row.presentation === 'links' && row.hrefs?.length) {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.summaryLineLabel}>{row.label}</Text>
        {row.hrefs.map((href) => (
          <TouchableOpacity
            key={href}
            onPress={() => void onOpenLink(href)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${decodeDisplayText(href)}`}
          >
            <Text style={styles.dossierLinkText}>{decodeDisplayText(href)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  if (row.presentation === 'media' && row.mediaUrls?.length) {
    const mediaItems = dossierMediaItems(row.label, row.mediaUrls)
    const mosaicItems: DrapeMediaMosaicItem[] = mediaItems.map((item, index) => ({
      id: `${item.uri}-${index}`,
      uri: item.uri,
      kind: item.kind ?? 'photo',
      label: `Open ${item.label}`,
      bucket: item.bucket,
    }))
    return (
      <View style={styles.dossierRowStacked}>
        <View style={styles.dossierRowHeader}>
          <Text style={styles.summaryLineLabel}>{row.label}</Text>
          {row.value ? <Text style={styles.helperText}>{row.value}</Text> : null}
        </View>
        <DrapeMediaMosaic
          items={mosaicItems}
          compact
          testID={`customer-dossier-media-${row.id}`}
          onPressItem={(_item, index) => onOpenMedia(mediaItems, index)}
        />
      </View>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.summaryLineLabel}>{row.label}</Text>
        <Text style={styles.dossierStackedText}>{decodeDisplayText(row.value ?? '')}</Text>
      </View>
    )
  }

  return <SummaryLine label={row.label} value={row.value ?? 'Not set'} />
}

function SupportDisclosure({
  title,
  summary,
  defaultExpanded,
  children,
}: {
  title: string
  summary: string
  defaultExpanded: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <View style={styles.disclosureCard}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        style={styles.disclosureHeader}
        onPress={() => setExpanded((value) => !value)}
        activeOpacity={0.82}
      >
        <View style={styles.disclosureCopy}>
          <Text style={styles.supportCardTitle}>{title}</Text>
          <Text style={styles.disclosureSummary}>{summary}</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.midGrey} />
      </TouchableOpacity>
      {expanded ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  )
}

export function CustomerBriefDossierCard({
  section,
  onOpenLink,
  onOpenMedia,
  defaultExpanded = false,
}: {
  section: BriefDossierSection
  onOpenLink: (href: string) => void
  onOpenMedia: (items: MediaLightboxItem[], index: number) => void
  defaultExpanded?: boolean
}) {
  const rowCount = `${section.rows.length} ${section.rows.length === 1 ? 'detail' : 'details'}`
  const summary = section.summary?.trim()
  return (
    <SupportDisclosure title={section.title} summary={summary && summary.length <= 84 ? summary : rowCount} defaultExpanded={defaultExpanded}>
      <View style={styles.supportMetaList}>
        {section.rows.map((row) => (
          <BriefDossierRowView key={row.id} row={row} onOpenLink={onOpenLink} onOpenMedia={onOpenMedia} />
        ))}
      </View>
    </SupportDisclosure>
  )
}

const styles = {
  summaryLine: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: Spacing.md },
  summaryLineLabel: { fontSize: FontSize.sm, color: Colors.midGrey },
  summaryLineValue: { flex: 1, textAlign: 'right' as const, fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },
  dossierRowStacked: { gap: 6 },
  dossierRowHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: Spacing.sm },
  dossierStackedText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink, lineHeight: 20 },
  dossierLinkText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.needleGreenDark, lineHeight: 20 },
  styleChipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  styleChip: { borderRadius: Radius.full, backgroundColor: Colors.needleGreenLight, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  styleChipText: { fontSize: FontSize.xs, color: Colors.needleGreenDark, fontWeight: FontWeight.semibold },
  helperText: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },
  disclosureCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.boneDeep, gap: Spacing.sm },
  disclosureHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: Spacing.sm },
  disclosureCopy: { flex: 1, gap: 3 },
  disclosureSummary: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  disclosureBody: { paddingTop: Spacing.xs },
  supportCardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  supportMetaList: { gap: 6 },
}
