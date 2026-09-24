import type {
  AccountBaseData,
  AccountShellData,
  CheckoutSurfaceData,
  EarningsSurfaceData,
  ExploreSurfaceData,
  ItemDetailSurfaceData,
  MessagesSurfaceData,
  OrderDetailSurfaceData,
  OrdersSurfaceData,
  ProfileSurfaceData,
  SavedSurfaceData,
  SettingsSurfaceData,
  ShopSurfaceData,
  SupportSurfaceData,
  WorkSurfaceData,
} from './account-data-contracts'

export const emptyData: AccountBaseData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  warning: null,
}

export const emptyShellData: AccountShellData = {
  userId: null,
  accountCurrency: null,
  customerProfile: null,
  tailorProfile: null,
  pickupDetails: null,
  activeOrderCount: 0,
  customerActiveOrderCount: 0,
  tailorActiveOrderCount: 0,
  unreadCount: 0,
  checkoutPendingCount: 0,
  payoutNeedsSetup: false,
  warning: null,
}

export const emptyExploreSurfaceData: ExploreSurfaceData = {
  exploreTailors: [],
  exploreItems: [],
  warning: null,
}

export const emptyOrdersSurfaceData: OrdersSurfaceData = {
  orders: [],
  payments: [],
  messages: [],
  consultationAttendanceReviews: [],
  warning: null,
}

export const emptyOrderDetailSurfaceData: OrderDetailSurfaceData = {
  order: null,
  payments: [],
  receipts: [],
  settlementPlan: null,
  settlementTranches: [],
  providerDisputes: [],
  messages: [],
  stageUpdates: [],
  productionEvidence: [],
  materialAdvances: [],
  commercialAdjustments: [],
  returnRequests: [],
  resolutionProposals: [],
  benefitReservations: [],
  tips: [],
  customOrderDetail: null,
  reviews: [],
  quotes: [],
  quoteRevisions: [],
  orderEvents: [],
  consultationBooking: null,
  warning: null,
}

export const emptySupportSurfaceData: SupportSurfaceData = {
  orders: [],
  warning: null,
}

export const emptyShopSurfaceData: ShopSurfaceData = {
  sellerItems: [],
  exploreItems: [],
  warning: null,
}

export const emptyWorkSurfaceData: WorkSurfaceData = {
  orders: [],
  payments: [],
  sellerItems: [],
  warning: null,
}

export const emptyCheckoutSurfaceData: CheckoutSurfaceData = {
  orders: [],
  payments: [],
  receipts: [],
  quotes: [],
  warning: null,
}

export const emptyEarningsSurfaceData: EarningsSurfaceData = {
  payouts: [],
  bankActivity: [],
  orders: [],
  warning: null,
}

export const emptyProfileSurfaceData: ProfileSurfaceData = {
  sellerItems: [],
  portfolioItems: [],
  portfolioMedia: [],
  warning: null,
}

export const emptySettingsSurfaceData: SettingsSurfaceData = {
  orderCurrencies: [],
  warning: null,
}

export const emptyItemDetailSurfaceData: ItemDetailSurfaceData = {
  item: null,
  warning: null,
}

export const emptyMessagesSurfaceData: MessagesSurfaceData = {
  orders: [],
  messages: [],
  reactions: [],
  quotes: [],
  quoteRevisions: [],
  orderEvents: [],
  consultationBookings: [],
  warning: null,
}

export const emptySavedSurfaceData: SavedSurfaceData = {
  wishlistCollections: [],
  wishlistItems: [],
  savedTailors: [],
  savedItems: [],
  warning: null,
}
