import { StyleSheet } from 'react-native'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

export const styles = StyleSheet.create({
  photoAddButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, borderWidth: 1, borderColor: Colors.needleGreen, borderRadius: Radius.full, paddingHorizontal: 15, paddingVertical: 10 },
  photoAddText: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  photoTile: { width: '47%', borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.white },
  photoImage: { width: '100%', aspectRatio: 1 },
  photoRemove: { flexDirection: 'row', alignItems: 'center', padding: 9 },
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  errorBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
  },
  errorBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  errorLink: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.boneDeep,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    minWidth: 60, alignItems: 'center',
  },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },

  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 25,
  },
  heroSub: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 20,
  },

  input: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  topErrorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.errorLight, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.error + '30',
  },
  topErrorText: { flex: 1, fontSize: FontSize.sm, color: Colors.error },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  measureModuleCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  measureModuleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  measureModuleIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  measureModuleTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  measureModuleSub: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  diaryCustomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  diaryCustomPill: {
    flexGrow: 1,
    minWidth: '45%',
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  diaryCustomLabel: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  diaryCustomValue: {
    marginTop: 2,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  addModuleRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: Colors.boneDeep,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  addModuleTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  addModuleSub: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  errorText: { fontSize: FontSize.xs, color: Colors.error, marginTop: 4 },
  inputError: { borderWidth: 1.5, borderColor: Colors.error },

  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  dateBtnText: { flex: 1, fontSize: FontSize.md, color: Colors.ink },
  datePlaceholder: { color: Colors.midGrey },

  dateModalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  dateModalCard: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingBottom: Spacing.xxxl,
  },
  dateModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.lightGrey,
  },
  dateModalTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  dateModalDone: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.needleGreen },

  passportCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.sm,
  },
  passportInfo: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  passportTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink },
  passportSub: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 19, marginTop: 2 },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    alignSelf: 'flex-start',
  },
  inviteBtnDisabled: { opacity: 0.7 },
  inviteBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
})

export const sectionStyles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  title: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.midGrey,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  body: { gap: Spacing.sm },
})

export const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.inkLight },
})

export const measureStyles = StyleSheet.create({
  cell: { width: '48%', gap: 6 },
  label: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.midGrey },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    gap: 4, ...Shadow.sm,
  },
  input: { flex: 1, fontSize: FontSize.md, color: Colors.ink },
  unit: { fontSize: FontSize.xs, color: Colors.midGrey, fontWeight: FontWeight.medium },
})

export const segStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowWrap: { flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
  },
  btnActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  label: { fontSize: FontSize.sm, color: Colors.midGrey, fontWeight: FontWeight.medium },
  labelActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
})
