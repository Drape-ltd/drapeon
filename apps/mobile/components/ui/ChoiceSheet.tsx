import { useEffect, useState } from 'react'
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type DimensionValue,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import {
  Fonts,
  FontSize,
  FontWeight,
  Radius,
  Shadow,
  Spacing,
  getDrapeColors,
  type DrapeColorScheme,
  type DrapeColorPalette,
} from '@/constants/theme'
import { KeyboardAwareModalBody } from '@/components/ui/KeyboardAwareModalBody'

export type ChoiceSheetOption = {
  value: string
  title: string
  body?: string
  meta?: string
  icon?: keyof typeof Feather.glyphMap
  materialIcon?: keyof typeof MaterialCommunityIcons.glyphMap
  disabled?: boolean
}

type ChoiceSheetProps = {
  visible: boolean
  appearance?: DrapeColorScheme
  title: string
  subtitle?: string
  options: ChoiceSheetOption[]
  selectedValue?: string | null
  selectedValues?: string[]
  multiple?: boolean
  doneLabel?: string
  searchable?: boolean
  searchPlaceholder?: string
  /** Gives long choice lists a bounded viewport so their scroll body can render. */
  sheetHeight?: DimensionValue
  onSelect: (value: string) => void
  onClose: () => void
  onDone?: () => void
}

export function ChoiceSheet({
  visible,
  appearance = 'light',
  title,
  subtitle,
  options,
  selectedValue,
  selectedValues = [],
  multiple = false,
  doneLabel = 'Done',
  searchable = false,
  searchPlaceholder = 'Search choices',
  sheetHeight,
  onSelect,
  onClose,
  onDone,
}: ChoiceSheetProps) {
  const insets = useSafeAreaInsets()
  const palette = getDrapeColors(appearance)
  const styles = createChoiceStyles(palette)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!visible) setQuery('')
  }, [visible])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleOptions = normalizedQuery
    ? options.filter((option) =>
        [option.title, option.meta, option.body].some((part) =>
          part?.toLocaleLowerCase().includes(normalizedQuery)
        )
      )
    : options

  function isSelected(value: string) {
    return multiple ? selectedValues.includes(value) : selectedValue === value
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom + Spacing.lg, 36),
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close choices"
              hitSlop={8}
            >
              <Feather name="x" size={18} color={palette.ink} />
            </TouchableOpacity>
          </View>

          {searchable ? (
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={palette.inkLight}
              accessibilityLabel={searchPlaceholder}
              autoCorrect={false}
              returnKeyType="search"
            />
          ) : null}

          <KeyboardAwareModalBody
            contentContainerStyle={styles.options}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {visibleOptions.map((option) => {
              const selected = isSelected(option.value)
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.option,
                    selected && styles.optionSelected,
                    option.disabled && styles.optionDisabled,
                  ]}
                  onPress={() => onSelect(option.value)}
                  disabled={option.disabled}
                  activeOpacity={0.76}
                  accessibilityRole={multiple ? 'checkbox' : 'button'}
                  accessibilityState={{
                    selected,
                    checked: multiple ? selected : undefined,
                    disabled: option.disabled,
                  }}
                  accessibilityLabel={option.title}
                  accessibilityHint={option.body}
                >
                  {option.icon || option.materialIcon ? (
                    <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
                      {option.materialIcon ? (
                        <MaterialCommunityIcons
                          name={option.materialIcon}
                          size={19}
                          color={selected ? palette.needleGreen : palette.inkLight}
                        />
                      ) : option.icon ? (
                        <Feather
                          name={option.icon}
                          size={18}
                          color={selected ? palette.needleGreen : palette.inkLight}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                      {option.title}
                    </Text>
                    {option.body ? <Text style={styles.optionBody}>{option.body}</Text> : null}
                    {option.meta ? <Text style={styles.optionMeta}>{option.meta}</Text> : null}
                  </View>
                  <View style={[styles.check, selected && styles.checkSelected]}>
                    {selected ? (
                      <Feather name="check" size={14} color={palette.textInverse} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              )
            })}
            {searchable && visibleOptions.length === 0 ? (
              <Text style={styles.emptyText}>No matching choices. Try another search.</Text>
            ) : null}
          </KeyboardAwareModalBody>

          {multiple ? (
            <TouchableOpacity
              style={styles.doneButton}
              onPress={onDone ?? onClose}
              accessibilityRole="button"
              accessibilityLabel={doneLabel}
            >
              <Text style={styles.doneText}>{doneLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function createChoiceStyles(palette: DrapeColorPalette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.36)',
    },
    sheet: {
      maxHeight: '86%',
      backgroundColor: palette.white,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingHorizontal: Spacing.lg,
      paddingTop: 12,
      gap: Spacing.lg,
      ...Shadow.lg,
    },
    handle: {
      width: 72,
      height: 5,
      borderRadius: Radius.full,
      backgroundColor: palette.lightGrey,
      alignSelf: 'center',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
    },
    headerCopy: { flex: 1, gap: 4 },
    title: {
      fontFamily: Fonts.display,
      fontSize: FontSize.xl,
      lineHeight: 30,
      fontWeight: FontWeight.semibold,
      color: palette.ink,
    },
    subtitle: {
      fontFamily: Fonts.body,
      fontSize: FontSize.sm,
      lineHeight: 20,
      color: palette.inkLight,
    },
    searchInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: palette.lightGrey,
      borderRadius: Radius.lg,
      backgroundColor: palette.white,
      color: palette.ink,
      fontFamily: Fonts.body,
      fontSize: FontSize.md,
      paddingHorizontal: Spacing.md,
    },
    emptyText: {
      color: palette.inkLight,
      fontFamily: Fonts.body,
      fontSize: FontSize.sm,
      paddingVertical: Spacing.lg,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.bone,
    },
    options: { flexGrow: 1, gap: Spacing.sm, paddingBottom: Spacing.sm },
    option: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.lightGrey,
      borderRadius: Radius.lg,
      backgroundColor: palette.white,
    },
    optionSelected: {
      borderColor: palette.needleGreen,
      backgroundColor: palette.needleGreenLight,
    },
    optionDisabled: { opacity: 0.45 },
    optionIcon: {
      width: 38,
      height: 38,
      borderRadius: Radius.full,
      backgroundColor: palette.bone,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionIconSelected: { backgroundColor: palette.white },
    optionCopy: { flex: 1, gap: 2 },
    optionTitle: {
      fontFamily: Fonts.bodySemiBold,
      fontSize: FontSize.md,
      lineHeight: 22,
      color: palette.ink,
      fontWeight: FontWeight.semibold,
    },
    optionTitleSelected: { color: palette.needleGreen },
    optionBody: {
      fontFamily: Fonts.body,
      fontSize: FontSize.sm,
      lineHeight: 19,
      color: palette.inkLight,
    },
    optionMeta: {
      fontFamily: Fonts.body,
      fontSize: FontSize.xs,
      lineHeight: 17,
      color: palette.midGrey,
    },
    check: {
      width: 24,
      height: 24,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: palette.lightGrey,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.white,
    },
    checkSelected: {
      borderColor: palette.needleGreen,
      backgroundColor: palette.needleGreen,
    },
    doneButton: {
      minHeight: 56,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.needleGreen,
    },
    doneText: {
      fontFamily: Fonts.bodyBold,
      fontSize: FontSize.md,
      color: palette.textInverse,
      fontWeight: FontWeight.bold,
    },
  })
}
