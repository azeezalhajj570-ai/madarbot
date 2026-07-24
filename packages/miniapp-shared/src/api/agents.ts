import { apiClient, ensureMiniappToken } from './base'
import type {
  Agent,
  AgentAnalytics,
  AgentBlacklistEntry,
  AgentGroupMember,
  AgentGroupMemberMessagesPage,
  AgentGroupMembersPage,
  AgentLead,
  AgentLeadPage,
  AgentLeadStats,
  AgentNotificationsResponse,
  AgentGroupScrapeResult,
  AgentJobRecord,
  AgentManagedGroup,
  AutomationTask,
  BlacklistAddEntry,
  BlacklistListResponse,
  BlacklistResolveResponse,
  BulkPreflightResult,
  Campaign,
  CampaignList,
  CampaignRecurrenceLogList,
  CampaignSendLogList,
  SendLogsResponse,
  TaskCatalogItem,
} from '../types'

const AGENTS_API_PREFIX = '/api/agents'

export async function fetchAgents(_groupId?: number | null) {
  return apiClient.get<Agent[]>(AGENTS_API_PREFIX)
}

export async function linkAgent(groupId: number | null | undefined, payload: {
  external_account_id?: string
  name?: string
  phone_number?: string
  telegram_user_id?: number
  metadata?: Record<string, unknown>
}) {
  return apiClient.post(`${AGENTS_API_PREFIX}/link`, { ...(groupId ? { group_id: groupId } : {}), ...payload })
}

export async function startAgentAuth(groupId: number | null, phoneNumber: string, agentId?: number | null) {
  return apiClient.post(`${AGENTS_API_PREFIX}/auth/start`, {
    ...(groupId ? { group_id: groupId } : {}),
    ...(agentId ? { agent_id: agentId } : {}),
    phone_number: phoneNumber,
  })
}

export async function submitAgentCode(agentId: number, code: string) {
  return apiClient.post(`${AGENTS_API_PREFIX}/${agentId}/auth/code`, { code })
}

export async function submitAgentPassword(agentId: number, password: string) {
  return apiClient.post(`${AGENTS_API_PREFIX}/${agentId}/auth/password`, { password })
}

export async function updateAgent(agentId: number, payload: {
  external_account_id?: string
  name?: string
  phone_number?: string
  telegram_user_id?: number
  metadata?: Record<string, unknown>
}) {
  return apiClient.patch(`${AGENTS_API_PREFIX}/${agentId}`, payload)
}

export async function deleteAgent(agentId: number) {
  return apiClient.delete(`${AGENTS_API_PREFIX}/${agentId}`)
}

