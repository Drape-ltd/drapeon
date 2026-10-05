import { StyleSheet } from 'react-native'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  editOverviewCard: {
    minHeight: 94, borderRadius: Radius.md, backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    ...Shadow.sm,
  },
  editOverviewCopy: { flex: 1, gap: 2 },
  editOverviewEyebrow: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase' },
  editOverviewName: { color: Colors.ink, fontFamily: Fonts.display, fontSize: FontSize.lg },
  editOverviewLocation: { color: Colors.inkLight, fontSize: FontSize.sm },
  editIntro: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.xs },
  editSectionToggle: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: 64, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: Colors.white,
    borderWidth: 1, borderColor: Colors.boneDeep,
  },
  editSectionToggleActive: { borderColor: Colors.needleGreen + '55' },
  editSectionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.needleGreenLight, alignItems: 'center', justifyContent: 'center' },
  editSectionCopy: { flex: 1, gap: 2 },
  editSectionTitle: { color: Colors.ink, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.sm },
  editSectionDetail: { color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 16 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.boneDeep,
    backgroundColor: Colors.bone,
  },
  headerTitle: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.ink, fontFamily: Fonts.display },
  saveBtn: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    minWidth: 60, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },

  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%', maxWidth: 440, backgroundColor: Colors.white,
    borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md,
    alignItems: 'center', ...Shadow.lg,
  },
  stateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center', fontFamily: Fonts.display },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  errorRetry: {
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl,
  },
  errorRetryText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorSecondary: {
    backgroundColor: Colors.white, borderColor: Colors.lightGrey,
    borderRadius: Radius.full, borderWidth: 1,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxxl,
  },
  errorSecondaryText: { color: Colors.ink, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 56 },

  // ── Identity card ──────────────────────────────────────────────────────────
  identityCard: {
    backgroundColor: Colors.white, borderRadius: Radius.xl,
    overflow: 'hidden', ...Shadow.md,
  },
  avatarSection: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.needleGreenLight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.needleGreen + '40',
  },
  avatarLoading: { opacity: 0.6 },
  avatarImage: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: Colors.needleGreen + '40' },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 20, height: 20, borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.white,
  },
  avatarHint: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.needleGreenDark },
  identityDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.boneDeep },
  identityInput: {
    fontSize: FontSize.lg, fontWeight: FontWeight.semibold,
    color: Colors.ink, fontFamily: Fonts.display,
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
  },
  identityInputSub: {
    fontSize: FontSize.md, fontWeight: FontWeight.regular,
    color: Colors.inkLight, fontFamily: Fonts.body,
  },
  identityInputError: { color: Colors.error },
  inlineError: { fontSize: FontSize.xs, color: Colors.error, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },

  // ── Bio card ───────────────────────────────────────────────────────────────
  bioCard: {
    backgroundColor: Colors.white, borderRadius: Radius.xl,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.md,
  },
  cardMicro: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  bioInput: {
    fontSize: FontSize.md, color: Colors.ink,
    minHeight: 96, textAlignVertical: 'top', lineHeight: 22,
    borderWidth: 1, borderColor: Colors.boneDeep,
    borderRadius: Radius.md, padding: Spacing.md,
  },
  bioInputError: { borderColor: Colors.error },
  bioFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bioPrompts: { flex: 1, gap: 3 },
  bioPromptItem: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  charCount: { fontSize: FontSize.xs, color: Colors.midGrey, textAlign: 'right' },

  // ── Generic list card ──────────────────────────────────────────────────────
  listCard: { backgroundColor: Colors.white, borderRadius: Radius.xl, overflow: 'hidden', ...Shadow.md },
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    minHeight: 64, gap: Spacing.md,
  },
  listRowError: { backgroundColor: Colors.error + '06' },
  listRowBody: { flex: 1, gap: 2 },
  listRowLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.ink },
  listRowValue: { fontSize: FontSize.sm, color: Colors.midGrey },
  listRowPlaceholder: { fontSize: FontSize.sm, color: Colors.lightGrey },
  listDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.boneDeep, marginHorizontal: Spacing.lg },

  // ── Section micro-label (above card groups) ────────────────────────────────
  sectionMicro: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.midGrey, textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: Spacing.xs, paddingTop: Spacing.xs,
  },

  // ── Seller type cards ──────────────────────────────────────────────────────
  sellerTypeRow: { flexDirection: 'row', gap: Spacing.sm },
  sellerCard: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.xl,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm,
    alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: 'transparent', ...Shadow.sm,
  },
  sellerCardActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  sellerLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight, textAlign: 'center' },
  sellerLabelActive: { color: Colors.needleGreen },
  sellerSub: { fontSize: 10, color: Colors.midGrey, textAlign: 'center' },

  // ── Service toggle rows ────────────────────────────────────────────────────
  serviceRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  serviceIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.bone, alignItems: 'center', justifyContent: 'center',
  },
  serviceIconWrapActive: { backgroundColor: Colors.needleGreenLight },
  serviceBody: { flex: 1, gap: 2 },
  serviceTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  serviceTitleActive: { color: Colors.ink },
  serviceHint: { fontSize: FontSize.xs, color: Colors.midGrey },
  serviceCheck: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  serviceCheckActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  statusChipRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  statusChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  statusChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  statusChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.midGrey },
  statusChipTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },

  // ── Availability rows ──────────────────────────────────────────────────────
  availRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.inkLight },
  availLabelActive: { color: Colors.ink },
  availHint: { fontSize: FontSize.xs, color: Colors.midGrey, marginTop: 1, lineHeight: 18 },

  // ── Delivery chips ─────────────────────────────────────────────────────────
  deliveryRow: { flexDirection: 'row', gap: Spacing.sm },
  deliveryChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: Spacing.md, borderRadius: Radius.xl,
    borderWidth: 1.5, borderColor: Colors.lightGrey,
    backgroundColor: Colors.white, ...Shadow.sm,
  },
  deliveryChipActive: { borderColor: Colors.needleGreen, backgroundColor: Colors.needleGreenLight },
  deliveryChipLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.midGrey },
  deliveryChipLabelActive: { color: Colors.needleGreen },

  // ── Pickup block ───────────────────────────────────────────────────────────
  pickupBlock: { gap: Spacing.sm },
  pickupNote: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18 },
  deliveryFeeNote: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 18, paddingHorizontal: Spacing.xs },
  focusedSection: {
    marginHorizontal: -Spacing.xs,
    paddingHorizontal: Spacing.xs,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '24',
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
  },
  focusedSectionIntro: {
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.md,
  },
  focusedSectionTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    color: Colors.ink,
  },
  focusedSectionBody: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    lineHeight: 21,
    color: Colors.inkLight,
  },
  input: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
    fontSize: FontSize.md, color: Colors.ink, ...Shadow.sm,
    borderWidth: 1, borderColor: Colors.boneDeep,
  },
  helperError: { fontSize: FontSize.xs, color: Colors.kanteRust, lineHeight: 18 },

  // ── Nav rows (portfolio + verification) ────────────────────────────────────
  navIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  verifyDot: { width: 8, height: 8, borderRadius: 4 },
  trustAction: { fontSize: FontSize.xs, color: Colors.needleGreen, fontWeight: FontWeight.semibold },

  // ── Location suggestions ───────────────────────────────────────────────────
  suggestBox: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.lightGrey,
    marginTop: 2, overflow: 'hidden', ...Shadow.sm,
  },
  suggestRow: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.lightGrey,
  },
  suggestRowLast: { borderBottomWidth: 0 },
  suggestText: { fontSize: FontSize.sm, color: Colors.ink },

  // ── Bottom sheets ──────────────────────────────────────────────────────────
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.34)' },
  specialtySheet: {
    maxHeight: '86%', backgroundColor: Colors.bone,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm, paddingHorizontal: Spacing.xl, gap: Spacing.md, ...Shadow.lg,
  },
  sheetHandle: {
    width: 42, height: 4, borderRadius: Radius.full,
    backgroundColor: Colors.lightGrey, alignSelf: 'center',
  },
  specialtySheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  specialtySheetTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, fontFamily: Fonts.display },
  specialtySheetSubtitle: { fontSize: FontSize.sm, color: Colors.midGrey, lineHeight: 20 },
  sheetClose: {
    width: 36, height: 36, borderRadius: Radius.full,
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.lightGrey,
    alignItems: 'center', justifyContent: 'center',
  },
  specialtySheetScroll: { marginHorizontal: -Spacing.xs },
  specialtySheetContent: { paddingHorizontal: Spacing.xs, paddingBottom: Spacing.md },
  selectorSummaryText: { flex: 1, gap: 3 },
})
