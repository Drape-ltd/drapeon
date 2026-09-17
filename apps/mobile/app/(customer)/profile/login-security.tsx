/**
 * Login & Security
 *
 * Change password + biometric lock toggle.
 *
 * Security model:
 *   Before the password-change form is shown the user must re-authenticate
 *   via biometric (if enabled + available) or their current password.
 *   This prevents "shoulder surfing" password changes on an unlocked device.
 */

import { useCallback, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import {
  changePasswordWithReauthProof,
  startEmailChangeWithReauthProof,
} from '@/lib/account-security-actions'
import { useAuth } from '@/lib/auth'
import { goBackOrFallback } from '@/lib/navigation'
import {
  isBiometricAvailable,
  getBiometricLabel,
  isBiometricEnabled,
  setBiometricEnabled,
  authenticate,
} from '@/lib/biometric'
import {
  issueReauthProof,
  sendReauthEmailChallenge,
  verifyReauthEmailChallenge,
  type ReauthEmailChallenge,
} from '@/lib/reauth-proof'
import { ConnectedSignInMethods } from '@/components/profile/ConnectedSignInMethods'
import { Input } from '@/components/ui'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_POLICY_HINT,
  validatePasswordStrength,
} from '@drape/shared/auth-security'
import { validateEmail } from '@drape/shared'

type Step = 'reauth' | 'change'
type ActivePanel = 'email' | 'password' | null