export async function fetchAgentJobs(agentId: number, jobType?: string, limit?: number) {
  return apiClient.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${agentId}/jobs`, { job_type: jobType, limit })
}

export async function cancelAgentJob(agentId: number, jobId: number) {
  return apiClient.post<{ status: string; job_id: number; new_status: string }>(`${AGENTS_API_PREFIX}/${agentId}/jobs/${jobId}/cancel`)
}

export async function retryAgentJob(agentId: number, jobId: number) {
  return apiClient.post<{ status: string; job_id: number; new_status: string }>(`${AGENTS_API_PREFIX}/${agentId}/jobs/${jobId}/retry`)
}

export async function fetchAgentSendLogs(agentId: number, limit = 100, offsetId?: number, jobId?: number) {
  return apiClient.get<SendLogsResponse>(`${AGENTS_API_PREFIX}/${agentId}/send-logs`, { limit, offset_id: offsetId, job_id: jobId })
}

export async function fetchAgentNotifications(agentId: number, limit = 50) {
  return apiClient.get<AgentNotificationsResponse>(`${AGENTS_API_PREFIX}/${agentId}/notifications`, { limit })
}

export async function markAgentNotificationsSeen(agentId: number) {
  return apiClient.post(`${AGENTS_API_PREFIX}/${agentId}/notifications/mark-seen`)
}

export async function createAgentJob(agentId: number, jobType: string, jobPayload: Record<string, unknown>, scheduledAt?: string) {
  return apiClient.post(`${AGENTS_API_PREFIX}/${agentId}/jobs`, { job_type: jobType, job_payload: jobPayload, scheduled_at: scheduledAt })
}

export async function syncAgentWorkspace(agentId: number) {
  return apiClient.post(`${AGENTS_API_PREFIX}/${agentId}/sync-workspace`)
}

export async function fetchAgentStatus(agentId: number) {
  return apiClient.get<Agent>(`${AGENTS_API_PREFIX}/${agentId}/status`)
}

export async function fetchAgentGroups(agentId: number, query?: string) {
  return apiClient.get<AgentManagedGroup[]>(`${AGENTS_API_PREFIX}/${agentId}/groups`, { q: query })
}

export async function preflightBulkMessage(agentId: number, payload: {
  target_type?: string
  source_group_id?: number
  source_group_title?: string
  messages: string[]
  media_urls?: (string | null)[]
  selected_user_ids?: number[]
  target_group_ids?: number[]
  threshold?: number
  interval_seconds?: number
  interval_between_contacts?: number
  messages_per_day?: number
}) {
  return apiClient.post<BulkPreflightResult>(`${AGENTS_API_PREFIX}/${agentId}/jobs/bulk-preflight`, payload)
}

export async function searchAgentGroupMembers(agentId: number, tgGroupId: number, query?: string, limit = 20, excludeBots = false, page = 1, orderBy = 'message_count', excludeAdmins = false, onlyBots = false) {
  return apiClient.get<AgentGroupMembersPage>(`${AGENTS_API_PREFIX}/${agentId}/member-search`, {
    tg_group_id: tgGroupId,
    q: query || undefined,
    limit,
    page,
    order_by: orderBy,
    exclude_admins: excludeAdmins,
    exclude_bots: excludeBots,
    only_bots: onlyBots,
  })
}

export async function fetchAgentGroupMembers(agentId: number, tgGroupId: number, query?: string, page = 1, pageSize = 10, orderBy = 'message_count') {
  return apiClient.get<AgentGroupMembersPage>(`${AGENTS_API_PREFIX}/${agentId}/groups/${tgGroupId}/members`, {
    q: query,
    page,
    page_size: pageSize,
    order_by: orderBy,
  })
}

export async function fetchAgentGroupMemberMessages(agentId: number, tgGroupId: number, userId: number, page = 1, pageSize = 25) {
  return apiClient.get<AgentGroupMemberMessagesPage>(
    `${AGENTS_API_PREFIX}/${agentId}/groups/${tgGroupId}/members/${userId}/messages`,
    {
      page,
      page_size: pageSize,
    },
  )
}

export async function scrapeAgentGroupMembers(
  agentId: number,
  tgGroupId: number,
  options?: {
    limit?: number
    message_limit?: number
    max_age_days?: number
  },
) {
  return apiClient.post<AgentGroupScrapeResult>(
    `${AGENTS_API_PREFIX}/${agentId}/groups/${tgGroupId}/scrape-members`,
    undefined,
    options,
  )
}

export async function fetchTaskCatalog() {
  return apiClient.get<TaskCatalogItem[]>('/webapp/tasks/catalog')
}

export async function fetchGroupTasks(groupId: number) {
  return apiClient.get<AutomationTask[]>(`/webapp/groups/${groupId}/tasks`)
}

export async function createGroupTask(groupId: number, payload: {
  assignment_id?: string
  task_key: string
  executor_type: string
  enabled?: boolean
  conditions?: Record<string, unknown>
  config?: Record<string, unknown>
  agent_id?: number
  group_ids?: number[]
  group_tg_ids?: number[]
  group_titles?: string[]
}) {
  return apiClient.post(`/webapp/groups/${groupId}/tasks`, payload)
}

export async function updateGroupTask(groupId: number, assignmentId: string, payload: {
  assignment_id?: string
  task_key: string
  executor_type: string
  enabled?: boolean
  conditions?: Record<string, unknown>
  config?: Record<string, unknown>
  agent_id?: number
  group_ids?: number[]
  group_tg_ids?: number[]
  group_titles?: string[]
}) {
  return apiClient.patch(`/webapp/groups/${groupId}/tasks/${assignmentId}`, payload)
}

export async function deleteGroupTask(groupId: number, assignmentId: string) {
  return apiClient.delete(`/webapp/groups/${groupId}/tasks/${assignmentId}`)
}

export async function fetchSubscriptionStatus() {
  return apiClient.get<{ status: 'active' | 'inactive'; plan: 'pro' | 'business' | null; expires_at: string | null }>(`${AGENTS_API_PREFIX}/subscription/status`)
}

export async function redeemPromoCode(code: string) {
  return apiClient.post<{ success: boolean; status: string; plan: 'pro' | 'business' | null; expires_at: string | null; message: string }>(`${AGENTS_API_PREFIX}/subscription/redeem`, { code })
}

export async function createSubscriptionCheckout(plan: 'pro' | 'business', successUrl: string, cancelUrl: string) {
  return apiClient.post<{ url: string; session_id: string }>(`${AGENTS_API_PREFIX}/subscription/checkout/stripe`, {
    plan,
    success_url: successUrl,
    cancel_url: cancelUrl,
  })
}

export async function cancelSubscription() {
  return apiClient.post<{ status: string; message: string }>(`${AGENTS_API_PREFIX}/subscription/cancel`)
}

export async function createMCPToken(name: string, expiresInDays?: number) {
  return apiClient.post<{ token: string; token_data: MCPTokenData }>(`/api/mcp/tokens`, { name, expires_in_days: expiresInDays })
}

export async function listMCPTokens() {
  return apiClient.get<MCPTokenData[]>(`/api/mcp/tokens`)
}

export async function revokeMCPToken(tokenId: number) {
  return apiClient.delete<{ status: string; token_data: MCPTokenData }>(`/api/mcp/tokens/${tokenId}`)
}

export interface MCPTokenData {
  id: number
  name: string
  prefix: string
  status: 'active' | 'expired' | 'revoked'
  expires_at: string | null
  created_at: string | null
  revoked_at: string | null
}

export async function updateAgentSafety(agentId: number, payload: {
  max_actions_per_hour?: number
  max_messages_per_day?: number
  min_delay_seconds?: number
  cooldown_minutes?: number
  safety_mode_enabled?: boolean
  safety_mode_hours?: number
}) {
  return apiClient.patch(`${AGENTS_API_PREFIX}/${agentId}/safety`, payload)
}

export async function fetchAgentLeads(agentId: number, options?: {
  status?: string
  lead_label?: string
  page?: number
  page_size?: number
}) {
  return apiClient.get<AgentLeadPage>(`${AGENTS_API_PREFIX}/${agentId}/leads`, options)
}

export async function fetchAgentLeadStats(agentId: number) {
  return apiClient.get<AgentLeadStats>(`${AGENTS_API_PREFIX}/${agentId}/leads/stats`)
}

export async function updateAgentLead(agentId: number, leadId: number, payload: {
  status?: string
  assigned_to?: number
  contact_info?: string
  notes?: string
  lead_label?: string
  confidence?: number
}) {
  return apiClient.patch(`${AGENTS_API_PREFIX}/${agentId}/leads/${leadId}`, payload)
}

export async function deleteAgentLead(agentId: number, leadId: number) {
  return apiClient.delete(`${AGENTS_API_PREFIX}/${agentId}/leads/${leadId}`)
}

export async function reconcileStaleJobs(maxHours = 1, markFailed = false) {
  return apiClient.post(`${AGENTS_API_PREFIX}/jobs/reconcile-stale`, { max_hours: maxHours, mark_failed: markFailed })
}

export async function syncAgentGroupAdminsBots(agentId: number, tgGroupId: number) {
  return apiClient.post<{ status: string; message: string }>(
    `/webapp/agents/${agentId}/groups/${tgGroupId}/sync-admins-bots`,
  )
}

export async function fetchAgentAnalytics(agentId: number) {
  return apiClient.get<AgentAnalytics>(`${AGENTS_API_PREFIX}/${agentId}/analytics`)
}

export async function createCampaign(agentId: number, payload: {
  name: string
  description?: string
  type?: string
  message_template: string
  target_filters?: Record<string, unknown>
  scheduled_at?: string
  recurrence_enabled?: boolean
  repeat_type?: string
  interval_value?: number
  repeat_time?: string
  cron_expression?: string
  end_type?: string
  end_value?: string
  timezone?: string
}) {
  return apiClient.post<Campaign>(`${AGENTS_API_PREFIX}/${agentId}/campaigns`, payload)
}

export async function listCampaigns(agentId: number, options?: { status?: string; page?: number; page_size?: number }) {
  return apiClient.get<CampaignList>(`${AGENTS_API_PREFIX}/${agentId}/campaigns`, options)
}

export async function getCampaign(agentId: number, campaignId: number) {
  return apiClient.get<Campaign>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}`)
}

