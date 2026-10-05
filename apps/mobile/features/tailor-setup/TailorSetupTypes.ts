import type { AvatarImageSource } from '@/lib/avatar-picker'

export type SellerType = 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
export type ProfilePhotoSource = AvatarImageSource
export type PortfolioMediaSource = 'camera-photo' | 'camera-video' | 'library'
export type TrustVideoSource = 'camera'
export type PortfolioItem = { type: 'photo' | 'video'; url: string }
export type MediaSheetMode = 'profile-photo' | 'portfolio-media' | 'trust-video' | null
export type SetupChoiceSheetMode =
  | 'seller-type'
  | 'capacity'
  | 'shop-status'
  | 'fulfillment'
  | 'currency'
  | null
export type PortfolioGridEntry = { item: PortfolioItem; originalIndex: number }
export type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
export type SetupView = 'hub' | 'section'
export type SetupToast = { type: 'success' | 'error'; message: string }
