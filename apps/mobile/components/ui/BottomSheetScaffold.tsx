import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type DimensionValue,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { bottomSheetRuntime, nativeBottomSheetAvailable } from '@/lib/native-sheet-runtime'
import { KeyboardAwareScrollView } from './KeyboardAwareScrollView'
import { DrapeBottomSheetInputScope } from './DrapeTextInput'
import { DrapeKeyboardToolbar, DRAPE_KEYBOARD_TOOLBAR_HEIGHT } from './DrapeKeyboardToolbar'
import { DrapeKeyboardFormAvoidingView } from '@/components/ui/KeyboardPrimitives'


type BottomSheetActionTone = 'primary' | 'secondary' | 'destructive'

export type BottomSheetScaffoldAction = {
  label: string
  onPress: () => void
  testID?: string
  disabled?: boolean
  loading?: boolean
  accessibilityLabel?: string
  tone?: BottomSheetActionTone
}

type BottomSheetScaffoldProps = {
  visible: boolean
  title: string
  subtitle?: string | null
  onDismiss: () => void
  children: ReactNode
  scrollable?: boolean
  snapPoints?: Array<number | string>
  enableDynamicSizing?: boolean
  primaryAction?: BottomSheetScaffoldAction
  secondaryAction?: BottomSheetScaffoldAction
  destructiveAction?: BottomSheetScaffoldAction
  testID?: string
}

type SheetFrameProps = {
  title: string
  subtitle?: string | null
  children: ReactNode
  scrollable: boolean
  actions: BottomSheetScaffoldAction[]
  onClose: () => void
  useNativeSheetBody?: boolean
  standaloneNativeFrame?: boolean
  bottomInset: number
  testID?: string
  footer?: ReactNode
  toolbar?: ReactNode
}

type SheetFrameContentProps = Omit<SheetFrameProps, 'footer' | 'toolbar'>

function SheetActionButton({ action }: { action: BottomSheetScaffoldAction }) {
  return (
    <TouchableOpacity
      key={action.label}
      onPress={action.onPress}
      disabled={action.disabled || action.loading}
      style={[
        styles.footerAction,
        action.tone === 'primary' && styles.footerActionPrimary,
        action.tone === 'secondary' && styles.footerActionSecondary,
        action.tone === 'destructive' && styles.footerActionDestructive,
        (action.disabled || action.loading) && styles.footerActionDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      testID={action.testID}
    >
      {action.loading ? (
        <ActivityIndicator
          size="small"
          color={action.tone === 'secondary' ? Colors.ink : Colors.textInverse}
        />
      ) : (
        <Text
          style={[
            styles.footerActionLabel,
            action.tone === 'secondary' && styles.footerActionLabelSecondary,
            action.tone === 'destructive' && styles.footerActionLabelDestructive,
          ]}
        >
          {action.label}
        </Text>
      )}
    </TouchableOpacity>
  )
}

function SheetFooter({
  actions,
  standaloneNativeFrame = false,
  bottomInset,
}: Pick<SheetFrameProps, 'actions' | 'standaloneNativeFrame' | 'bottomInset'>) {
  if (actions.length === 0) return null

  return (
    <View
      style={[
        styles.footer,
        standaloneNativeFrame && styles.standaloneFooter,
        { paddingBottom: bottomInset },
      ]}
    >
      {actions.map((action) => <SheetActionButton key={action.label} action={action} />)}
    </View>
  )
}

function SheetFrame({
  title,
  subtitle,
  children,
  scrollable,
  actions,
  onClose,
  useNativeSheetBody = false,
  standaloneNativeFrame = false,
  bottomInset,
  testID,
  footer,
  toolbar,
}: SheetFrameProps) {
  const RuntimeBottomSheetScrollView = bottomSheetRuntime?.BottomSheetScrollView
  const RuntimeBottomSheetView = bottomSheetRuntime?.BottomSheetView
  const bodyBottomInset = actions.length > 0 ? 0 : bottomInset

  const body = scrollable
    ? useNativeSheetBody && RuntimeBottomSheetScrollView
      ? (
        <RuntimeBottomSheetScrollView
          style={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          nestedScrollEnabled
          contentContainerStyle={[
            styles.scrollContent,
            standaloneNativeFrame && styles.standaloneScrollContent,
            { paddingBottom: Spacing.xl + bodyBottomInset },
          ]}
        >
          <DrapeBottomSheetInputScope>{children}</DrapeBottomSheetInputScope>
        </RuntimeBottomSheetScrollView>
      )
      : (
        <KeyboardAwareScrollView
          style={styles.scrollBody}
          bottomOffset={Platform.OS === 'android' ? 132 : 104}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          nestedScrollEnabled
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Spacing.xl + bodyBottomInset },
          ]}
        >
          {children}
        </KeyboardAwareScrollView>
      )
    : useNativeSheetBody && RuntimeBottomSheetView
      ? (
        <RuntimeBottomSheetView style={[styles.body, { paddingBottom: bodyBottomInset }]}>
          <DrapeBottomSheetInputScope>{children}</DrapeBottomSheetInputScope>
        </RuntimeBottomSheetView>
      )
      : <View style={[styles.body, { paddingBottom: bodyBottomInset }]}>{children}</View>

  return (
    <>
      <View
        style={[styles.header, standaloneNativeFrame && styles.standaloneHeader]}
        testID={testID}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={'Close ' + title}
        >
          <Feather name="x" size={20} color={Colors.ink} />
        </TouchableOpacity>
      </View>

      {body}

      {footer}
      {toolbar}
    </>
  )
}

