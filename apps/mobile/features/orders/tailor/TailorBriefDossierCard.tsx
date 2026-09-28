import {
  DrapeMediaMosaic,
  type DrapeMediaMosaicItem,
  type MediaLightboxItem,
} from '@/components/ui'
import { Colors } from '@/constants/theme'
import { isOrderEvidenceVideoUri as isVideoUri } from '@/features/orders/tailor/OrderStageMedia'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import { decodeDisplayText } from '@drape/shared/display-text'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import { Feather } from '@expo/vector-icons'
import { useState, type ReactNode } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

export function dossierMediaItems(label: string, mediaUrls: string[]): MediaLightboxItem[] {
  return mediaUrls.slice(0, 6).map((uri, index) => ({
    uri,
    label: `${label} ${index + 1}`,
    kind: isVideoUri(uri) ? 'video' : 'photo',
    bucket: isVideoUri(uri) ? undefined : 'order-photos',
  }))
}

export function BriefRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.briefRow}>
      <Text style={styles.briefRowLabel}>{label}</Text>
      <Text style={styles.briefRowValue}>{decodeDisplayText(value)}</Text>
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
        <Text style={styles.briefRowLabel}>{row.label}</Text>
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
        <Text style={styles.briefRowLabel}>{row.label}</Text>
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
          <Text style={styles.briefRowLabel}>{row.label}</Text>
          {row.value ? <Text style={styles.supportHint}>{row.value}</Text> : null}
        </View>
        <DrapeMediaMosaic
          items={mosaicItems}
          compact
          testID={`tailor-dossier-media-${row.id}`}
          onPressItem={(_item, index) => onOpenMedia(mediaItems, index)}
        />
      </View>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <View style={styles.dossierRowStacked}>
        <Text style={styles.briefRowLabel}>{row.label}</Text>
        <Text style={styles.dossierStackedText}>{decodeDisplayText(row.value ?? '')}</Text>
      </View>
    )
  }

  return <BriefRow label={row.label} value={row.value ?? 'Not set'} />
}

export function SupportDisclosure({
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
    <View style={[styles.supportCard, styles.disclosureCard]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        style={styles.disclosureHeader}
        onPress={() => setExpanded((current) => !current)}
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

export function BriefDossierCard({
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
  const rawSummary = section.summary?.trim()
  const disclosureSummary = rawSummary && rawSummary.length <= 84 ? rawSummary : rowCount

  return (
    <SupportDisclosure
      title={section.title}
      summary={disclosureSummary}
      defaultExpanded={defaultExpanded}
    >
      <View style={styles.supportMetaList}>
        {section.rows.map((row) => (
          <BriefDossierRowView
            key={row.id}
            row={row}
            onOpenLink={onOpenLink}
            onOpenMedia={onOpenMedia}
          />
        ))}
      </View>
    </SupportDisclosure>
  )
}