export default function LoginSecurityScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()

  // ── Re-auth gate ─────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('reauth')
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthLoading, setReauthLoading] = useState(false)
  const [passwordReauthProof, setPasswordReauthProof] = useState<string | null>(null)
  const [passwordProofExpiresAt, setPasswordProofExpiresAt] = useState<string | null>(null)
  const [passwordEmailChallenge, setPasswordEmailChallenge] = useState<ReauthEmailChallenge | null>(
    null
  )
  const [passwordEmailCode, setPasswordEmailCode] = useState('')

  // ── Password change ──────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  // ── Email change ────────────────────────────────────────────────────────
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailChallenge, setEmailChallenge] = useState<ReauthEmailChallenge | null>(null)
  const [emailCode, setEmailCode] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)

  // ── Biometric toggle ─────────────────────────────────────────────────────
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricLabel, setBiometricLabel] = useState('Biometrics')
  const [biometricEnabled, setBiometricEnabledState] = useState(false)
  const [togglingBiometric, setTogglingBiometric] = useState(false)
  const accountProviders = new Set([
    ...(Array.isArray(user?.identities)
      ? user.identities.map((identity) => identity.provider)
      : []),
    ...(Array.isArray(user?.app_metadata?.providers)
      ? user.app_metadata.providers.filter(
          (provider): provider is string => typeof provider === 'string'
        )
      : []),
  ])
  const passwordConnected = accountProviders.has('email')
  const newPasswordError = newPassword
    ? (validatePasswordStrength(newPassword, { forbiddenValues: [user?.email] }) ?? '')
    : ''
  const currentEmail = user?.email?.trim().toLowerCase() ?? ''
  const normalizedNewEmail = newEmail.trim().toLowerCase()
  const newEmailError =
    newEmail.trim().length === 0
      ? ''
      : !validateEmail(normalizedNewEmail)
        ? 'Please enter a valid email address.'
        : normalizedNewEmail === currentEmail
          ? 'Enter a different email address.'
          : ''

  useFocusEffect(
    useCallback(() => {
      setStep('reauth')
      setReauthPassword('')
      setPasswordReauthProof(null)
      setPasswordProofExpiresAt(null)
      setPasswordEmailChallenge(null)
      setPasswordEmailCode('')
      setEmailChallenge(null)
      setEmailCode('')
      setActivePanel(null)
      async function checkBiometric() {
        const available = await isBiometricAvailable()
        setBiometricAvailable(available)
        if (available) {
          setBiometricLabel(await getBiometricLabel())
          const enabled = await isBiometricEnabled()
          setBiometricEnabledState(enabled)
        }
      }
      checkBiometric()
    }, [])
  )

  // ── Re-auth via password or account email ────────────────────────────────
  async function reauthWithPassword() {
    if (reauthLoading) return
    if (passwordConnected && !reauthPassword) {
      Alert.alert('Required', 'Enter your current password to continue.')
      return
    }
    if (!passwordConnected && passwordEmailChallenge && !/^\d{6}$/.test(passwordEmailCode)) {
      Alert.alert('Code required', 'Enter the six-digit code from your email.')
      return
    }
    setReauthLoading(true)
    if (!passwordConnected && !passwordEmailChallenge) {
      const issued = await sendReauthEmailChallenge('PASSWORD_CHANGE')
      setReauthLoading(false)
      if (issued.error || !issued.challenge) {
        Alert.alert('Could not send code', issued.error ?? 'Please try again.')
        return
      }
      setPasswordEmailChallenge(issued.challenge)
      setPasswordEmailCode('')
      Alert.alert(
        'Check your email',
        `We sent a six-digit confirmation code to ${issued.challenge.maskedEmail}.`
      )
      return
    }
    const result = passwordConnected
      ? await issueReauthProof({
          password: reauthPassword,
          purpose: 'PASSWORD_CHANGE',
        })
      : await verifyReauthEmailChallenge({
          purpose: 'PASSWORD_CHANGE',
          challengeId: passwordEmailChallenge!.challengeId,
          code: passwordEmailCode,
        })
    setReauthLoading(false)
    if (result.error) {
      Alert.alert(
        passwordConnected && result.error.toLowerCase().includes('incorrect')
          ? 'Incorrect password'
          : 'Could not confirm identity',
        result.error
      )
    } else {
      setPasswordReauthProof(result.proof ?? null)
      setPasswordProofExpiresAt(result.expiresAt ?? null)
      setReauthPassword('')
      setPasswordEmailChallenge(null)
      setPasswordEmailCode('')
      setStep('change')
    }
  }

  // ── Change password ──────────────────────────────────────────────────────
  async function changePassword() {
    if (savingPassword) return
    if (newPasswordError) {
      Alert.alert('Password issue', newPasswordError)
      return
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.')
      return
    }
    if (!passwordReauthProof) {
      setStep('reauth')
      Alert.alert(
        'Confirm current password',
        'Confirm your current password again before changing it.'
      )
      return
    }
    setSavingPassword(true)
    const result = await changePasswordWithReauthProof({
      reauthProof: passwordReauthProof,
      newPassword,
    })
    setSavingPassword(false)
    if (result.error) {
      if (result.error.toLowerCase().includes('expired')) {
        setStep('reauth')
        setPasswordReauthProof(null)
        setPasswordProofExpiresAt(null)
      }
      Alert.alert('Could not change password', result.error)
    } else {
      Alert.alert(
        passwordConnected ? 'Password changed' : 'Password created',
        result.emailQueued
          ? `${passwordConnected ? 'Your password has been updated' : 'Your password is ready'}. We also sent a security receipt to your email.`
          : passwordConnected
            ? 'Your password has been updated successfully.'
            : 'Your password is ready. You can now use email and password to sign in too.'
      )
      setNewPassword('')
      setConfirmPassword('')
      setPasswordReauthProof(null)
      setPasswordProofExpiresAt(null)
      setStep('reauth') // reset gate after success
      setActivePanel(null)
    }
  }

  async function changeEmail() {
    if (savingEmail) return
    if (!currentEmail) {
      Alert.alert(
        'Email unavailable',
        'We could not find the current email for this session. Sign out and sign back in, then try again.'
      )
      return
    }
    if (!normalizedNewEmail || newEmailError) {
      Alert.alert('Invalid email', newEmailError || 'Please enter a valid email address.')
      return
    }
    if (passwordConnected && !emailPassword) {
      Alert.alert(
        'Current password required',
        'Enter your current password before changing your email.'
      )
      return
    }
    if (!passwordConnected && emailChallenge && !/^\d{6}$/.test(emailCode)) {
      Alert.alert('Code required', 'Enter the six-digit code from your email.')
      return
    }

    setSavingEmail(true)
    if (!passwordConnected && !emailChallenge) {
      const issued = await sendReauthEmailChallenge('EMAIL_CHANGE')
      setSavingEmail(false)
      if (issued.error || !issued.challenge) {
        Alert.alert('Could not send code', issued.error ?? 'Please try again.')
        return
      }
      setEmailChallenge(issued.challenge)
      setEmailCode('')
      Alert.alert(
        'Check your email',
        `We sent a six-digit confirmation code to ${issued.challenge.maskedEmail}.`
      )
      return
    }
    const proofResult = passwordConnected
      ? await issueReauthProof({
          password: emailPassword,
          purpose: 'EMAIL_CHANGE',
        })
      : await verifyReauthEmailChallenge({
          purpose: 'EMAIL_CHANGE',
          challengeId: emailChallenge!.challengeId,
          code: emailCode,
        })
    if (proofResult.error) {
      setSavingEmail(false)
      Alert.alert(
        passwordConnected && proofResult.error.toLowerCase().includes('incorrect')
          ? 'Incorrect password'
          : 'Could not confirm identity',
        proofResult.error
      )
      return
    }

    if (!proofResult.proof) {
      setSavingEmail(false)
      Alert.alert(
        'Could not confirm identity',
        'Confirm your identity again before changing your email.'
      )
      return
    }

    const emailResult = await startEmailChangeWithReauthProof({
      reauthProof: proofResult.proof,
      newEmail: normalizedNewEmail,
    })
    setSavingEmail(false)

    if (emailResult.error) {
      Alert.alert('Could not change email', emailResult.error)
      return
    }

    Alert.alert(
      'Check both inboxes',
      'We sent confirmation links to your current and new email addresses. Your Drapeon email changes only after the confirmation step is complete.'
    )
    setNewEmail('')
    setEmailPassword('')
    setEmailChallenge(null)
    setEmailCode('')
    setActivePanel(null)
  }

  // ── Biometric toggle ─────────────────────────────────────────────────────
  async function toggleBiometric(value: boolean) {
    try {
      setTogglingBiometric(true)
      if (value) {
        const ok = await authenticate(`Confirm ${biometricLabel} to enable it for Drapeon`)
        if (!ok) return
      }
      await setBiometricEnabled(value)
      setBiometricEnabledState(value)
    } catch {
      Alert.alert(
        'Could not update setting',
        `We couldn't update ${biometricLabel} just now. Your current lock setting has not changed.`
      )
    } finally {
      setTogglingBiometric(false)
    }
  }

  function goBack() {
    goBackOrFallback(router, navigation, '/(customer)/profile/account-settings')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Login & security</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* ── Biometric toggle (always visible) ── */}
        {biometricAvailable && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'Fingerprint'}
            </Text>
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Use {biometricLabel}</Text>
                  <Text style={styles.toggleSub}>
                    Lock Drapeon after 5 minutes in the background. {biometricLabel} will unlock it
                    instantly.
                  </Text>
                </View>
                {togglingBiometric ? (
                  <ActivityIndicator color={Colors.needleGreen} />
                ) : (
                  <Switch
                    value={biometricEnabled}
                    onValueChange={toggleBiometric}
                    trackColor={{ false: Colors.lightGrey, true: Colors.needleGreen }}
                    thumbColor={Colors.textInverse}
                  />
                )}
              </View>
            </View>
          </View>
        )}

        <ConnectedSignInMethods />

        {/* ── Account access ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Access</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={0.7}
              onPress={() => setActivePanel(activePanel === 'email' ? null : 'email')}
            >
              <View style={styles.actionIcon}>
                <Feather name="mail" size={18} color={Colors.needleGreen} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>Email address</Text>
                <Text style={styles.actionSub}>{currentEmail || 'Unavailable'}</Text>
              </View>
              <Text style={styles.actionLink}>{activePanel === 'email' ? 'Close' : 'Change'}</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={0.7}
              onPress={() => setActivePanel(activePanel === 'password' ? null : 'password')}
            >
              <View style={styles.actionIcon}>
                <Feather name="lock" size={18} color={Colors.needleGreen} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>Password</Text>
                <Text style={styles.actionSub}>
                  {passwordConnected
                    ? 'Confirm current password before changing it.'
                    : 'Create a password after confirming your account email.'}
                </Text>
              </View>
              <Text style={styles.actionLink}>
                {activePanel === 'password' ? 'Close' : passwordConnected ? 'Change' : 'Create'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {activePanel === 'email' ? (
          <View style={styles.revealSection}>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>New email address</Text>
                <Input
                  value={newEmail}
                  onChangeText={setNewEmail}
                  placeholder="name@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  autoComplete="email"
                  returnKeyType="next"
                  error={newEmailError}
                />
              </View>
              <View style={styles.divider} />
              {passwordConnected ? (
                <View style={styles.field}>
                  <Text style={styles.label}>Current password</Text>
                  <Input
                    value={emailPassword}
                    onChangeText={setEmailPassword}
                    placeholder="Confirm current password"
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                    maxLength={MAX_PASSWORD_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={changeEmail}
                  />
                </View>
              ) : (
                <View style={styles.field}>
                  <Text style={styles.label}>
                    {emailChallenge
                      ? `Confirmation code sent to ${emailChallenge.maskedEmail}`
                      : 'Confirm with your account email'}
                  </Text>
                  {emailChallenge ? (
                    <Input
                      value={emailCode}
                      onChangeText={(value) => setEmailCode(value.replace(/\D/gu, '').slice(0, 6))}
                      placeholder="000000"
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      returnKeyType="done"
                      onSubmitEditing={changeEmail}
                    />
                  ) : (
                    <Text style={styles.fieldHint}>
                      We will email a six-digit code before changing your address.
                    </Text>
                  )}
                </View>
              )}
              <View style={styles.emailNotice}>
                <Feather name="mail" size={16} color={Colors.needleGreen} />
                <Text style={styles.emailNoticeText}>
                  We will confirm the change before your account email updates.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.saveBtn,
                (savingEmail ||
                  !normalizedNewEmail ||
                  !!newEmailError ||
                  (passwordConnected
                    ? !emailPassword
                    : Boolean(emailChallenge) && emailCode.length !== 6)) &&
                  styles.saveBtnDisabled,
              ]}
              onPress={changeEmail}
              disabled={
                savingEmail ||
                !normalizedNewEmail ||
                !!newEmailError ||
                (passwordConnected
                  ? !emailPassword
                  : Boolean(emailChallenge) && emailCode.length !== 6)
              }
            >
              {savingEmail ? (
                <ActivityIndicator color={Colors.textInverse} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {!passwordConnected && !emailChallenge
                    ? 'Send confirmation code'
                    : emailChallenge
                      ? 'Verify code and continue'
                      : 'Send confirmation'}
                </Text>
              )}
            </TouchableOpacity>
            {!passwordConnected && emailChallenge ? (
              <TouchableOpacity
                style={styles.secondaryAction}
                disabled={savingEmail}
                onPress={() => {
                  setEmailChallenge(null)
                  setEmailCode('')
                }}
              >
                <Text style={styles.secondaryActionText}>Send a new code</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {activePanel === 'password' ? (
          <View style={styles.revealSection}>
            {step === 'reauth' ? (
              // Re-auth gate — must verify identity before seeing the form
              <>
                <View style={styles.card}>
                  <View style={styles.field}>
                    <Text style={styles.label}>
                      {passwordConnected
                        ? 'Current password'
                        : passwordEmailChallenge
                          ? `Confirmation code sent to ${passwordEmailChallenge.maskedEmail}`
                          : 'Confirm with your account email'}
                    </Text>
                    {passwordConnected ? (
                      <Input
                        value={reauthPassword}
                        onChangeText={setReauthPassword}
                        placeholder="Enter current password"
                        secureTextEntry
                        textContentType="password"
                        autoComplete="current-password"
                        maxLength={MAX_PASSWORD_LENGTH}
                        returnKeyType="done"
                        onSubmitEditing={reauthWithPassword}
                      />
                    ) : passwordEmailChallenge ? (
                      <Input
                        value={passwordEmailCode}
                        onChangeText={(value) =>
                          setPasswordEmailCode(value.replace(/\D/gu, '').slice(0, 6))
                        }
                        placeholder="000000"
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        maxLength={6}
                        returnKeyType="done"
                        onSubmitEditing={reauthWithPassword}
                      />
                    ) : (
                      <Text style={styles.fieldHint}>
                        We will email a six-digit code before creating your password.
                      </Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    (reauthLoading ||
                      (!passwordConnected &&
                        Boolean(passwordEmailChallenge) &&
                        passwordEmailCode.length !== 6)) &&
                      styles.saveBtnDisabled,
                  ]}
                  onPress={reauthWithPassword}
                  disabled={
                    reauthLoading ||
                    (!passwordConnected &&
                      Boolean(passwordEmailChallenge) &&
                      passwordEmailCode.length !== 6)
                  }
                >
                  {reauthLoading ? (
                    <ActivityIndicator color={Colors.textInverse} size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {!passwordConnected && !passwordEmailChallenge
                        ? 'Send confirmation code'
                        : passwordEmailChallenge
                          ? 'Verify code'
                          : 'Continue'}
                    </Text>
                  )}
                </TouchableOpacity>
                {!passwordConnected && passwordEmailChallenge ? (
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    disabled={reauthLoading}
                    onPress={() => {
                      setPasswordEmailChallenge(null)
                      setPasswordEmailCode('')
                    }}
                  >
                    <Text style={styles.secondaryActionText}>Send a new code</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              // Identity confirmed — show the change-password form
              <>
                <View style={styles.card}>
                  <View style={styles.confirmedRow}>
                    <View style={styles.confirmedIcon}>
                      <Feather name="check" size={13} color={Colors.needleGreen} />
                    </View>
                    <Text style={styles.confirmedText}>
                      {passwordProofExpiresAt
                        ? 'Identity confirmed for 5 minutes'
                        : 'Identity confirmed'}
                    </Text>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>New password</Text>
                    <Input
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="10+ characters"
                      secureTextEntry
                      textContentType="newPassword"
                      autoComplete="new-password"
                      maxLength={MAX_PASSWORD_LENGTH}
                      returnKeyType="next"
                    />
                    <Text style={newPasswordError ? styles.fieldError : styles.fieldHint}>
                      {newPasswordError || PASSWORD_POLICY_HINT}
                    </Text>
                  </View>
                  <View style={styles.divider} />
                  <View style={styles.field}>
                    <Text style={styles.label}>Confirm new password</Text>
                    <Input
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder="Repeat new password"
                      secureTextEntry
                      textContentType="newPassword"
                      autoComplete="new-password"
                      maxLength={MAX_PASSWORD_LENGTH}
                      returnKeyType="done"
                    />
                    {confirmPassword && newPassword !== confirmPassword ? (
                      <Text style={styles.fieldError}>Passwords do not match.</Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    (savingPassword ||
                      !newPassword ||
                      !confirmPassword ||
                      !!newPasswordError ||
                      newPassword !== confirmPassword) &&
                      styles.saveBtnDisabled,
                  ]}
                  onPress={changePassword}
                  disabled={
                    savingPassword ||
                    !newPassword ||
                    !confirmPassword ||
                    !!newPasswordError ||
                    newPassword !== confirmPassword
                  }
                >
                  {savingPassword ? (
                    <ActivityIndicator color={Colors.textInverse} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.saveBtnText,
                        (!newPassword ||
                          !confirmPassword ||
                          !!newPasswordError ||
                          newPassword !== confirmPassword) &&
                          styles.saveBtnTextDisabled,
                      ]}
                    >
                      {passwordConnected ? 'Change password' : 'Create password'}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  headerTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  body: { padding: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm },
  guideCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  guideEyebrow: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  guideTitle: {
    fontSize: FontSize.md,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
    lineHeight: 22,
  },
  guideCopy: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
  },

  section: { gap: 8 },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  revealSection: { gap: 8, marginTop: -2 },

  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.lightGrey,
    marginHorizontal: Spacing.md,
  },
  actionRow: {
    minHeight: 72,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen + '12',
  },
  actionCopy: { flex: 1, gap: 2 },
  actionTitle: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  actionSub: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  actionLink: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  field: { padding: Spacing.md, gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
  fieldHint: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  fieldError: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 18 },
  currentEmailBox: { padding: Spacing.md, gap: 4 },
  currentEmailLabel: {
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  currentEmailText: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.medium },
  emailNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    margin: Spacing.md,
    marginTop: 0,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreen + '10',
  },
  emailNoticeText: { flex: 1, fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },

  // Re-auth gate
  gateWrap: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  gateField: { width: '100%' },
  gateSaveBtn: { alignSelf: 'stretch' },
  gateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  gateSub: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.needleGreen,
    marginBottom: Spacing.sm,
  },
  biometricBtnText: {
    fontSize: FontSize.md,
    color: Colors.needleGreen,
    fontWeight: FontWeight.medium,
  },

  confirmedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  confirmedIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  confirmedText: { fontSize: FontSize.xs, color: Colors.inkLight, fontWeight: FontWeight.semibold },

  saveBtn: {
    backgroundColor: Colors.needleGreen,
    borderRadius: Radius.lg,
    padding: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: Colors.disabledFill,
    borderColor: Colors.disabledFill,
  },
  saveBtnText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textInverse,
  },
  saveBtnTextDisabled: { color: Colors.disabledText },
  secondaryAction: { alignItems: 'center', paddingVertical: Spacing.sm },
  secondaryActionText: {
    fontSize: FontSize.sm,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  toggleTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.ink,
    marginBottom: 4,
  },
  toggleSub: { fontSize: FontSize.sm, color: Colors.inkLight, lineHeight: 20 },

  infoNote: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'center', lineHeight: 18 },
})
