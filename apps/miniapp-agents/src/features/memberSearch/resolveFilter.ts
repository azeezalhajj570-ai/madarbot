import { memberSearch } from '@miniapp/shared'
import type { MemberFilterValue } from './MemberFilterDialog'

/** True when the filter value carries no actual narrowing (no AST, scope or date). */
export function isEmptyFilter(v: MemberFilterValue | null): boolean {
  if (!v) return true
  return !v.filter && v.groupIds.length === 0 && !v.dateFrom && !v.dateTo
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

  const pageSize = opts.pageSize ?? 100
  const maxPages = opts.maxPages ?? 20
  const ids: number[] = []
  let total: number | null = null
  let page = 1

  for (; page <= maxPages; page++) {
    const res = await memberSearch(agentId, {
      group_ids: value.groupIds.length ? value.groupIds : undefined,
      filter: value.filter ?? undefined,
      date_from: value.dateFrom || undefined,
      date_to: value.dateTo || undefined,
      sort: value.sort,
      page,
      page_size: pageSize,
      include_total: page === 1,
    })
    for (const item of res.items ?? []) {
      ids.push(item.tg_user_id)
    }
    if (page === 1 && res.total !== null && res.total !== undefined) {
      total = res.total
    }
    if (!res.has_more || res.items.length === 0) break
  }

  return { ids, total }
}
