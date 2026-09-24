'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Archive, Search, ShoppingBag, SlidersHorizontal, Users } from 'lucide-react'
import { friendlyActionError } from '@drape/shared/action-errors'
import { currencySymbol, normalizeAccountCurrency, formatMoney, formatRelative } from '@drape/shared'
import { isVideoMediaUrl } from '@drape/shared/media-policy'
import { safeEntityName, safeUserText } from '../../../lib/safe-display'
import type { ExploreRenderData, ItemDetailRenderData, JoinedProfile, SavedSurfaceData, SellerItem, TailorDetailSurfaceData, TailorProfile } from '../shared/account-data-contracts'
import { invokeAccountFunction, removeSavedTailorDirectly, saveTailorDirectly, stringList, uniqueValues } from '../shared/account-data-queries'
import { ActionNotice, EmptyState, MutedVideo, accountRoute, cleanLabel, firstJoinedRow, safeMediaUrl } from '../messages/account-messages-surface'
import { useAccountContext } from '../../../components/account-context'
import { OpenAppButton } from '../../../components/open-app-button'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { MediaViewerDialog } from '../../../components/ui/media-viewer-dialog'
import { MetricCard } from '../../../components/ui/metric-card'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { PhotoTile } from '../orders/account-order-actions'
import { fulfillmentSummary, isReadyMadeBuyableOnWeb, itemPhoto, readyMadeInventoryCount } from '../shop/account-shop-surface'
import { ReadyMadeCheckoutForm, sizeGuideSummary } from '../checkout/ready-made-checkout-form'

function safeList(value: string[] | null | undefined, fallback = 'Not listed') {
  const cleaned = stringList(value)
    .map((entry) => safeUserText(entry))
    .filter(Boolean)
  return cleaned.length > 0 ? cleaned.join(', ') : fallback
}

function tailorPhoto(tailor: TailorProfile) {
  return (
    stringList(tailor.portfolio_photo_urls)
      .map((src) => safeMediaUrl(src, 'portfolio-photos'))
      .find(Boolean) ??
    safeMediaUrl(tailor.avatar_url, 'avatars') ??
    null
  )
}

function tailorProfileMedia(tailor: TailorProfile) {
  const primaryPhoto = tailorPhoto(tailor)
  const portfolioPhotos = stringList(tailor.portfolio_photo_urls)
    .map((src) => safeMediaUrl(src, 'portfolio-photos'))
    .filter((src): src is string => !!src)
  const portfolioVideos = stringList(tailor.portfolio_video_urls)
    .map((src) => safeMediaUrl(src, 'portfolio-photos'))
    .filter((src): src is string => !!src)

  return uniqueValues([primaryPhoto, ...portfolioPhotos, ...portfolioVideos])
}

function priceRange(tailor: TailorProfile) {
  if (typeof tailor.price_range_min !== 'number' && typeof tailor.price_range_max !== 'number')
    return 'Pricing set in quote'
  if (typeof tailor.price_range_min === 'number' && typeof tailor.price_range_max === 'number') {
    return `${formatMoney(tailor.price_range_min, tailor.currency)} - ${formatMoney(tailor.price_range_max, tailor.currency)}`
  }
  return formatMoney(tailor.price_range_min ?? tailor.price_range_max, tailor.currency)
}

function canStartCustomBriefOnWeb(tailor: TailorProfile, userId: string | null) {
  return (
    tailor.is_live === true &&
    tailor.supports_custom_orders === true &&
    tailor.accepts_custom_orders_now !== false &&
    tailor.availability !== 'FULLY_BOOKED' &&
    tailor.user_id !== userId
  )
}

function customBriefUnavailableLabel(tailor: TailorProfile, userId: string | null) {
  if (tailor.user_id === userId) return 'Your tailor profile'
  if (tailor.accepts_custom_orders_now === false) return 'Custom orders paused'
  if (tailor.availability === 'FULLY_BOOKED') return 'Fully booked'
  if (tailor.is_live !== true || tailor.supports_custom_orders !== true)
    return 'Custom orders unavailable'
  return 'Custom orders unavailable'
}

function readyMadeUnavailableLabel(item: SellerItem, tailor: JoinedProfile | null) {
  const stockStatus = (item.stock_status ?? 'IN_STOCK').toUpperCase()
  if (tailor?.is_live !== true) return 'Seller unavailable'
  if (tailor?.shop_paused === true) return 'Shop paused'
  if (item.is_live !== true || stockStatus === 'HIDDEN') return 'Unavailable'
  if (stockStatus === 'SOLD_OUT' || readyMadeInventoryCount(item) <= 0) return 'Sold out'
  return 'Unavailable'
}

function stockCopy(item: SellerItem) {
  const inventoryQuantity = readyMadeInventoryCount(item)
  const stockStatus = (item.stock_status ?? 'IN_STOCK').toUpperCase()
  if (item.is_live !== true || stockStatus === 'HIDDEN') return 'No longer available'
  if (stockStatus === 'SOLD_OUT' || inventoryQuantity <= 0) return 'Sold out'
  if (inventoryQuantity === 1) return '1 left'
  if (inventoryQuantity > 1) {
    return `${inventoryQuantity} left`
  }
  return cleanLabel(item.stock_status, 'In stock')
}

