'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { ChevronDown, Search, SlidersHorizontal, Tags } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { PublicTailor } from '../lib/public-marketplace'
import { TailorCard } from './tailor-card'

export type TailorDirectoryParams = {
  q?: string
  filter?: string
  sort?: string
  page?: string
}

function routeWithParams(basePath: string, params: Record<string, string | undefined>): Route {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  return `${basePath}${query.size ? `?${query.toString()}` : ''}` as Route
}

function filterLabel(value: string) {
  if (value === 'all') return 'All tailors'
  if (value === 'custom') return 'Custom orders'
  if (value === 'ready-made') return 'Ready-made'
  return value
}

const OUTFIT_FILTERS = [
  'Agbada',
  'Boubou',
  'Kaftan',
  'Dashiki',
  'Ankara',
  'Suits',
  'Tuxedo',
  'Blazers',
  'Shirts',
  'Gowns',
] as const

const OUTFIT_MATCHERS: Record<(typeof OUTFIT_FILTERS)[number], string[]> = {
  Agbada: ['agbada'],
  Boubou: ['boubou'],
  Kaftan: ['kaftan', 'kaftans'],
  Dashiki: ['dashiki', 'danshiki'],
  Ankara: ['ankara'],
  Suits: ['suit', 'suits', 'native set', 'senator'],
  Tuxedo: ['tuxedo'],
  Blazers: ['blazer', 'blazers'],
  Shirts: ['shirt', 'shirts', 'dress shirt'],
  Gowns: ['gown', 'gowns', 'wedding gown', 'evening gown'],
}