export async function updateCampaign(agentId: number, campaignId: number, payload: {
  name?: string
  description?: string
  type?: string
  message_template?: string
  target_filters?: Record<string, unknown>
  scheduled_at?: string
  recurrence_enabled?: boolean
  repeat_type?: string
  interval_value?: number
  repeat_time?: string
  cron_expression?: string
  end_type?: string
  end_value?: string
  timezone?: string
}) {
  return apiClient.patch<Campaign>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}`, payload)
}

export async function deleteCampaign(agentId: number, campaignId: number) {
  return apiClient.delete<{ status: string }>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}`)
}

export async function sendCampaign(agentId: number, campaignId: number, payload?: {
  interval_seconds?: number
  threshold?: number
}) {
  return apiClient.post<{ status: string; started_at: string; jobs_created: number; jobs_failed: number; jobs: Array<{ id: number | null; tg_group_id: number; status?: string; error?: string }> }>(
    `${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/send`, payload || {}
  )
}

export async function activateCampaign(agentId: number, campaignId: number) {
  return apiClient.post<Campaign>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/activate`)
}

export async function pauseCampaign(agentId: number, campaignId: number) {
  return apiClient.post<Campaign>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/pause`)
}

export async function resumeCampaign(agentId: number, campaignId: number) {
  return apiClient.post<Campaign>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/resume`)
}

export async function runCampaignNow(agentId: number, campaignId: number) {
  return apiClient.post(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/run-now`, {})
}