export function RenderExplore({ data }: { data: ExploreRenderData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasInitialFilters = searchParams.toString().length > 0
  const initialSort = searchParams.get('sort')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(hasInitialFilters)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [specialty, setSpecialty] = useState(searchParams.get('specialty') ?? 'all')
  const [location, setLocation] = useState(searchParams.get('location') ?? 'all')
  const [availability, setAvailability] = useState(searchParams.get('availability') ?? 'all')
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') ?? '')
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') ?? '')
  const [sort, setSort] = useState(initialSort === 'recent' ? 'popular' : (initialSort ?? 'rating'))
  const [customOnly, setCustomOnly] = useState(searchParams.get('custom') === '1')
  const specialties = uniqueValues(
    data.exploreTailors.flatMap((tailor) => stringList(tailor.specialty_tags))
  ).slice(0, 18)
  const locations = uniqueValues(
    data.exploreTailors.map((tailor) => tailor.location).filter((value): value is string => !!value)
  ).slice(0, 18)
  const normalizedCurrency = normalizeAccountCurrency(data.accountCurrency)
  const priceCurrencyLabel = normalizedCurrency
    ? `${currencySymbol(normalizedCurrency)} ${normalizedCurrency}`
    : 'currency'
  const parsedMinPrice = minPrice.trim() ? Number.parseFloat(minPrice.replace(/[^\d.]/g, '')) : null
  const parsedMaxPrice = maxPrice.trim() ? Number.parseFloat(maxPrice.replace(/[^\d.]/g, '')) : null

  useEffect(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (specialty !== 'all') params.set('specialty', specialty)
    if (location !== 'all') params.set('location', location)
    if (availability !== 'all') params.set('availability', availability)
    if (minPrice.trim()) params.set('minPrice', minPrice.trim())
    if (maxPrice.trim()) params.set('maxPrice', maxPrice.trim())
    if (sort !== 'rating') params.set('sort', sort)
    if (customOnly) params.set('custom', '1')
    const nextQuery = params.toString()
    const nextHref = nextQuery ? `${pathname}?${nextQuery}` : pathname
    router.replace(nextHref as Route, { scroll: false })
  }, [
    availability,
    customOnly,
    location,
    maxPrice,
    minPrice,
    pathname,
    router,
    search,
    sort,
    specialty,
  ])

  const filteredTailors = data.exploreTailors
    .filter((tailor) => {
      const haystack = [
        tailor.display_name,
        tailor.business_name,
        tailor.bio,
        tailor.location,
        ...stringList(tailor.specialty_tags),
      ]
        .join(' ')
        .toLowerCase()
      if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false
      if (specialty !== 'all' && !stringList(tailor.specialty_tags).includes(specialty))
        return false
      if (location !== 'all' && tailor.location !== location) return false
      if (availability !== 'all' && tailor.availability !== availability) return false
      if (customOnly && !tailor.supports_custom_orders) return false
      if (
        parsedMinPrice &&
        Number.isFinite(parsedMinPrice) &&
        tailor.price_range_max &&
        tailor.price_range_max / 100 < parsedMinPrice
      )
        return false
      if (
        parsedMaxPrice &&
        Number.isFinite(parsedMaxPrice) &&
        tailor.price_range_min &&
        tailor.price_range_min / 100 > parsedMaxPrice
      )
        return false
      return true
    })
    .sort((a, b) => {
      if (sort === 'price')
        return (
          (a.price_range_min ?? Number.MAX_SAFE_INTEGER) -
          (b.price_range_min ?? Number.MAX_SAFE_INTEGER)
        )
      if (sort === 'popular') return (b.total_orders ?? 0) - (a.total_orders ?? 0)
      const ratingDelta = (b.avg_rating ?? 0) - (a.avg_rating ?? 0)
      if (ratingDelta !== 0) return ratingDelta
      return (b.total_orders ?? 0) - (a.total_orders ?? 0)
    })
  const availabilityOptions = uniqueValues(
    data.exploreTailors
      .map((tailor) => tailor.availability)
      .filter((value): value is string => !!value)
  )
  const activeFilterCount = [
    specialty !== 'all',
    location !== 'all',
    availability !== 'all',
    minPrice.trim(),
    maxPrice.trim(),
    sort !== 'rating',
    customOnly,
  ].filter(Boolean).length

  function clearFilters() {
    setSearch('')
    setSpecialty('all')
    setLocation('all')
    setAvailability('all')
    setMinPrice('')
    setMaxPrice('')
    setSort('rating')
    setCustomOnly(false)
  }

  const filterSidebar = (
    <div className="grid gap-5">
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">Sort</p>
        <div className="grid gap-1">
          {(
            [
              ['rating', 'Top rated'],
              ['popular', 'Most orders'],
              ['price', 'Lowest price'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSort(value)}
              className={
                sort === value
                  ? 'rounded-lg bg-needle px-3 py-2 text-left text-sm font-semibold text-white'
                  : 'rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink/62 hover:bg-ink/5 hover:text-ink'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <hr className="border-ink/6" />
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">
          Specialty
        </p>
        <select
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40"
        >
          <option value="all">All specialties</option>
          {specialties.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">
          Location
        </p>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40"
        >
          <option value="all">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">
          Availability
        </p>
        <select
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
          className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-needle/40"
        >
          <option value="all">Any availability</option>
          {availabilityOptions.map((a) => (
            <option key={a} value={a}>
              {cleanLabel(a)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">
          Price <span className="normal-case font-normal text-ink/38">({priceCurrencyLabel})</span>
        </p>
        <div className="flex items-center gap-2">
          <input
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Min"
            className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/40"
          />
          <span className="text-xs text-ink/36">–</span>
          <input
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Max"
            className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-needle/40"
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink/8 bg-white/72 px-3 py-2.5">
        <input
          type="checkbox"
          checked={customOnly}
          onChange={(e) => setCustomOnly(e.target.checked)}
          className="h-4 w-4 rounded accent-needle"
        />
        <span className="text-sm font-semibold text-ink">Custom orders only</span>
      </label>
      {activeFilterCount > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm font-semibold text-ink/66 hover:text-ink"
        >
          Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
        </button>
      ) : null}
    </div>
  )

  return (
    <div className="grid gap-4">
      {/* Search + mobile filters toggle */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ui-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by tailor, style, or location..."
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          onClick={() => setMobileFiltersOpen((o) => !o)}
          variant={activeFilterCount > 0 ? 'primary' : 'secondary'}
          className="shrink-0 lg:hidden"
        >
          <SlidersHorizontal /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      </div>

      {/* Mobile filter panel */}
      {mobileFiltersOpen ? <Surface className="p-5 lg:hidden">{filterSidebar}</Surface> : null}

      {/* Specialty quick chips */}
      <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none]">
        {(['all', ...specialties.slice(0, 10)] as string[]).map((tag) => (
          <Button
            key={tag}
            type="button"
            onClick={() => setSpecialty(tag)}
            variant={specialty === tag ? 'primary' : 'secondary'}
            size="sm"
            className="whitespace-nowrap"
          >
            {tag === 'all' ? 'All tailors' : tag}
          </Button>
        ))}
      </div>

      {/* Two-column layout: sidebar + results */}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 rounded-[8px] border border-ui-border bg-white p-5 shadow-sm">
            {filterSidebar}
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-ink/52">
              {filteredTailors.length} tailor{filteredTailors.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 ? ' matching filters' : ''}
            </p>
            <Link href="/account/shop" className="text-sm font-semibold text-needle">
              Ready-made pieces →
            </Link>
          </div>

          {filteredTailors.length === 0 ? (
            <EmptyState
              title="No tailors match these filters."
              body="Adjust filters or clear them to see all tailors."
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filteredTailors.map((tailor) => {
                const photo = tailorPhoto(tailor)
                const safeSrc = safeMediaUrl(photo)
                const specialtyTags = stringList(tailor.specialty_tags).slice(0, 3)
                const canRequestBrief = canStartCustomBriefOnWeb(tailor, data.userId)
                const ratingText = tailor.total_reviews
                  ? `${Number(tailor.avg_rating ?? 0).toFixed(1)} (${tailor.total_reviews})`
                  : null
                const priceFrom = tailor.price_range_min
                  ? `from ${formatMoney(tailor.price_range_min, tailor.currency)}`
                  : null
                return (
                  <article
                    key={tailor.id}
                    className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md"
                  >
                    {/* Edge-to-edge photo with overlaid badges */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-needle/10">
                      {safeSrc ? (
                        <Image
                          src={safeSrc}
                          alt={safeEntityName(
                            tailor.business_name || tailor.display_name,
                            'Tailor'
                          )}
                          fill
                          sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/60">
                          {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                      )}
                      {/* Overlaid badges */}
                      <div className="absolute inset-x-3 top-3 flex items-start justify-between">
                        {tailor.is_verified ? (
                          <StatusChip
                            status="VERIFIED"
                            className="bg-white/90 shadow-sm backdrop-blur-sm"
                          />
                        ) : (
                          <span />
                        )}
                        {ratingText ? (
                          <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">
                            ★ {ratingText}
                          </span>
                        ) : null}
                      </div>
                      {/* Availability + price overlaid at bottom */}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/78 to-transparent px-4 pb-3 pt-10">
                        <p
                          className="text-xs font-semibold text-white"
                          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                        >
                          {cleanLabel(tailor.availability, 'Check availability')}
                          {priceFrom ? ` · ${priceFrom}` : ''}
                        </p>
                      </div>
                    </div>
                    {/* Card body */}
                    <div className="p-4">
                      <h3 className="text-xl font-semibold text-ink">
                        {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                      </h3>
                      <p className="mt-0.5 text-sm text-ink/52">
                        {safeUserText(tailor.location, 'Location pending')}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/62">
                        {safeUserText(
                          tailor.bio,
                          safeList(tailor.specialty_tags, 'Custom tailoring on Drapeon.')
                        )}
                      </p>
                      {specialtyTags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {specialtyTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-needle/8 px-2.5 py-1 text-xs font-semibold text-needle"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <Button asChild variant="secondary">
                          <Link href={accountRoute(`/account/tailors/${tailor.id}`)}>
                            View profile
                          </Link>
                        </Button>
                        {canRequestBrief ? (
                          <Button asChild>
                            <Link href={accountRoute(`/account/brief/${tailor.id}`)}>
                              Request brief
                            </Link>
                          </Button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="inline-flex cursor-not-allowed justify-center rounded-full bg-ink/10 px-4 py-2.5 text-sm font-semibold text-ink/48"
                          >
                            {customBriefUnavailableLabel(tailor, data.userId)}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function RenderSaved({ data }: { data: SavedSurfaceData }) {
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set())
  const tailorById = new Map(data.savedTailors.map((tailor) => [tailor.id, tailor]))
  const itemById = new Map(data.savedItems.map((item) => [item.id, item]))

  function toggleCollection(id: string) {
    setExpandedCollectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          label="Collections"
          value={data.wishlistCollections.length}
          hint="Organized wishlists"
          icon={<Archive />}
        />
        <MetricCard
          label="Saved tailors"
          value={data.savedTailors.length}
          hint="People and studios"
          icon={<Users />}
        />
        <MetricCard
          label="Saved pieces"
          value={data.savedItems.length}
          hint="Ready-made items"
          icon={<ShoppingBag />}
        />
      </section>

      {data.wishlistCollections.length === 0 &&
      data.savedTailors.length === 0 &&
      data.savedItems.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          body="Save tailors from Explore and ready-made pieces from Marketplace while planning an event or comparing options."
          action={
            <Link href="/account/explore" className="font-semibold text-needle">
              Browse Explore
            </Link>
          }
        />
      ) : null}

      {data.wishlistCollections.length > 0 ? (
        <section className="grid gap-5 md:grid-cols-2">
          {data.wishlistCollections.map((collection) => {
            const allItems = data.wishlistItems.filter(
              (item) => item.collection_id === collection.id
            )
            const isExpanded = expandedCollectionIds.has(collection.id)
            const visibleItems = isExpanded ? allItems : allItems.slice(0, 4)
            const fallbackPhoto =
              collection.cover_image_url ||
              allItems
                .map((entry) => {
                  if (entry.tailor_id) {
                    const tailor = tailorById.get(entry.tailor_id)
                    return tailor ? tailorPhoto(tailor) : null
                  }
                  if (entry.ready_made_item_id) {
                    const item = itemById.get(entry.ready_made_item_id)
                    return item ? itemPhoto(item) : null
                  }
                  return null
                })
                .find(Boolean) ||
              null

            return (
              <article
                key={collection.id}
                className="rounded-[8px] border border-ui-border bg-white p-5 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => toggleCollection(collection.id)}
                  className="flex w-full items-start justify-between gap-4 text-left"
                >
                  <div
                    className={
                      fallbackPhoto ? 'grid flex-1 gap-4 sm:grid-cols-[0.38fr_0.62fr]' : 'flex-1'
                    }
                  >
                    {fallbackPhoto ? (
                      <PhotoTile src={fallbackPhoto} label="Wishlist collection" />
                    ) : null}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                        Wishlist
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold text-ink">
                        {safeUserText(collection.name, 'Wishlist')}
                      </h2>
                      <p className="mt-2 text-sm text-ink/58">
                        {collection.item_count ?? allItems.length}{' '}
                        {(collection.item_count ?? allItems.length) === 1 ? 'item' : 'items'} ·
                        Updated {formatRelative(collection.updated_at)}
                      </p>
                    </div>
                  </div>
                  <span className="mt-1 shrink-0 text-xs font-semibold text-needle/70">
                    {isExpanded ? 'Collapse' : 'Open'}
                  </span>
                </button>
                {isExpanded ? (
                  <div className="mt-4 grid gap-2">
                    {visibleItems.length === 0 ? (
                      <p className="rounded-[8px] bg-bone/70 px-4 py-3 text-sm leading-6 text-ink/62">
                        Save a tailor from Explore or a ready-made piece from Marketplace to add it
                        here.
                      </p>
                    ) : (
                      visibleItems.map((entry) => {
                        const tailor = entry.tailor_id ? tailorById.get(entry.tailor_id) : null
                        const item = entry.ready_made_item_id
                          ? itemById.get(entry.ready_made_item_id)
                          : null
                        const href = tailor
                          ? accountRoute(`/account/tailors/${tailor.id}`)
                          : item
                            ? accountRoute(`/account/items/${item.id}`)
                            : '/account/explore'
                        return (
                          <Link
                            key={entry.id}
                            href={href}
                            className="rounded-[8px] border border-ui-border bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-needle/30"
                          >
                            {tailor
                              ? safeEntityName(
                                  tailor.business_name || tailor.display_name,
                                  'Saved tailor'
                                )
                              : item
                                ? safeUserText(item.title, 'Saved ready-made item')
                                : 'Saved item'}
                          </Link>
                        )
                      })
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {data.savedTailors.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">
            Saved tailors
          </p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedTailors.map((tailor) => {
              const photo = tailorPhoto(tailor)
              const safeSrc = safeMediaUrl(photo)
              const specialtyTags = stringList(tailor.specialty_tags).slice(0, 3)
              return (
                <Link
                  key={tailor.id}
                  href={accountRoute(`/account/tailors/${tailor.id}`)}
                  className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-needle/8">
                    {safeSrc ? (
                      <Image
                        src={safeSrc}
                        alt={safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                        fill
                        sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">
                        {safeEntityName(tailor.business_name || tailor.display_name, 'T')
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                    )}
                    {tailor.is_verified ? (
                      <div className="absolute left-3 top-3">
                        <StatusChip
                          status="VERIFIED"
                          className="bg-white/90 shadow-sm backdrop-blur-sm"
                        />
                      </div>
                    ) : null}
                    {tailor.avg_rating ? (
                      <div className="absolute right-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">
                          ★ {Number(tailor.avg_rating).toFixed(1)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink">
                      {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                    </h3>
                    <p className="mt-0.5 text-sm text-ink/50">
                      {safeUserText(tailor.location, 'Location pending')}
                    </p>
                    {specialtyTags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {specialtyTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-needle/8 px-2.5 py-0.5 text-xs font-semibold text-needle"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      {data.savedItems.length > 0 ? (
        <section className="border-t border-ink/6 pt-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink/44">
            Saved ready-made
          </p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {data.savedItems.map((item) => {
              const photo = itemPhoto(item)
              const safeSrc = safeMediaUrl(photo)
              return (
                <Link
                  key={item.id}
                  href={accountRoute(`/account/items/${item.id}`)}
                  className="overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-needle/8">
                    {safeSrc ? (
                      <Image
                        src={safeSrc}
                        alt={safeUserText(item.title, 'Item')}
                        fill
                        sizes="(min-width:1280px) 25vw,(min-width:768px) 40vw,90vw"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-needle/52">
                        No photo
                      </div>
                    )}
                    {item.category ? (
                      <div className="absolute left-3 top-3">
                        <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm backdrop-blur-sm">
                          {item.category}
                        </span>
                      </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 to-transparent px-4 pb-3 pt-8">
                      <p
                        className="text-sm font-semibold text-white"
                        style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                      >
                        {formatMoney(item.price_amount, item.currency)}
                      </p>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-ink">
                      {safeUserText(item.title, 'Ready-made item')}
                    </h3>
                    <p className="mt-0.5 text-sm font-semibold text-rust">{stockCopy(item)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function RenderTailorDetail({
  data,
  onRefresh,
}: {
  data: TailorDetailSurfaceData
  onRefresh: () => void
}) {
  const account = useAccountContext()
  const tailor = data.tailor
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [reviewPreviewMedia, setReviewPreviewMedia] = useState<string | null>(null)

  if (!tailor) {
    return (
      <EmptyState
        title="Tailor profile not available."
        body="This profile may be hidden, may belong to another account context, or may still be loading."
        action={
          <Link href="/account/explore" className="font-semibold text-needle">
            Back to Explore
          </Link>
        }
      />
    )
  }
  const profileMedia = tailorProfileMedia(tailor)
  const readyMade = data.readyMade.filter(
    (item) => account.userId === tailor.user_id || isReadyMadeBuyableOnWeb(item, tailor)
  )
  const isSaved = savedOverride ?? data.isSaved
  const canRequestCustomOrder = canStartCustomBriefOnWeb(tailor, account.userId)

  async function toggleSaved() {
    if (!tailor || busy) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      try {
        await invokeAccountFunction('saved-tailor-action', {
          action: isSaved ? 'unsave-by-profile' : 'save-tailor',
          tailorProfileId: tailor.id,
        })
      } catch {
        if (isSaved) {
          await removeSavedTailorDirectly(account.userId, tailor.id)
        } else {
          await saveTailorDirectly(account.userId, tailor.id)
        }
      }
      setSavedOverride(!isSaved)
      setSuccess(isSaved ? 'Removed from saved.' : 'Saved to your wishlist.')
      onRefresh()
    } catch (saveError) {
      setError(friendlyActionError(saveError, 'Wishlist could not update. Refresh and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const specialties = stringList(tailor.specialty_tags)
  const languages = stringList(tailor.languages)
  const heroStars = Math.round(Number(tailor.avg_rating ?? 0))

  return (
    <div className="grid gap-5">
      {/* Immersive hero card */}
      <Surface className="overflow-hidden">
        <div className="relative h-52 bg-bone sm:h-64 md:h-80">
          {profileMedia[0] && isVideoMediaUrl(profileMedia[0]) ? (
            <MutedVideo
              src={profileMedia[0]}
              className="h-full w-full object-cover"
              ariaLabel="Tailor cover"
              autoPlay={true}
              showMuteToggle
            />
          ) : profileMedia[0] ? (
            <Image
              src={profileMedia[0]}
              alt="Tailor cover"
              fill
              sizes="100vw"
              className="object-cover object-top"
              unoptimized
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/88 via-ink/30 to-ink/0" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/60"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
                >
                  {cleanLabel(tailor.tier, 'Tailor')}
                </p>
                <h2
                  className="mt-1 truncate text-2xl font-semibold text-white sm:text-3xl"
                  style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}
                >
                  {safeEntityName(tailor.business_name || tailor.display_name, 'Tailor')}
                </h2>
                <div
                  className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
                >
                  {tailor.location ? <span>{tailor.location}</span> : null}
                  {tailor.avg_rating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-amber-300 leading-none">
                        {'★'.repeat(heroStars)}
                        {'☆'.repeat(5 - heroStars)}
                      </span>
                      <span>
                        {Number(tailor.avg_rating).toFixed(1)} ({tailor.total_reviews ?? 0})
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              {tailor.is_verified ? <StatusChip status="VERIFIED" className="shadow-sm" /> : null}
            </div>
          </div>
        </div>

        <div className="bg-white p-6">
          <p className="text-sm leading-7 text-ink/66">
            {safeUserText(
              tailor.bio,
              'Portfolio, fit guidance, and order context stay connected through Drapeon.'
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">
              {priceRange(tailor)}
            </span>
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">
              {fulfillmentSummary(tailor)}
            </span>
            {tailor.supports_custom_orders ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">
                Custom orders
              </span>
            ) : null}
            {tailor.supports_custom_orders ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">
                {tailor.consultation_mode === 'UNAVAILABLE'
                  ? 'No consultation'
                  : `${tailor.consultation_requirement === 'REQUIRED' ? 'Required' : 'Optional'} ${tailor.consultation_mode === 'PAID' ? formatMoney(tailor.consultation_fee_amount, tailor.consultation_currency ?? tailor.currency) : 'free'} consultation`}
              </span>
            ) : null}
            {tailor.supports_ready_made ? (
              <span className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle">
                Ready-made
              </span>
            ) : null}
          </div>

          <ActionNotice error={error} success={success} />

          <div className="mt-5 flex flex-wrap gap-3">
            {canRequestCustomOrder ? (
              <Button asChild>
                <Link href={accountRoute(`/account/brief/${tailor.id}`)}>Request custom order</Link>
              </Button>
            ) : tailor.supports_custom_orders ? (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-ink/10 px-5 py-3 text-sm font-semibold text-ink/48"
              >
                {customBriefUnavailableLabel(tailor, account.userId)}
              </button>
            ) : null}
            <Button
              type="button"
              onClick={() => {
                void toggleSaved()
              }}
              disabled={busy}
              variant={isSaved ? 'destructive' : 'secondary'}
            >
              {busy ? 'Updating...' : isSaved ? 'Remove from saved' : 'Save tailor'}
            </Button>
            <OpenAppButton
              label="Open in app"
              className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
            />
          </div>
        </div>
      </Surface>

      {/* Portfolio strip */}
      {profileMedia.length > 1 ? (
        <Surface className="overflow-hidden">
          <SurfaceHeader
            title="Portfolio"
            description="Open any image or video for a closer review."
          />
          <div className="flex gap-3 overflow-x-auto px-6 pb-5 pt-3">
            {profileMedia.slice(1).map((src, i) => (
              <MediaViewerDialog
                key={src}
                src={src}
                kind={isVideoMediaUrl(src) ? 'video' : 'image'}
                title={`Portfolio ${i + 2}`}
              >
                <button
                  type="button"
                  className="relative h-36 w-36 shrink-0 cursor-zoom-in overflow-hidden rounded-[8px] bg-bone text-left"
                >
                  {isVideoMediaUrl(src) ? (
                    <MutedVideo
                      src={src}
                      className="h-full w-full object-cover"
                      ariaLabel={`Portfolio ${i + 2}`}
                      showMuteToggle={false}
                    />
                  ) : (
                    <Image
                      src={src}
                      alt={`Portfolio ${i + 2}`}
                      fill
                      sizes="144px"
                      className="object-cover object-top"
                      unoptimized
                    />
                  )}
                </button>
              </MediaViewerDialog>
            ))}
          </div>
        </Surface>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Craft profile */}
        <Surface className="overflow-hidden">
          <div className="p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">
              Craft profile
            </p>
            {specialties.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2.5 text-xs font-semibold text-ink/50">Specialties</p>
                <div className="flex flex-wrap gap-2">
                  {specialties.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink/44">Specialties not listed yet.</p>
            )}
            {languages.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2.5 text-xs font-semibold text-ink/50">Languages</p>
                <div className="flex flex-wrap gap-2">
                  {languages.map((l) => (
                    <span
                      key={l}
                      className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/66"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Surface>

        {/* Reviews */}
        <Surface className="overflow-hidden">
          <div className="p-6 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Reviews</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">
              {Number(tailor.avg_rating ?? 0).toFixed(1)}
              <span className="ml-2 text-sm font-normal text-ink/44">
                ({tailor.total_reviews ?? 0} reviews)
              </span>
            </p>
          </div>
          {data.tailorReviews.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-ink/44">
              Public reviews will appear here after completed Drapeon orders.
            </p>
          ) : (
            <div className="divide-y divide-ink/6 max-h-[420px] overflow-y-auto">
              {data.tailorReviews.map((review) => {
                const reviewStars = Math.round(Number(review.rating ?? 0))
                const reviewMediaUrls = stringList(review.media_urls)
                  .map((src) => safeMediaUrl(src, 'review-media'))
                  .filter((src): src is string => Boolean(src))
                return (
                  <div key={review.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-base leading-none text-amber-400">
                            {'★'.repeat(reviewStars)}
                            {'☆'.repeat(5 - reviewStars)}
                          </span>
                          <span className="text-xs font-semibold text-ink/44">
                            {Number(review.rating ?? 0).toFixed(1)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-ink">
                          {safeEntityName(review.reviewer_name, 'Customer')}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-ink/38">
                        {formatRelative(review.created_at ?? review.published_at)}
                      </p>
                    </div>
                    {stringList(review.tags).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {stringList(review.tags).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-needle/8 px-2.5 py-0.5 text-xs font-semibold text-needle"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {review.body ? (
                      <p className="mt-2 text-sm leading-6 text-ink/62">
                        {safeUserText(review.body)}
                      </p>
                    ) : null}
                    {reviewMediaUrls.length > 0 ? (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                        {reviewMediaUrls.map((src, index) => (
                          <button
                            key={src}
                            type="button"
                            onClick={() => setReviewPreviewMedia(src)}
                            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[8px] bg-ink/8 text-left"
                            aria-label={`Open review media ${index + 1}`}
                          >
                            {isVideoMediaUrl(src) ? (
                              <MutedVideo
                                src={src}
                                className="h-full w-full object-cover"
                                ariaLabel="Review video preview"
                                showMuteToggle={false}
                              />
                            ) : (
                              <img
                                src={src}
                                alt="Review attachment"
                                className="h-full w-full object-cover"
                              />
                            )}
                            {isVideoMediaUrl(src) ? (
                              <span className="absolute bottom-1 right-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[0.62rem] font-bold text-white">
                                ▶
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {review.tailor_response ? (
                      <div className="mt-3 rounded-[8px] bg-needle/4 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-needle/70">
                          Tailor response
                        </p>
                        <p className="mt-1 text-sm leading-6 text-ink/66">
                          {safeUserText(review.tailor_response)}
                        </p>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Surface>
      </div>

      {/* Ready-made from this tailor */}
      {readyMade.length > 0 ? (
        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">
            Ready-made from this tailor
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {readyMade.map((item) => (
              <Link
                key={item.id}
                href={accountRoute(`/account/items/${item.id}`)}
                className="group overflow-hidden rounded-[8px] border border-ui-border bg-white shadow-sm transition hover:border-needle/30 hover:shadow-md"
              >
                <div className="relative aspect-[4/3] bg-bone">
                  {itemPhoto(item) ? (
                    <Image
                      src={itemPhoto(item)!}
                      alt={safeUserText(item.title, 'Ready-made item')}
                      fill
                      sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover transition group-hover:scale-[1.03]"
                      unoptimized
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <p
                      className="text-sm font-semibold leading-snug text-white"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                    >
                      {safeUserText(item.title, 'Ready-made item')}
                    </p>
                    <p
                      className="mt-0.5 text-xs font-semibold text-white/80"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                    >
                      {formatMoney(item.price_amount, item.currency)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {reviewPreviewMedia ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/82 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setReviewPreviewMedia(null)}
            className="absolute right-4 top-4 rounded-full bg-white/92 px-4 py-2 text-sm font-semibold text-ink shadow-lg"
          >
            Close
          </button>
          <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-[8px] bg-black shadow-2xl">
            {isVideoMediaUrl(reviewPreviewMedia) ? (
              <MutedVideo
                src={reviewPreviewMedia}
                className="max-h-[82vh] w-full object-contain"
                ariaLabel="Review video"
                autoPlay={true}
                controls={true}
                showMuteToggle
              />
            ) : (
              <img
                src={reviewPreviewMedia}
                alt="Review attachment preview"
                className="max-h-[82vh] w-full object-contain"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function RenderItemDetail({
  data,
  onRefresh,
}: {
  data: ItemDetailRenderData
  onRefresh: () => void
}) {
  const router = useRouter()
  const item = data.item
  const [inquiryBusy, setInquiryBusy] = useState(false)
  const [inquiryError, setInquiryError] = useState<string | null>(null)
  const [inquirySuccess, setInquirySuccess] = useState<string | null>(null)
  if (!item) {
    return (
      <EmptyState
        title="Ready-made item not available."
        body="This item may be sold out, hidden, or still loading. Return to Marketplace to browse available pieces."
        action={
          <Link href="/account/shop" className="font-semibold text-needle">
            Back to Marketplace
          </Link>
        }
      />
    )
  }
  const readyMadeItemId = item.id
  const tailor = firstJoinedRow(item.tailor_profiles)
  const gallery = stringList(item.photo_urls)
    .map((src) => safeMediaUrl(src, 'seller-item-media'))
    .filter((src): src is string => !!src)
  const heroMedia = gallery[0] ?? null
  const itemInventoryQuantity = readyMadeInventoryCount(item)
  const canUseReadyMadeItemActions = Boolean(
    data.userId && data.tailorProfile?.id !== item.tailor_profile_id && item.is_live
  )
  const itemIsBuyable = isReadyMadeBuyableOnWeb(item, tailor)
  const canStartWebCheckout = canUseReadyMadeItemActions && itemIsBuyable
  const canAskSeller = canStartWebCheckout
  const checkoutCtaLabel = itemInventoryQuantity === 1 ? 'Buy last one' : 'Start web checkout'
  const checkoutUnavailableLabel = readyMadeUnavailableLabel(item, tailor)

  const sizes = stringList(item.sizes)
  const tailorAvatarSrc = safeMediaUrl(tailor?.avatar_url, 'avatars') ?? null

  async function startReadyMadeInquiry() {
    if (!canAskSeller || inquiryBusy) return
    setInquiryError(null)
    setInquirySuccess(null)
    setInquiryBusy(true)
    try {
      const result = await invokeAccountFunction<{ orderId?: string }>('ready-made-order-action', {
        action: 'start-inquiry',
        sellerItemId: readyMadeItemId,
      })
      onRefresh()
      if (result.orderId) {
        setInquirySuccess('Opening the protected seller thread.')
        router.push(accountRoute(`/account/messages?orderId=${encodeURIComponent(result.orderId)}`))
        return
      }
      setInquirySuccess('Inquiry started. Open Messages to continue.')
    } catch (inquiryError) {
      setInquiryError(
        friendlyActionError(inquiryError, 'Could not start this seller conversation.')
      )
    } finally {
      setInquiryBusy(false)
    }
  }

  return (
    <div className="grid gap-5">
      {/* Hero card */}
      <Surface className="overflow-hidden">
        <div className="relative h-52 bg-bone sm:h-64 md:aspect-[16/9] md:h-auto">
          {heroMedia && isVideoMediaUrl(heroMedia) ? (
            <MutedVideo
              src={heroMedia}
              className="h-full w-full object-cover"
              ariaLabel={safeUserText(item.title, 'Ready-made item')}
              showMuteToggle
            />
          ) : heroMedia ? (
            <Image
              src={heroMedia}
              alt={safeUserText(item.title, 'Ready-made item')}
              fill
              sizes="100vw"
              className="object-cover"
              unoptimized
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/88 via-ink/30 to-ink/0" />
          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <p
              className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/60"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
            >
              {safeUserText(item.category, 'Ready-made')}
            </p>
            <h2
              className="mt-1 text-2xl font-semibold text-white sm:text-3xl"
              style={{ textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}
            >
              {safeUserText(item.title, 'Ready-made item')}
            </h2>
            <div
              className="mt-2 flex flex-wrap items-center gap-3"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
            >
              <span className="text-xl font-semibold text-white sm:text-2xl">
                {formatMoney(item.price_amount, item.currency)}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.4)] ${item.is_live ? 'bg-emerald-500/30 text-emerald-100' : 'bg-white/15 text-white/60'}`}
              >
                {stockCopy(item)}
              </span>
            </div>
          </div>
        </div>

        {/* Gallery strip */}
        {gallery.length > 1 ? (
          <div className="flex gap-3 overflow-x-auto bg-bone/40 px-6 py-4">
            {gallery.slice(1).map((src, i) => (
              <MediaViewerDialog
                key={src}
                src={src}
                kind={isVideoMediaUrl(src) ? 'video' : 'image'}
                title={`${safeUserText(item.title, 'Item')} media ${i + 2}`}
              >
                <button
                  type="button"
                  className="relative h-20 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-[8px] bg-bone text-left"
                >
                  {isVideoMediaUrl(src) ? (
                    <MutedVideo
                      src={src}
                      className="h-full w-full object-cover"
                      ariaLabel={`Item video ${i + 2}`}
                      showMuteToggle={false}
                    />
                  ) : (
                    <Image
                      src={src}
                      alt={`Item image ${i + 2}`}
                      fill
                      sizes="80px"
                      className="object-cover"
                      unoptimized
                    />
                  )}
                </button>
              </MediaViewerDialog>
            ))}
          </div>
        ) : null}

        {/* Info body */}
        <div className="bg-white p-6">
          <p className="text-sm leading-7 text-ink/66">
            {safeUserText(
              item.description,
              'Review size, stock, fulfillment, and checkout before purchase.'
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/62">
              {fulfillmentSummary(item)}
            </span>
            {sizes.map((s) => (
              <span
                key={s}
                className="rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle"
              >
                {s}
              </span>
            ))}
            {sizes.length === 0 ? (
              <span className="rounded-full border border-ink/10 bg-bone/60 px-3 py-1.5 text-xs font-semibold text-ink/44">
                Confirm sizes in app
              </span>
            ) : null}
          </div>

          <ActionNotice error={inquiryError} success={inquirySuccess} />

          <div className="mt-6 flex flex-wrap gap-3">
            {canStartWebCheckout ? (
              <a
                href="#ready-made-checkout"
                className="inline-flex items-center justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
              >
                {checkoutCtaLabel}
              </a>
            ) : canUseReadyMadeItemActions ? (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-ink/10 px-5 py-3 text-sm font-semibold text-ink/48"
              >
                {checkoutUnavailableLabel}
              </button>
            ) : (
              <OpenAppButton label="Open in app" />
            )}
            {canAskSeller ? (
              <button
                type="button"
                onClick={() => {
                  void startReadyMadeInquiry()
                }}
                disabled={inquiryBusy}
                className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/38"
              >
                {inquiryBusy ? 'Opening thread...' : 'Ask seller'}
              </button>
            ) : null}
            {item.tailor_profile_id ? (
              <Link
                href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)}
                className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
              >
                View tailor
              </Link>
            ) : null}
            {canStartWebCheckout ? (
              <OpenAppButton
                label="Open in app"
                className="inline-flex items-center justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
              />
            ) : null}
          </div>
        </div>
      </Surface>

      {canStartWebCheckout ? (
        <ReadyMadeCheckoutForm item={item} data={data} onRefresh={onRefresh} />
      ) : null}

      <section className="grid gap-5 lg:grid-cols-2">
        {/* Tailor mini-card */}
        <div className="overflow-hidden rounded-[8px] border border-ink/8 bg-white shadow-sm">
          <div className="relative h-24 bg-needle/8">
            {tailorAvatarSrc ? (
              <Image
                src={tailorAvatarSrc}
                alt="Tailor"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
                unoptimized
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/75 to-transparent" />
          </div>
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">Tailor</p>
            <p className="mt-1.5 text-xl font-semibold text-ink">
              {safeEntityName(tailor?.business_name || tailor?.display_name, 'Drapeon tailor')}
            </p>
            {tailor?.location ? (
              <p className="mt-0.5 text-xs text-ink/44">{tailor.location}</p>
            ) : null}
            {item.tailor_profile_id ? (
              <Link
                href={accountRoute(`/account/tailors/${item.tailor_profile_id}`)}
                className="mt-4 inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink"
              >
                View profile
              </Link>
            ) : null}
          </div>
        </div>

        {/* Fit guidance */}
        <div className="rounded-[8px] border border-ink/8 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/40">
            Fit guidance
          </p>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {sizeGuideSummary(item.size_guide, stringList(item.sizes))}
          </p>
          <p className="mt-4 rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
            Checkout keeps payment state, fulfillment, and order handoff together. Native push and
            camera-guided proof are available in the app when needed.
          </p>
        </div>
      </section>
    </div>
  )
}
