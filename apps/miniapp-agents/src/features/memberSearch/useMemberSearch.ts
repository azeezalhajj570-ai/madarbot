import { useCallback, useEffect, useRef, useState } from 'react'
import { memberSearch } from '@miniapp/shared'
import type { MemberSearchNode, MemberSearchResult, MemberSearchSort } from '@miniapp/shared'
import type { KeywordMode } from './types'
import { isFilterUsable } from './types'

const DEBOUNCE_MS = 350

export interface MemberSearchParams {
  agentId: number
  groupIds: number[]
  filter: MemberSearchNode | null
  dateFrom?: string | null
  dateTo?: string | null
  sort: MemberSearchSort
  page: number
  pageSize: number
  includeTotal: boolean
}

export interface MemberSearchState {
  results: MemberSearchResult | null
  searching: boolean
  error: string | null
  /** Version of the executed query — results only apply if still current. */
  queryId: number
}

const EMPTY_RESULTS: MemberSearchResult = {
  items: [],
  page: 1,
  page_size: 50,
  has_more: false,
  total: 0,
}

/**
 * Executes member searches with debouncing and request cancellation.
 *
 * - Free-text / filter edits trigger a debounced (350ms) auto-search.
 * - Every request carries an AbortController; starting a new search aborts
 *   the in-flight one, so an obsolete response can never overwrite newer
 *   results.
 */
export function useMemberSearch() {
  const [params, setParams] = useState<MemberSearchParams | null>(null)
  const [state, setState] = useState<MemberSearchState>({
    results: null,
    searching: false,
    error: null,
    queryId: 0,
  })

  const abortRef = useRef<AbortController | null>(null)
  const queryIdRef = useRef(0)
  const debounceRef = useRef<number | null>(null)

  const run = useCallback((next: MemberSearchParams, immediate = false) => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const execute = () => {
      const queryId = ++queryIdRef.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState((prev) => ({ ...prev, searching: true, error: null, queryId }))

      void memberSearch(
        next.agentId,
        {
          group_ids: next.groupIds.length ? next.groupIds : undefined,
          filter: next.filter,
          date_from: next.dateFrom || undefined,
          date_to: next.dateTo || undefined,
          sort: next.sort,
          page: next.page,
          page_size: next.pageSize,
          include_total: next.includeTotal,
        },
        controller.signal,
      )
        .then((res: MemberSearchResult) => {
          if (queryIdRef.current !== queryId) return // stale — newer query in flight
          setState((prev) => ({ ...prev, results: res, searching: false, error: null }))
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || queryIdRef.current !== queryId) return
          setState((prev) => ({
            ...prev,
            searching: false,
            error: err instanceof Error ? err.message : 'Search failed',
          }))
        })
    }

    if (immediate) {
      execute()
    } else {
      debounceRef.current = window.setTimeout(execute, DEBOUNCE_MS)
    }
  }, [])

  /** Debounced auto-search when the filter/scope changes. Resets to page 1. */
  const autoSearch = useCallback(
    (next: Omit<MemberSearchParams, 'page'>) => {
      run({ ...next, page: 1 })
    },
    [run],
  )

  /** Immediate explicit search (form submit / pagination). */
  const searchNow = useCallback(
    (next: MemberSearchParams) => {
      run(next, true)
    },
    [run],
  )

  /** Cancel any pending debounce / in-flight request. */
  const cancel = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    abortRef.current?.abort()
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  return {
    params,
    setParams,
    results: state.results,
    searching: state.searching,
    error: state.error,
    queryId: state.queryId,
    autoSearch,
    searchNow,
    cancel,
    EMPTY_RESULTS,
  }
}

export function emptyResult(): MemberSearchResult {
  return { ...EMPTY_RESULTS }
}

export { isFilterUsable }
