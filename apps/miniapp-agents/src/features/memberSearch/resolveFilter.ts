import { memberSearch } from '@miniapp/shared'
import type { MemberFilterValue } from './MemberFilterDialog'

/**
 * True when the filter value carries no actual narrowing. The group scope is
 * ambient (the form's selected source group), so only the filter AST and date
 * range count — an empty AST + no dates means "no filter" regardless of which
 * group is selected.
 */
export function isEmptyFilter(v: MemberFilterValue | null): boolean {
  if (!v) return true
  return !v.filter && !v.dateFrom && !v.dateTo
}

/**
 * Resolve a member filter to the set of matching member ids (tg_user_id) by
 * paging through the dynamic member-search endpoint. The heavy filtering runs
 * server-side in Postgres; the browser only receives matching ids.
 *
 * Returns the ids plus the total match count when available. An empty filter
 * (no AST / scope / date) short-circuits to no narrowing.
 */
export async function resolveFilterMemberIds(
  agentId: number,
  value: MemberFilterValue,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<{ ids: number[]; total: number | null }> {
  if (isEmptyFilter(value)) return { ids: [], total: null }

  // page_size is capped at 50 by the backend, so default to it and page
  // through all matches so the full filtered set is captured.
  const pageSize = opts.pageSize ? Math.min(opts.pageSize, 50) : 50
  const maxPages = opts.maxPages ?? 40

  // First page tells us the total; remaining pages are independent, so fetch
  // them in parallel to avoid N sequential round-trips on Apply.
  const first = await memberSearch(agentId, {
    group_ids: value.groupIds.length ? value.groupIds : undefined,
    filter: value.filter ?? undefined,
    date_from: value.dateFrom || undefined,
    date_to: value.dateTo || undefined,
    sort: value.sort,
    page: 1,
    page_size: pageSize,
    include_total: true,
  })
  const total = first.total !== null && first.total !== undefined ? first.total : null
  const ids = new Set<number>()
  for (const item of first.items ?? []) ids.add(item.tg_user_id)

  const pages = Math.min(maxPages, Math.ceil((total ?? 0) / pageSize))
  if (pages > 1) {
    const rest = await Promise.allSettled(
      Array.from({ length: pages - 1 }, (_, i) =>
        memberSearch(agentId, {
          group_ids: value.groupIds.length ? value.groupIds : undefined,
          filter: value.filter ?? undefined,
          date_from: value.dateFrom || undefined,
          date_to: value.dateTo || undefined,
          sort: value.sort,
          page: i + 2,
          page_size: pageSize,
          include_total: false,
        }),
      ),
    )
    for (const r of rest) {
      if (r.status === 'fulfilled') {
        for (const item of r.value.items ?? []) ids.add(item.tg_user_id)
      }
    }
  }

  return { ids: [...ids], total }
}
