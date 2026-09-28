import { Colors, Spacing } from '@/constants/theme'
import {
  TAILOR_TRUST_VIDEO_MAX_SECONDS,
  TAILOR_TRUST_VIDEO_MIN_SECONDS,
} from '@drape/shared/identity-trust'
import { Feather } from '@expo/vector-icons'
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  MAX_PORTFOLIO_VIDEO_SECONDS,
  SELLER_TYPE_OPTIONS,
  SUPPORTED_CURRENCIES,
} from './TailorSetupLimits'
import { styles } from './TailorSetupStyles'
import type {
  MediaSheetMode,
  PortfolioMediaSource,
  ProfilePhotoSource,
  SellerType,
  SetupChoiceSheetMode,
  TrustVideoSource,
} from './TailorSetupTypes'

export function SetupSelectorCard({
  meta,
  title,
  body,
  onPress,
  warning,
}: {
  meta: string
  title: string
  body: string
  onPress: () => void
  warning?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.selectorCard, warning && styles.selectorCardWarning]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.selectorCopy}>
        <Text style={[styles.selectorMeta, warning && styles.selectorMetaWarning]}>{meta}</Text>
        <Text style={styles.selectorTitle}>{title}</Text>
        <Text style={styles.selectorBody}>{body}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

export function SetupChoiceSheet({
  mode,
  onClose,
  sellerType,
  acceptsCustomOrdersNow,
  shopPaused,
  pickupAvailable,
  deliveryAvailable,
  shippingAvailable,
  currency,
  onSellerType,
  onToggleCustomOrdersNow,
  onToggleShopPaused,
  onTogglePickup,
  onToggleDelivery,
  onToggleShipping,
  onCurrency,
}: {
  mode: SetupChoiceSheetMode
  onClose: () => void
  sellerType: SellerType
  acceptsCustomOrdersNow: boolean
  shopPaused: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  currency: (typeof SUPPORTED_CURRENCIES)[number]
  onSellerType: (value: SellerType) => void
  onToggleCustomOrdersNow: () => void
  onToggleShopPaused: () => void
  onTogglePickup: () => void
  onToggleDelivery: () => void
  onToggleShipping: () => void
  onCurrency: (value: (typeof SUPPORTED_CURRENCIES)[number]) => void
}) {
  const insets = useSafeAreaInsets()
  const visible = mode !== null
  const sheetBottomPadding = Math.max(insets.bottom + Spacing.lg, Spacing.xxl)
  const title =
    mode === 'seller-type'
      ? 'Business type'
      : mode === 'capacity'
        ? 'Custom order status'
        : mode === 'shop-status'
          ? 'Ready-made shop status'
          : mode === 'fulfillment'
            ? 'Customer handoff'
            : 'Pricing currency'
  const body =
    mode === 'seller-type'
      ? 'Pick the description that best matches how your business works.'
      : mode === 'capacity'
        ? 'Pause or reopen custom brief requests without hiding your profile.'
        : mode === 'shop-status'
          ? 'Pause or reopen checkout for ready-made inventory.'
          : mode === 'fulfillment'
            ? 'Choose how customers receive orders. Drapeon coordinates delivery and shipping details with you.'
            : 'Choose the currency customers see on your public profile price guide.'
  const isMulti = mode === 'fulfillment'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity
              style={styles.sheetClose}
              onPress={onClose}
              accessibilityLabel="Close setup options"
            >
              <Text style={styles.sheetCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetBody}>{body}</Text>

          <ScrollView
            style={styles.sheetChoicesScroll}
            contentContainerStyle={styles.sheetChoicesContent}
            showsVerticalScrollIndicator={false}
          >
            {mode === 'seller-type'
              ? SELLER_TYPE_OPTIONS.map((item) => (
                  <ChoiceSheetRow
                    key={item.value}
                    title={item.label}
                    body={item.hint}
                    selected={sellerType === item.value}
                    onPress={() => onSellerType(item.value)}
                  />
                ))
              : null}

            {mode === 'capacity' ? (
              <>
                <ChoiceSheetRow
                  title="Taking custom orders"
                  body="Customers can send custom briefs for quotes."
                  selected={acceptsCustomOrdersNow}
                  onPress={onToggleCustomOrdersNow}
                />
                <ChoiceSheetRow
                  title="Custom orders paused"
                  body="Your profile stays visible, but custom brief requests are paused."
                  selected={!acceptsCustomOrdersNow}
                  onPress={onToggleCustomOrdersNow}
                />
              </>
            ) : null}

            {mode === 'shop-status' ? (
              <>
                <ChoiceSheetRow
                  title="Shop checkout open"
                  body="Customers can buy ready-made items when inventory is live."
                  selected={!shopPaused}
                  onPress={onToggleShopPaused}
                />
                <ChoiceSheetRow
                  title="Shop checkout paused"
                  body="Customers can browse your items, but checkout is paused."
                  selected={shopPaused}
                  onPress={onToggleShopPaused}
                />
              </>
            ) : null}

            {mode === 'fulfillment' ? (
              <>
                <ChoiceSheetRow
                  title="Pickup"
                  body="Customer collects from you or your shop."
                  selected={pickupAvailable}
                  onPress={onTogglePickup}
                  multi
                />
                <ChoiceSheetRow
                  title="Delivery"
                  body="Drapeon coordinates nearby delivery with you."
                  selected={deliveryAvailable}
                  onPress={onToggleDelivery}
                  multi
                />
                <ChoiceSheetRow
                  title="Shipping"
                  body="Drapeon coordinates courier shipping with you."
                  selected={shippingAvailable}
                  onPress={onToggleShipping}
                  multi
                />
              </>
            ) : null}

            {mode === 'currency'
              ? SUPPORTED_CURRENCIES.map((item) => (
                  <ChoiceSheetRow
                    key={item}
                    title={item}
                    body={
                      item === 'NGN'
                        ? 'Recommended for Nigerian pricing and local Paystack checkout.'
                        : 'Use this if it matches how you quote customers.'
                    }
                    selected={currency === item}
                    onPress={() => onCurrency(item)}
                  />
                ))
              : null}
          </ScrollView>

          {isMulti ? (
            <TouchableOpacity style={styles.sheetDoneButton} onPress={onClose}>
              <Text style={styles.sheetDoneButtonText}>Done</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function ChoiceSheetRow({
  title,
  body,
  selected,
  onPress,
  multi,
}: {
  title: string
  body: string
  selected: boolean
  onPress: () => void
  multi?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.choiceSheetRow, selected && styles.choiceSheetRowSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.choiceSheetMark, selected && styles.choiceSheetMarkSelected]}>
        <Text style={[styles.choiceSheetMarkText, selected && styles.choiceSheetMarkTextSelected]}>
          {selected ? '✓' : multi ? '+' : ''}
        </Text>
      </View>
      <View style={styles.choiceSheetText}>
        <Text style={styles.choiceSheetTitle}>{title}</Text>
        <Text style={styles.choiceSheetBody}>{body}</Text>
      </View>
    </TouchableOpacity>
  )
}

export function MediaChoiceSheet({
  mode,
  onClose,
  onProfilePhoto,
  onPortfolioMedia,
  onTrustVideo,
  videoLimitReached,
  trustChallengeText,
}: {
  mode: MediaSheetMode
  onClose: () => void
  onProfilePhoto: (source: ProfilePhotoSource) => void
  onPortfolioMedia: (source: PortfolioMediaSource) => void
  onTrustVideo: (source: TrustVideoSource) => void
  videoLimitReached: boolean
  trustChallengeText: string
}) {
  const insets = useSafeAreaInsets()
  const visible = mode !== null
  const sheetBottomPadding = Math.max(insets.bottom + Spacing.lg, Spacing.xxl)
  const title =
    mode === 'profile-photo'
      ? 'Profile photo'
      : mode === 'portfolio-media'
        ? 'Add portfolio media'
        : 'Private trust video'
  const body =
    mode === 'profile-photo'
      ? 'Use a clear face photo customers can recognize before they book you.'
      : mode === 'portfolio-media'
        ? 'Add real work samples. Photos build trust fastest; short videos help with movement and finish.'
        : `Record a ${TAILOR_TRUST_VIDEO_MIN_SECONDS}–${TAILOR_TRUST_VIDEO_MAX_SECONDS} second private challenge video. No government ID is needed.`

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <TouchableOpacity style={styles.sheetScrim} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity
              style={styles.sheetClose}
              onPress={onClose}
              accessibilityLabel="Close media options"
            >
              <Text style={styles.sheetCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetBody}>{body}</Text>

          {mode === 'profile-photo' ? (
            <>
              <SheetOption
                title="Take photo"
                body="Open camera and crop square."
                onPress={() => onProfilePhoto('camera')}
              />
              <SheetOption
                title="Choose from library"
                body="Use an existing photo from your phone."
                onPress={() => onProfilePhoto('library')}
              />
            </>
          ) : null}

          {mode === 'portfolio-media' ? (
            <>
              <SheetOption
                title="Take photo"
                body="Capture one fresh work sample."
                onPress={() => onPortfolioMedia('camera-photo')}
              />
              <SheetOption
                title="Choose from library"
                body="Select several photos or videos at once."
                onPress={() => onPortfolioMedia('library')}
              />
              <SheetOption
                title="Record short video"
                body={
                  videoLimitReached
                    ? 'Video limit reached for this portfolio.'
                    : `Record up to ${MAX_PORTFOLIO_VIDEO_SECONDS} seconds.`
                }
                onPress={() => onPortfolioMedia('camera-video')}
                disabled={videoLimitReached}
              />
            </>
          ) : null}

          {mode === 'trust-video' ? (
            <>
              <View style={styles.identityRejectedCardCompact}>
                <Text style={styles.identityRejectedTitle}>Your one-time phrase</Text>
                <Text style={styles.identityRejectedText}>{trustChallengeText}</Text>
              </View>
              <Text style={styles.sheetPrivacyCopy}>
                This clip stays private and is reviewed only for marketplace trust and account
                safety. Drapeon does not collect a government ID or create a biometric template.
              </Text>
              <SheetOption
                title="Open camera"
                body="Keep your face visible and say the full phrase clearly in one take."
                onPress={() => onTrustVideo('camera')}
              />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function SheetOption({
  title,
  body,
  onPress,
  disabled,
}: {
  title: string
  body: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.sheetOption, disabled && styles.sheetOptionDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <View style={styles.sheetOptionText}>
        <Text style={styles.sheetOptionTitle}>{title}</Text>
        <Text style={styles.sheetOptionBody}>{body}</Text>
      </View>
      <Text style={styles.sheetOptionChevron}>›</Text>
    </TouchableOpacity>
  )
}
