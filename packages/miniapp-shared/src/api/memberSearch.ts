import { apiClient } from './base'
import type { MemberSearchNode, MemberSearchResult, MemberSearchSort } from '../types'

const MEMBER_SEARCH_PREFIX = '/webapp/agents'

export interface MemberSearchPayload {
  group_ids?: number[]
  filter?: MemberSearchNode | null
  date_from?: string | null
  date_to?: string | null
  page?: number
  page_size?: number
  sort?: MemberSearchSort
  include_total?: boolean
}

/**
 * Execute a dynamic member-search filter against the backend query engine.
 * The filter AST is evaluated entirely server-side (validated, normalized and
 * compiled to parameterized SQL); the browser only receives a page of members.
 *
 * Pass an AbortSignal to cancel an obsolete request — a newer search can
 * replace an in-flight one without stale results overwriting it.
 */
export async function memberSearch(
  agentId: number,
  payload: MemberSearchPayload,
  signal?: AbortSignal,
) {
  return apiClient.post<MemberSearchResult>(
    `${MEMBER_SEARCH_PREFIX}/${agentId}/member-search`,
    payload,
    undefined,
    signal,
  )
}
