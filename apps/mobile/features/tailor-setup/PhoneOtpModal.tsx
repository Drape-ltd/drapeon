import { Button } from '@/components/ui'
import { Colors } from '@/constants/theme'
import { Feather } from '@expo/vector-icons'
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { styles } from './TailorSetupStyles'

export function PhoneOtpModal({
  visible,
  phone,
  code,
  error,
  sending,
  verifying,
  onChangeCode,
  onVerify,
  onResend,
  onClose,
}: {
  visible: boolean
  phone: string
  code: string
  error: string
  sending: boolean
  verifying: boolean
  onChangeCode: (value: string) => void
  onVerify: () => void
  onResend: () => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.otpOverlay}>
        <TouchableOpacity style={styles.otpScrim} activeOpacity={1} onPress={onClose} />
        <View style={styles.otpCard}>
          <View style={styles.otpHeader}>
            <View style={styles.otpIcon}>
              <Feather name="shield" size={18} color={Colors.needleGreen} />
            </View>
            <TouchableOpacity
              style={styles.otpClose}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close phone verification"
            >
              <Feather name="x" size={20} color={Colors.midGrey} />
            </TouchableOpacity>
          </View>
          <Text style={styles.otpTitle}>Verify phone number</Text>
          <Text style={styles.otpBody}>
            Enter the 6-digit code sent to {phone}. This keeps random numbers off Drapeon accounts.
          </Text>
          <TextInput
            value={code}
            onChangeText={onChangeCode}
            placeholder="000000"
            placeholderTextColor={Colors.midGrey}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            style={[styles.otpInput, !!error && styles.otpInputError]}
            accessibilityLabel="Phone verification code"
            editable={!verifying}
            autoFocus
          />
          {!!error && (
            <Text style={styles.otpError} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <View style={styles.otpActions}>
            <Button
              label="Verify code"
              onPress={onVerify}
              loading={verifying}
              disabled={verifying || sending || code.length !== 6}
            />
            <Button
              label={sending ? 'Sending...' : 'Resend code'}
              onPress={onResend}
              variant="secondary"
              size="md"
              loading={sending}
              disabled={sending || verifying}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}