/**
 * Gorhom owns keyboard movement inside its native sheet. Keep this frame free
 * of KeyboardStickyView and DrapeKeyboardToolbar; the root toolbar is in the
 * same native window as the sheet.
 */
function NativeSheetFrame(props: SheetFrameContentProps) {
  return (
    <SheetFrame
      {...props}
      footer={(
        <SheetFooter
          actions={props.actions}
          standaloneNativeFrame={props.standaloneNativeFrame}
          bottomInset={props.bottomInset}
        />
      )}
    />
  )
}

/**
 * React Native Modals have their own native window, so exactly one local
 * toolbar is required. A fixed fallback uses Modal avoidance; a scrolling
 * fallback instead moves only its footer with KeyboardStickyView.
 */
function FallbackSheetFrame({
  usesModalAvoidance,
  ...props
}: SheetFrameContentProps & { usesModalAvoidance: boolean }) {
  const footer = usesModalAvoidance ? (
    <SheetFooter
      actions={props.actions}
      standaloneNativeFrame={props.standaloneNativeFrame}
      bottomInset={props.bottomInset}
    />
  ) : (
    <KeyboardStickyView offset={{ opened: -DRAPE_KEYBOARD_TOOLBAR_HEIGHT }}>
      <SheetFooter
        actions={props.actions}
        standaloneNativeFrame={props.standaloneNativeFrame}
        bottomInset={props.bottomInset}
      />
    </KeyboardStickyView>
  )

  return (
    <SheetFrame
      {...props}
      footer={footer}
      toolbar={usesModalAvoidance ? null : <DrapeKeyboardToolbar />}
    />
  )
}

