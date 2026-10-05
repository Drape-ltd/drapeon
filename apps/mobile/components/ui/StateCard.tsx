import type { ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Colors, Fonts, FontWeight, Radius, Spacing } from '@/constants/theme'

type StateCardTone = 'empty' | 'error' | 'warning' | 'success'

type StateCardProps = {
  title: string
  body: string
  tone?: StateCardTone
  actionLabel?: string
  onAction?: () => void
  children?: ReactNode
}

export function StateCard({
  title,
  body,
  tone = 'empty',
  actionLabel,
  onAction,
  children,
}: StateCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={tone === 'error' || tone === 'warning' ? styles.secondaryAction : styles.primaryAction}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          activeOpacity={0.75}
        >
          <Text style={tone === 'error' || tone === 'warning' ? styles.secondaryActionText : styles.primaryActionText}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: 14,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    textAlign: 'center',
    letterSpacing: 0,
  },
  body: {
    maxWidth: 290,
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.inkLight,
    textAlign: 'center',
  },
  primaryAction: {
    width: '100%',
    minHeight: 46,
    marginTop: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.textInverse,
  },
  secondaryAction: {
    minWidth: 180,
    minHeight: 46,
    marginTop: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.ink,
  },
})