export async function getCampaignRecurrenceLogs(agentId: number, campaignId: number, options?: { page?: number; page_size?: number }) {
  return apiClient.get<CampaignRecurrenceLogList>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/recurrence-logs`, options)
}

export async function getCampaignSendLogs(agentId: number, campaignId: number, options?: { status?: string; page?: number; page_size?: number }) {
  return apiClient.get<CampaignSendLogList>(`${AGENTS_API_PREFIX}/${agentId}/campaigns/${campaignId}/send-logs`, options)
}

export async function fetchBlacklist(agentId: number) {
  return apiClient.get<BlacklistListResponse>(`/webapp/agents/${agentId}/blacklist`)
}

export async function addBlacklistEntries(agentId: number, entries: BlacklistAddEntry[]) {
  return apiClient.post<AgentBlacklistEntry[]>(`/webapp/agents/${agentId}/blacklist`, { entries })
}

export async function deleteBlacklistEntry(agentId: number, entryId: number) {
  return apiClient.delete(`/webapp/agents/${agentId}/blacklist/${entryId}`)
}

export async function resolveBlacklistPhones(agentId: number, phones: string[]) {
  return apiClient.post<BlacklistResolveResponse>(`/webapp/agents/${agentId}/blacklist/resolve`, { phones })
}

export async function uploadAgentMedia(agentId: number, file: File) {
  const token = await ensureMiniappToken()
  const headers: Record<string, string> = {
    'X-App-Boundary': 'agents',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else {
    const initData = window.Telegram?.WebApp?.initData?.trim()
    if (initData) {
      headers['X-Telegram-Init-Data'] = initData
    }
  }

  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/webapp/agents/${agentId}/media/upload`, { method: 'POST', headers, body: form })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 100) || `Upload failed with status ${res.status}`)
  }
  return res.json() as Promise<{ url: string }>
}