export function BottomSheetScaffold({
  visible,
  title,
  subtitle,
  onDismiss,
  children,
  scrollable = false,
  snapPoints,
  enableDynamicSizing,
  primaryAction,
  secondaryAction,
  destructiveAction,
  testID,
}: BottomSheetScaffoldProps) {
  const insets = useSafeAreaInsets()
  const contentBottomInset = Math.max(insets.bottom, Spacing.sm)
  const modalRef = useRef<{ present?: () => void; dismiss?: () => void } | null>(null)
  const presentedRef = useRef(false)
  const shouldEnableDynamicSizing = enableDynamicSizing ?? !scrollable
  const resolvedSnapPoints = useMemo(
    () => snapPoints ?? (scrollable ? ['88%'] : ['68%']),
    [scrollable, snapPoints],
  )
  const fallbackSheetHeight = shouldEnableDynamicSizing
    ? undefined
    : resolvedSnapPoints[0] as DimensionValue | undefined
  const actions = [primaryAction, secondaryAction, destructiveAction].filter(Boolean) as BottomSheetScaffoldAction[]

  const RuntimeBottomSheetBackdrop = bottomSheetRuntime?.BottomSheetBackdrop
  const RuntimeBottomSheetModal = bottomSheetRuntime?.BottomSheetModal
  const RuntimeBottomSheetView = bottomSheetRuntime?.BottomSheetView
  const canUseNativeSheet =
    nativeBottomSheetAvailable &&
    !!RuntimeBottomSheetBackdrop &&
    !!RuntimeBottomSheetModal &&
    !!RuntimeBottomSheetView

  useEffect(() => {
    if (!canUseNativeSheet) return
    const modal = modalRef.current
    if (!modal) return

    if (visible && !presentedRef.current) {
      presentedRef.current = true
      modal.present?.()
      return
    }

    if (!visible && presentedRef.current) {
      presentedRef.current = false
      modal.dismiss?.()
    }
  }, [canUseNativeSheet, visible])

  useEffect(() => {
    if (!visible) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss()
      return true
    })
    return () => subscription.remove()
  }, [onDismiss, visible])

  function handleDismiss() {
    const wasPresented = presentedRef.current
    presentedRef.current = false
    if (wasPresented || visible) onDismiss()
  }

  if (!canUseNativeSheet || !RuntimeBottomSheetModal || !RuntimeBottomSheetView) {
    const fallbackSheet = (
      <>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={'Dismiss ' + title}
        />
        <View
          style={[
            styles.sheetBackground,
            styles.fallbackSheetBackground,
            scrollable && styles.fallbackSheetBackgroundScrollable,
            fallbackSheetHeight !== undefined && { height: fallbackSheetHeight },
          ]}
        >
          <View style={styles.handleIndicator} />
          <View style={[styles.frame, scrollable && styles.frameScrollable]}>
            <FallbackSheetFrame
              title={title}
              subtitle={subtitle}
              scrollable={scrollable}
              actions={actions}
              onClose={onDismiss}
              usesModalAvoidance={!scrollable}
              bottomInset={contentBottomInset}
              testID={testID}
            >
              {children}
            </FallbackSheetFrame>
          </View>
        </View>
      </>
    )

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        onRequestClose={onDismiss}
        statusBarTranslucent
        navigationBarTranslucent
      >
        {scrollable ? (
          <View style={styles.modalOverlay}>{fallbackSheet}</View>
        ) : (
          <DrapeKeyboardFormAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={DRAPE_KEYBOARD_TOOLBAR_HEIGHT}
          >
            {fallbackSheet}
          </DrapeKeyboardFormAvoidingView>
        )}
      </Modal>
    )
  }

  return (
    <RuntimeBottomSheetModal
      ref={modalRef}
      onDismiss={handleDismiss}
      containerStyle={styles.nativeModalContainer}
      style={styles.nativeSheet}
      // Let the sheet surface extend behind the system gesture area. SheetFrame
      // already reserves the safe-area inset for content and actions.
      bottomInset={0}
      enableDynamicSizing={shouldEnableDynamicSizing}
      snapPoints={shouldEnableDynamicSizing ? undefined : resolvedSnapPoints}
      backdropComponent={(props: unknown) => (
        <RuntimeBottomSheetBackdrop
          {...(props as object)}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.46}
          pressBehavior="close"
        />
      )}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enableBlurKeyboardOnGesture
      enablePanDownToClose={!scrollable}
    >
      {scrollable ? (
        <NativeSheetFrame
          title={title}
          subtitle={subtitle}
          scrollable
          actions={actions}
          onClose={() => modalRef.current?.dismiss?.()}
          useNativeSheetBody
          standaloneNativeFrame
          bottomInset={contentBottomInset}
          testID={testID}
        >
          {children}
        </NativeSheetFrame>
      ) : (
        <RuntimeBottomSheetView style={styles.frame}>
          <NativeSheetFrame
            title={title}
            subtitle={subtitle}
            scrollable={false}
            actions={actions}
            onClose={() => modalRef.current?.dismiss?.()}
            useNativeSheetBody
            bottomInset={contentBottomInset}
            testID={testID}
          >
            {children}
          </NativeSheetFrame>
        </RuntimeBottomSheetView>
      )}
    </RuntimeBottomSheetModal>
  )
}

const styles = StyleSheet.create({
  nativeModalContainer: {
    zIndex: 1000,
    elevation: 100,
  },
  nativeSheet: {
    zIndex: 1001,
    elevation: 101,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 17, 17, 0.46)',
  },
  sheetBackground: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    ...Shadow.lg,
  },
  fallbackSheetBackground: {
    maxHeight: '82%',
    paddingTop: Spacing.sm,
  },
  fallbackSheetBackgroundScrollable: {
    height: '82%',
  },
  handleIndicator: {
    alignSelf: 'center',
    backgroundColor: Colors.lightGrey,
    width: 44,
    height: 5,
    borderRadius: Radius.full,
  },
  frame: {
    flexShrink: 1,
    minHeight: 0,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  frameScrollable: {
    flex: 1,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  standaloneHeader: {
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
  },
  subtitle: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    color: Colors.inkLight,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bone,
  },
  body: {
    minHeight: 0,
    gap: Spacing.md,
  },
  scrollBody: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  standaloneScrollContent: {
    paddingHorizontal: Spacing.lg,
  },
  footer: {
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  standaloneFooter: {
    paddingHorizontal: Spacing.lg,
  },
  footerAction: {
    minHeight: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  footerActionPrimary: {
    backgroundColor: Colors.needleGreen,
  },
  footerActionSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  footerActionDestructive: {
    backgroundColor: Colors.error,
  },
  footerActionDisabled: {
    opacity: 0.56,
  },
  footerActionLabel: {
    flexShrink: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
    textAlign: 'center',
  },
  footerActionLabelSecondary: {
    color: Colors.ink,
  },
  footerActionLabelDestructive: {
    color: Colors.textInverse,
  },
})
