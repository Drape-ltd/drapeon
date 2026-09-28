import { Colors } from '@/constants/theme'
import { Feather } from '@expo/vector-icons'
import { useState, type ReactNode } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { styles } from './CustomerOrderStyles'

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