export function TailorDirectory({
  tailors,
  params,
  basePath,
  profileBasePath,
  pagination,
}: {
  tailors: PublicTailor[]
  params: TailorDirectoryParams
  basePath: '/explore' | '/account/explore'
  profileBasePath: '/tailors' | '/account/tailors'
  pagination?: { page: number; hasNextPage: boolean }
}) {
  const query = params.q?.trim().slice(0, 80) ?? ''
  const router = useRouter()
  const activeFilter = params.filter?.trim().slice(0, 60) || 'all'
  const sort = ['rating', 'popular', 'price-low'].includes(params.sort ?? '')
    ? params.sort!
    : 'rating'
  const quickFilters = ['all', 'custom', 'ready-made'] as const
  const activeOutfit = OUTFIT_FILTERS.includes(activeFilter as (typeof OUTFIT_FILTERS)[number])
    ? activeFilter
    : ''
  const filtered = tailors
    .filter((tailor) => {
      if (activeFilter === 'custom') return tailor.acceptsCustomOrders
      if (activeFilter === 'ready-made') return tailor.supportsReadyMade
      if (activeFilter !== 'all') {
        const matchers = OUTFIT_MATCHERS[activeFilter as keyof typeof OUTFIT_MATCHERS]
        if (!matchers) return true
        const specialties = tailor.specialties.join(' ').toLowerCase()
        return matchers.some((matcher) => specialties.includes(matcher))
      }
      return true
    })
    .sort((a, b) => {
      if (sort === 'popular')
        return b.totalOrders - a.totalOrders || b.averageRating - a.averageRating
      if (sort === 'price-low')
        return (
          (a.priceRangeMin ?? Number.MAX_SAFE_INTEGER) -
          (b.priceRangeMin ?? Number.MAX_SAFE_INTEGER)
        )
      return b.averageRating - a.averageRating || b.totalReviews - a.totalReviews
    })

  return (
    <div className="grid gap-4">
      <form
        action={basePath}
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
        aria-label="Search and sort tailors"
      >
        <label className="relative min-w-0">
          <span className="sr-only">Search tailors</span>
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink/42"
          />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search tailor, specialty, or location"
            className="h-10 w-full rounded-[8px] border border-ui-border bg-white pl-9 pr-3 text-sm outline-none transition focus:border-needle focus:ring-2 focus:ring-needle/12"
          />
        </label>
        {activeFilter !== 'all' ? <input type="hidden" name="filter" value={activeFilter} /> : null}
        <label className="flex h-10 items-center gap-2 rounded-[8px] border border-ui-border bg-white px-3">
          <SlidersHorizontal aria-hidden="true" className="size-4 text-ink/42" />
          <span className="sr-only">Sort tailors</span>
          <select
            name="sort"
            defaultValue={sort}
            className="bg-transparent text-sm font-semibold outline-none"
          >
            <option value="rating">Top rated</option>
            <option value="popular">Most orders</option>
            <option value="price-low">Lowest starting price</option>
          </select>
        </label>
        <button className="h-10 rounded-[8px] bg-needle px-4 text-sm font-semibold text-white transition hover:bg-needle-600">
          Apply
        </button>
      </form>

      <div
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
        aria-label="Tailor filters"
      >
        {quickFilters.map((value) => {
          const active = activeFilter === value
          return (
            <Link
              key={value}
              href={routeWithParams(basePath, {
                q: query || undefined,
                filter: value === 'all' ? undefined : value,
                sort: sort === 'rating' ? undefined : sort,
              })}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex h-9 shrink-0 items-center rounded-[8px] border px-3 text-sm font-semibold transition-colors ${active ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink hover:border-needle/35'}`}
            >
              {filterLabel(value)}
            </Link>
          )
        })}
        <label
          className={`relative inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] border px-3 text-sm font-semibold transition-colors ${activeOutfit ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink hover:border-needle/35'}`}
        >
          <Tags aria-hidden="true" className="size-4" />
          <span className="sr-only">Filter by outfit</span>
          <select
            value={activeOutfit}
            onChange={(event) => {
              const outfit = event.target.value
              router.push(
                routeWithParams(basePath, {
                  q: query || undefined,
                  filter: outfit || undefined,
                  sort: sort === 'rating' ? undefined : sort,
                })
              )
            }}
            className="cursor-pointer appearance-none bg-transparent pr-4 text-sm font-semibold outline-none"
            aria-label="Outfit"
          >
            <option value="">Outfit</option>
            {OUTFIT_FILTERS.map((outfit) => (
              <option key={outfit} value={outfit}>
                {outfit}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-ink/55">
        <p>
          {filtered.length} tailor{filtered.length === 1 ? '' : 's'}
        </p>
        {query || activeFilter !== 'all' || sort !== 'rating' ? (
          <Link href={basePath} className="font-semibold text-needle">
            Clear
          </Link>
        ) : null}
      </div>

      {filtered.length ? (
        <section
          className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
          aria-label="Tailors"
        >
          {filtered.map((tailor, index) => (
            <TailorCard
              key={tailor.id}
              tailor={tailor}
              index={index}
              profileBasePath={profileBasePath}
            />
          ))}
        </section>
      ) : (
        <section className="rounded-[8px] border border-ui-border bg-white p-6 text-center">
          <h2 className="text-xl font-semibold text-ink">No tailors match those filters.</h2>
          <p className="mt-2 text-sm text-ink/58">Clear a filter or try another search.</p>
          <Link
            href={basePath}
            className="mt-4 inline-flex h-9 items-center rounded-[8px] bg-needle px-3 text-sm font-semibold text-white"
          >
            View all tailors
          </Link>
        </section>
      )}
      {pagination && (pagination.page > 1 || pagination.hasNextPage) ? (
        <nav className="mt-4 flex items-center justify-center gap-3" aria-label="Explore pages">
          {pagination.page > 1 ? (
            <Link
              href={routeWithParams(basePath, {
                q: query || undefined,
                filter: activeFilter === 'all' ? undefined : activeFilter,
                sort: sort === 'rating' ? undefined : sort,
                page: pagination.page === 2 ? undefined : String(pagination.page - 1),
              })}
              className="inline-flex h-10 items-center rounded-[8px] border border-ui-border bg-white px-4 text-sm font-semibold text-ink hover:border-needle/35"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-xs font-semibold text-ink/48">Page {pagination.page}</span>
          {pagination.hasNextPage ? (
            <Link
              href={routeWithParams(basePath, {
                q: query || undefined,
                filter: activeFilter === 'all' ? undefined : activeFilter,
                sort: sort === 'rating' ? undefined : sort,
                page: String(pagination.page + 1),
              })}
              className="inline-flex h-10 items-center rounded-[8px] bg-needle px-4 text-sm font-semibold text-white hover:bg-needle-600"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
