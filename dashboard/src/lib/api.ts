import axios from 'axios'
import type {
  AIProviderDefaults,
  BulkJob,
  Member,
  ModAction,
  Rule,
  RuleKey,
  TimelineEvent,
  Workspace,
  TeamWorkspace,
  TeamWorkspaceMember,
  WorkspaceRole,
  WorkspaceUsage,
  OwnerGroup,
  OwnerMetrics,
  OwnerSubscriptionRequest,
  AutomationTask,
  DashboardStats,
  GroupSettings,
  ModerationLogEntry,
  WarningEntry,
  Agent,
  AgentJobRecord,
  TaskCatalogItem,
  NotificationReport,
  AccessGateInfo,
  PromotionCode,
  WhatsAppAnalytics,
  WhatsAppChannel,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppLead,
  WhatsAppAutomation,
  WhatsAppNotificationSettings,
  SettingsSchemaCatalog,
  AdminOverview,
  AIModel,
} from '../lib/types'

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_URL
  const { protocol, hostname, port, origin } = window.location

  if (configuredBaseUrl) {
    try {
      const parsed = new URL(configuredBaseUrl, origin)
      const configuredHost = parsed.hostname
      const pageIsLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
      const apiIsLocalhost = configuredHost === 'localhost' || configuredHost === '127.0.0.1'

      if (!apiIsLocalhost || pageIsLocalhost) {
        return parsed.toString().replace(/\/$/, '')
      }
    } catch {
      return configuredBaseUrl
    }
  }
  if (port === '5173' || port === '5174') {
    return `${protocol}//${hostname}:8000`
  }

  return origin
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
})

const AUTH_API_PREFIX = '/api/auth'
const ADMIN_API_PREFIX = '/api/admin'
const AGENTS_API_PREFIX = '/api/agents'
const OWNER_API_PREFIX = '/webapp/owner'
const WORKSPACE_API_PREFIX = '/api/workspace'

api.interceptors.request.use((config) => {
  // Don't clobber an explicitly-set Authorization header (e.g. fetchCurrentUser
  // during login, which must use the freshly-issued token, not whatever stale
  // token from a previous session is still sitting in localStorage).
  if (!config.headers.Authorization) {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  config.headers['X-App-Boundary'] = 'admin'
  return config
})

api.interceptors.response.use(
  (response) => response,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
      window.location.href = '/dashboard/login'
    }
    return Promise.reject(err)
  },
)

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const { data } = await api.post('/auth/email/login', { email, password })
  return data
}

export async function phoneLogin(phoneNumber: string, password: string) {
  const { data } = await api.post('/auth/phone/login', { phone_number: phoneNumber, password })
  return data
}

export async function telegramLogin(payload: Record<string, unknown>) {
  const { data } = await api.post('/auth/telegram/login', payload)
  return data
}

export async function fetchCurrentUser(token?: string) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  const { data } = await api.get(`${AUTH_API_PREFIX}/me`, { headers })
  return data
}

export async function updateProfile(payload: { full_name?: string; phone_number?: string }) {
  const { data } = await api.patch(`${AUTH_API_PREFIX}/profile`, payload)
  return data
}

export async function changePassword(payload: { current_password?: string; new_password: string }) {
  const { data } = await api.post(`${AUTH_API_PREFIX}/change-password`, payload)
  return data
}

// ─── Team Workspaces ──────────────────────────────────────────────────────────

export async function fetchTeamWorkspaces(): Promise<{ workspaces: TeamWorkspace[] }> {
  const { data } = await api.get<{ workspaces: TeamWorkspace[] }>(WORKSPACE_API_PREFIX)
  return data
}

export async function createTeamWorkspace(name: string): Promise<TeamWorkspace> {
  const { data } = await api.post<TeamWorkspace>(WORKSPACE_API_PREFIX, { name })
  return data
}

export async function fetchTeamWorkspaceMembers(
  workspaceId: number,
): Promise<{ members: TeamWorkspaceMember[] }> {
  const { data } = await api.get<{ members: TeamWorkspaceMember[] }>(
    `${WORKSPACE_API_PREFIX}/${workspaceId}/members`,
  )
  return data
}

export async function inviteTeamWorkspaceMember(
  workspaceId: number,
  identifier: string,
  role: WorkspaceRole = 'member',
): Promise<{ user_id: number; role: WorkspaceRole }> {
  const { data } = await api.post(`${WORKSPACE_API_PREFIX}/${workspaceId}/invite`, { identifier, role })
  return data
}

export async function removeTeamWorkspaceMember(workspaceId: number, memberUserId: number): Promise<void> {
  await api.delete(`${WORKSPACE_API_PREFIX}/${workspaceId}/members/${memberUserId}`)
}

export async function changeTeamWorkspaceMemberRole(
  workspaceId: number,
  memberUserId: number,
  role: WorkspaceRole,
): Promise<{ user_id: number; role: WorkspaceRole }> {
  const { data } = await api.patch(
    `${WORKSPACE_API_PREFIX}/${workspaceId}/members/${memberUserId}/role`,
    { role },
  )
  return data
}

export async function fetchWorkspaceUsage(): Promise<WorkspaceUsage> {
  const { data } = await api.get<WorkspaceUsage>('/api/usage')
  return data
}

export async function redeemPromoCode(code: string): Promise<{ success: boolean; plan: string; status: string; expires_at: string | null; message: string }> {
  const { data } = await api.post('/api/redeem-code', { code })
  return data
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export async function fetchGroups(): Promise<{ id: number; title: string; tg_group_id: number }[]> {
  const { data } = await api.get('/groups')
  return data
}

// ─── Group Overview ──────────────────────────────────────────────────────────

export async function fetchGroupOverview(groupId: number) {
  const { data } = await api.get(`${ADMIN_API_PREFIX}/groups/${groupId}/overview`)
  return data
}

export async function fetchGroupSettings(groupId: number): Promise<GroupSettings> {
  const { data } = await api.get<GroupSettings>(`${ADMIN_API_PREFIX}/groups/${groupId}/settings`)
  return data
}

export async function updateGroupSettings(groupId: number, settings: Record<string, boolean | number | string>) {
  const { data } = await api.patch(`${ADMIN_API_PREFIX}/groups/${groupId}/settings`, { settings })
  return data
}

export async function fetchSettingsSchema(): Promise<SettingsSchemaCatalog> {
  const { data } = await api.get<SettingsSchemaCatalog>('/settings/schema')
  return data
}

export async function fetchAIProviderDefaults(): Promise<AIProviderDefaults> {
  const { data } = await api.get<AIProviderDefaults>(`${ADMIN_API_PREFIX}/ai-provider-defaults`)
  return data
}

export async function fetchAIModels(): Promise<AIModel[]> {
  const { data } = await api.get<AIModel[]>(`${ADMIN_API_PREFIX}/ai-provider-models`)
  return data
}

export async function syncAIModels(): Promise<{ status: string; models: AIModel[] }> {
  const { data } = await api.post<{ status: string; models: AIModel[] }>(`${ADMIN_API_PREFIX}/ai-provider-models/sync`)
  return data
}

export async function testAIPilot(payload: {
  provider?: string
  model?: string
  provider_url?: string
  api_key?: string
}): Promise<{ status: string; reply?: string; error?: string; detail?: string }> {
  const { data } = await api.post('/pilot/test', payload)
  return data
}

export async function fetchAccessGate(groupId: number): Promise<AccessGateInfo> {
  const { data } = await api.get<AccessGateInfo>(`${ADMIN_API_PREFIX}/groups/${groupId}/access-gate`)
  return data
}

export async function updateAccessGate(groupId: number, requiredGroupTgIds: number[]) {
  const { data } = await api.patch(`${ADMIN_API_PREFIX}/groups/${groupId}/access-gate`, { required_group_tg_ids: requiredGroupTgIds })
  return data
}

// ─── Moderation ──────────────────────────────────────────────────────────────

export async function fetchModerationLogs(groupId: number, limit = 50): Promise<ModerationLogEntry[]> {
  const { data } = await api.get<ModerationLogEntry[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/logs`, { params: { limit } })
  return data
}

export async function performModerationAction(groupId: number, payload: {
  user_id: number
  action: ModAction
  reason?: string
  count?: number
}) {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/moderation/actions`, payload)
  return data
}

export async function fetchWarnings(groupId: number): Promise<WarningEntry[]> {
  const { data } = await api.get<WarningEntry[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/moderation/warnings`)
  return data
}

export async function addWarning(groupId: number, payload: { user_id: number; reason?: string; count?: number }) {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/moderation/warnings`, payload)
  return data
}

export async function clearWarnings(groupId: number, userId: number) {
  const { data } = await api.delete(`${ADMIN_API_PREFIX}/groups/${groupId}/moderation/warnings/${userId}`)
  return data
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function fetchMembers(groupId: number, q?: string): Promise<Member[]> {
  const { data } = await api.get<Member[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/members`, { params: q ? { q } : undefined })
  return data
}

export async function searchMembers(groupId: number, query: string, limit = 50): Promise<Member[]> {
  const { data } = await api.get<Member[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/member-search`, { params: { q: query, limit } })
  return data
}

export async function setMemberRole(groupId: number, userId: number, role: string) {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/members/${userId}/role`, { role })
  return data
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export async function toggleRule(groupId: number, ruleKey: RuleKey, enabled: boolean) {
  const { data } = await api.patch(`${ADMIN_API_PREFIX}/groups/${groupId}/settings`, {
    settings: { [`${ruleKey}_enabled`]: enabled },
  })
  return data
}

export async function updateRuleConfig(groupId: number, ruleKey: RuleKey, config: Record<string, boolean | number | string>) {
  const { data } = await api.patch(`${ADMIN_API_PREFIX}/groups/${groupId}/settings`, { settings: config })
  return data
}

// ─── Activity ────────────────────────────────────────────────────────────────

export async function fetchActivity(groupId: number, limit = 50): Promise<TimelineEvent[]> {
  const logs = await fetchModerationLogs(groupId, limit)
  return logs.map((log, i) => ({
    id: log.id || i,
    type: log.action === 'lead_captured' ? 'report' : log.action === 'warn' ? 'moderation' : 'system',
    title: log.action,
    subtitle: log.reason || '',
    timestamp: log.created_at ? new Date(log.created_at).toLocaleString() : '',
    severity: getSeverity(log.action),
  }))
}

function getSeverity(action: string): TimelineEvent['severity'] {
  switch (action) {
    case 'approve': return 'info'
    case 'warn': return 'warn'
    case 'mute': return 'mute'
    case 'ban': return 'ban'
    case 'lead_captured': return 'info'
    default: return 'info'
  }
}

// ─── Notification Reports ────────────────────────────────────────────────────

export async function fetchNotificationReports(groupId: number): Promise<NotificationReport[]> {
  const { data } = await api.get<NotificationReport[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/notification-reports`)
  return data
}

export async function replyToNotificationReport(groupId: number, logId: number, text: string) {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/notification-reports/${logId}/reply`, { text })
  return data
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export async function fetchAgents(groupId?: number): Promise<Agent[]> {
  const params: Record<string, unknown> = {}
  if (groupId !== undefined) params.group_id = groupId
  const { data } = await api.get<Agent[]>(AGENTS_API_PREFIX, { params })
  return data
}

export async function linkAgent(groupId: number, payload: {
  external_account_id: string
  telegram_user_id?: number
  metadata?: Record<string, unknown>
}) {
  const { data } = await api.post(`${AGENTS_API_PREFIX}/link`, { group_id: groupId, ...payload })
  return data
}

export async function fetchAgentJobs(agentId: number): Promise<AgentJobRecord[]> {
  const { data } = await api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${agentId}/jobs`)
  return data
}

export async function createAgentJob(agentId: number, jobType: string, jobPayload: Record<string, unknown>) {
  const { data } = await api.post(`${AGENTS_API_PREFIX}/${agentId}/jobs`, { job_type: jobType, job_payload: jobPayload })
  return data
}

export async function updateAgent(agentId: number, payload: {
  external_account_id: string
  telegram_user_id?: number
  metadata?: Record<string, unknown>
}) {
  const { data } = await api.patch(`${AGENTS_API_PREFIX}/${agentId}`, payload)
  return data
}

export async function deleteAgent(agentId: number) {
  const { data } = await api.delete(`${AGENTS_API_PREFIX}/${agentId}`)
  return data
}

// ─── Tasks / Automation ──────────────────────────────────────────────────────

export async function fetchTaskCatalog(): Promise<TaskCatalogItem[]> {
  const { data } = await api.get<TaskCatalogItem[]>(`${ADMIN_API_PREFIX}/tasks/catalog`)
  return data
}

export async function fetchTasks(groupId: number): Promise<AutomationTask[]> {
  const { data } = await api.get<AutomationTask[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/tasks`)
  return data
}

export async function createTask(groupId: number, payload: {
  assignment_id?: string
  task_key: string
  executor_type: string
  enabled?: boolean
  conditions?: Record<string, unknown>
  config?: Record<string, unknown>
  agent_id?: number
}) {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/tasks`, payload)
  return data
}

export async function updateTask(groupId: number, assignmentId: string, payload: Record<string, unknown>) {
  const { data } = await api.patch(`${ADMIN_API_PREFIX}/groups/${groupId}/tasks/${assignmentId}`, payload)
  return data
}

export async function deleteTask(groupId: number, assignmentId: string) {
  const { data } = await api.delete(`${ADMIN_API_PREFIX}/groups/${groupId}/tasks/${assignmentId}`)
  return data
}

// ─── Scheduled Messages ──────────────────────────────────────────────────────

export interface ScheduledMessage {
  id: string
  group_id: number
  text: string
  schedule: string
  send_at: string
  delete_after_seconds: number | null
}

export async function fetchScheduledMessages(groupId: number): Promise<ScheduledMessage[]> {
  const { data } = await api.get<ScheduledMessage[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/scheduled-messages`)
  return data
}

export async function createScheduledMessage(groupId: number, payload: {
  text: string
  schedule: string
  delete_after_seconds?: number
}) {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/scheduled-messages`, payload)
  return data
}

export async function updateScheduledMessage(groupId: number, entryId: string, payload: Record<string, unknown>) {
  const { data } = await api.patch(`${ADMIN_API_PREFIX}/groups/${groupId}/scheduled-messages/${entryId}`, payload)
  return data
}

export async function deleteScheduledMessage(groupId: number, entryId: string) {
  const { data } = await api.delete(`${ADMIN_API_PREFIX}/groups/${groupId}/scheduled-messages/${entryId}`)
  return data
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

export async function fetchFAQSettings(groupId: number): Promise<any> {
  const { data } = await api.get(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/settings`)
  return data
}

export async function updateFAQSettings(groupId: number, settings: any): Promise<any> {
  const { data } = await api.put(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/settings`, settings)
  return data
}

export async function fetchFAQEntries(groupId: number): Promise<any[]> {
  const { data } = await api.get<any[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/entries`)
  return data
}

export async function deleteFAQEntry(groupId: number, entryId: number): Promise<void> {
  await api.delete(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/entries/${entryId}`)
}

export async function fetchUnansweredQuestions(groupId: number): Promise<any[]> {
  const { data } = await api.get<any[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/unanswered`)
  return data
}

export async function convertUnansweredToFAQ(groupId: number, questionId: number, answer: string): Promise<any> {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/unanswered/${questionId}/convert`, { answer })
  return data
}

export async function testFAQMatch(groupId: number, question: string): Promise<any> {
  const { data } = await api.post(`/api/groups/${groupId}/faq/test-match`, { question })
  return data
}

export async function aiAnalyzeGroupMessages(groupId: number, maxMessages = 1000): Promise<any> {
  const { data } = await api.post(`/api/groups/${groupId}/faq/ai-analyze`, undefined, {
    params: { max_messages: maxMessages },
  })
  return data
}

export async function createFAQEntry(groupId: number, payload: { question: string; answer: string; keywords: string[] }): Promise<any> {
  const { data } = await api.post(`${ADMIN_API_PREFIX}/groups/${groupId}/faq/entries`, payload)
  return data
}

// ─── Summaries ────────────────────────────────────────────────────────────────

export async function fetchSummaries(groupId: number): Promise<any[]> {
  const { data } = await api.get<any[]>(`${ADMIN_API_PREFIX}/groups/${groupId}/summaries`)
  return data
}

export async function fetchSummarySettings(groupId: number): Promise<any> {
  const { data } = await api.get<any>(`${ADMIN_API_PREFIX}/groups/${groupId}/summaries/settings`)
  return data
}

export async function updateSummarySettings(groupId: number, settings: any): Promise<any> {
  const { data } = await api.put(`${ADMIN_API_PREFIX}/groups/${groupId}/summaries/settings`, settings)
  return data
}

// ─── Owner endpoints ─────────────────────────────────────────────────────────

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const { data } = await api.get<AdminOverview>('/api/internal/admin-overview')
  return data
}

export async function fetchOwnerStats(): Promise<DashboardStats> {
  const { data } = await api.get<DashboardStats>(`${OWNER_API_PREFIX}/stats`)
  return data
}

export async function fetchOwnerGroups(): Promise<OwnerGroup[]> {
  const { data } = await api.get<OwnerGroup[]>(`${OWNER_API_PREFIX}/groups`)
  return data
}

export async function fetchOwnerAgents(limit = 100, offset = 0): Promise<Agent[]> {
  const { data } = await api.get<Agent[]>(`${OWNER_API_PREFIX}/agents`, { params: { limit, offset } })
  return data
}

export async function fetchOwnerUsers(): Promise<any[]> {
  const { data } = await api.get<any[]>(`${OWNER_API_PREFIX}/users`)
  return data
}

export async function fetchOwnerGroupDetails(groupId: number) {
  const { data } = await api.get(`${OWNER_API_PREFIX}/groups/${groupId}`)
  return data
}

export async function disableOwnerGroup(groupId: number) {
  const { data } = await api.post(`${OWNER_API_PREFIX}/groups/${groupId}/disable`)
  return data
}

export async function leaveOwnerGroup(groupId: number) {
  const { data } = await api.post(`${OWNER_API_PREFIX}/groups/${groupId}/leave`)
  return data
}

export async function fetchOwnerSubscriptions(): Promise<OwnerSubscriptionRequest[]> {
  const { data } = await api.get<OwnerSubscriptionRequest[]>(`${OWNER_API_PREFIX}/subscriptions`)
  return data
}

export async function updateOwnerSubscription(requestId: number, action: 'approve' | 'decline' | 'cancel', plan?: 'pro' | 'business', response?: string) {
  const { data } = await api.post(`${OWNER_API_PREFIX}/subscriptions/${requestId}`, { action, plan, response })
  return data
}

export async function fetchOwnerPrivateAccessGate() {
  const { data } = await api.get(`${OWNER_API_PREFIX}/private-access-gate`)
  return data
}

export async function updateOwnerPrivateAccessGate(requiredGroupTgIds: number[]) {
  const { data } = await api.patch(`${OWNER_API_PREFIX}/private-access-gate`, { required_group_tg_ids: requiredGroupTgIds })
  return data
}

export async function fetchOwnerAuditLog(limit = 50, offset = 0) {
  const { data } = await api.get(`${OWNER_API_PREFIX}/audit-log`, { params: { limit, offset } })
  return data
}

export async function fetchOwnerPromoCodes(limit = 100): Promise<PromotionCode[]> {
  const { data } = await api.get<PromotionCode[]>(`${OWNER_API_PREFIX}/promo-codes`, { params: { limit } })
  return data
}

export async function createOwnerPromoCode(payload: {
  code: string
  plan: 'pro' | 'business'
  duration_days: number
  max_uses?: number
  expiry_date?: string
  is_active?: boolean
}) {
  const { data } = await api.post(`${OWNER_API_PREFIX}/promo-codes`, payload)
  return data
}

export async function updateOwnerPromoCode(promoCodeId: number, payload: {
  is_active?: boolean
  max_uses?: number
  expiry_date?: string
}) {
  const { data } = await api.patch(`${OWNER_API_PREFIX}/promo-codes/${promoCodeId}`, payload)
  return data
}

export async function deleteOwnerPromoCode(promoCodeId: number) {
  const { data } = await api.delete(`${OWNER_API_PREFIX}/promo-codes/${promoCodeId}`)
  return data
}

// ─── AI Config ─────────────────────────────────────────────────────────────────

export async function fetchAIConfig() {
  const { data } = await api.get(`${OWNER_API_PREFIX}/ai-config`)
  return data
}

export async function updateAIConfig(payload: Record<string, string>) {
  const { data } = await api.put(`${OWNER_API_PREFIX}/ai-config`, payload)
  return data
}

export async function testAIConfig(payload: { provider: string; api_key: string; model: string; base_url: string }) {
  const { data } = await api.post(`${OWNER_API_PREFIX}/ai-config/test`, payload)
  return data
}

// ─── Knowledge ────────────────────────────────────────────────────────────────

export async function fetchKnowledgeGroups() {
  const { data } = await api.get(`${OWNER_API_PREFIX}/knowledge/groups`)
  return data
}

export async function fetchGroupKnowledge(groupId: number) {
  const { data } = await api.get(`${OWNER_API_PREFIX}/knowledge/groups/${groupId}`)
  return data
}

export async function fetchAllKnowledge(params?: { knowledge_type?: string; search?: string; group_id?: number }) {
  const { data } = await api.get(`${OWNER_API_PREFIX}/knowledge/all`, { params })
  return data
}

export async function extractGroupKnowledge(groupId: number, maxMessages = 2000) {
  const { data } = await api.post(`${OWNER_API_PREFIX}/knowledge/groups/${groupId}/extract`, { max_messages: maxMessages })
  return data
}

export async function fetchExtractionStatus(groupId: number) {
  const { data } = await api.get(`${OWNER_API_PREFIX}/knowledge/groups/${groupId}/extract/status`)
  return data
}

export async function deleteKnowledgeEntry(entryId: number) {
  const { data } = await api.delete(`${OWNER_API_PREFIX}/knowledge/${entryId}`)
  return data
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

const WHATSAPP_API_PREFIX = '/api'

export async function connectWhatsAppChannel(): Promise<WhatsAppChannel> {
  const { data } = await api.post<WhatsAppChannel>(`${WHATSAPP_API_PREFIX}/channels/whatsapp/connect`)
  return data
}

export async function disconnectWhatsAppChannel(channelId: number) {
  const { data } = await api.post(`${WHATSAPP_API_PREFIX}/channels/whatsapp/disconnect`, { channel_id: channelId })
  return data
}

export async function fetchWhatsAppChannels(): Promise<WhatsAppChannel[]> {
  const { data } = await api.get<WhatsAppChannel[]>(`${WHATSAPP_API_PREFIX}/channels`)
  return data
}

export async function fetchWhatsAppChannelStatus(channelId: number): Promise<WhatsAppChannel> {
  const { data } = await api.get<WhatsAppChannel>(`${WHATSAPP_API_PREFIX}/channels/${channelId}/status`)
  return data
}

export async function refreshWhatsAppQRCode(channelId: number): Promise<WhatsAppChannel> {
  const { data } = await api.post<WhatsAppChannel>(`${WHATSAPP_API_PREFIX}/channels/${channelId}/refresh-qr`)
  return data
}

export async function fetchWhatsAppConversations(channelId: number): Promise<WhatsAppConversation[]> {
  const { data } = await api.get<WhatsAppConversation[]>(`${WHATSAPP_API_PREFIX}/channels/${channelId}/conversations`)
  return data
}

export async function fetchWhatsAppConversationMessages(conversationId: number): Promise<WhatsAppMessage[]> {
  const { data } = await api.get<WhatsAppMessage[]>(`${WHATSAPP_API_PREFIX}/conversations/${conversationId}`)
  return data
}

export async function sendWhatsAppMessage(conversationId: number, text: string) {
  const { data } = await api.post(`${WHATSAPP_API_PREFIX}/conversations/${conversationId}/send`, { text })
  return data
}

export async function handoffWhatsAppConversation(conversationId: number) {
  const { data } = await api.post(`${WHATSAPP_API_PREFIX}/conversations/${conversationId}/handoff`)
  return data
}

export async function editWhatsAppDraft(messageId: number, text: string) {
  const { data } = await api.patch(`${WHATSAPP_API_PREFIX}/messages/${messageId}`, { text })
  return data
}

export async function sendWhatsAppDraft(messageId: number) {
  const { data } = await api.post(`${WHATSAPP_API_PREFIX}/messages/${messageId}/send-draft`)
  return data
}

export async function discardWhatsAppDraft(messageId: number) {
  const { data } = await api.delete(`${WHATSAPP_API_PREFIX}/messages/${messageId}`)
  return data
}

export async function fetchWhatsAppLeads(channelId: number): Promise<WhatsAppLead[]> {
  const { data } = await api.get<WhatsAppLead[]>(`${WHATSAPP_API_PREFIX}/channels/${channelId}/leads`)
  return data
}

export async function updateWhatsAppLead(leadId: number, status: string) {
  const { data } = await api.patch(`${WHATSAPP_API_PREFIX}/leads/${leadId}`, { status })
  return data
}

export async function fetchWhatsAppAnalytics(channelId: number): Promise<WhatsAppAnalytics> {
  const { data } = await api.get<WhatsAppAnalytics>(`${WHATSAPP_API_PREFIX}/analytics/overview`, { params: { channel_id: channelId } })
  return data
}

export async function fetchWhatsAppAutomations(channelId: number): Promise<WhatsAppAutomation[]> {
  const { data } = await api.get<WhatsAppAutomation[]>(`${WHATSAPP_API_PREFIX}/automations`, { params: { channel_id: channelId } })
  return data
}

export async function updateWhatsAppAutomation(automationId: number, enabled: boolean, config?: Record<string, unknown>) {
  const { data } = await api.patch(`${WHATSAPP_API_PREFIX}/automations/${automationId}`, { enabled, config })
  return data
}

export async function fetchWhatsAppNotificationSettings(channelId: number): Promise<WhatsAppNotificationSettings> {
  const { data } = await api.get<WhatsAppNotificationSettings>(`${WHATSAPP_API_PREFIX}/notification-settings`, { params: { channel_id: channelId } })
  return data
}

export async function updateWhatsAppNotificationSettings(settings: WhatsAppNotificationSettings) {
  const { data } = await api.patch(`${WHATSAPP_API_PREFIX}/notification-settings`, settings)
  return data
}

export async function simulateWhatsAppMessage(channelId: number, text: string, fromNumber?: string) {
  const { data } = await api.post(`${WHATSAPP_API_PREFIX}/dev/simulate-whatsapp-message`, { channel_id: channelId, text, from_number: fromNumber })
  return data
}

// ─── Scraper Conversations ──────────────────────────────────────────────

export interface ScrapedGroupSummary {
  id: number
  tg_group_id: number
  title: string
  username?: string
  group_type: string
  member_count?: number
  updated_at?: string
}

export interface ScrapedConversation {
  id: number
  root_message_id: number | null
  title: string | null
  root_sender_name: string | null
  participant_count: number
  message_count: number
  first_message_at: string | null
  last_message_at: string | null
  is_topic: boolean
}

export interface ConversationMessage {
  id: number
  message_id: number
  sender_user_id: number | null
  sender_username: string | null
  sender_first_name: string | null
  message_text: string | null
  message_type: string
  message_date: string | null
  reply_to_message_id: number | null
}

export async function fetchScrapedGroups(): Promise<ScrapedGroupSummary[]> {
  const { data } = await api.get<ScrapedGroupSummary[]>('/webapp/scraper/groups')
  return data
}

export async function fetchScrapedGroupDetail(groupId: number): Promise<any> {
  const { data } = await api.get(`/webapp/scraper/groups/${groupId}`)
  return data
}

export async function fetchScrapedConversations(
  groupId: number,
  page = 1,
  pageSize = 20,
): Promise<{ total: number; page: number; page_size: number; conversations: ScrapedConversation[] }> {
  const { data } = await api.get(`/webapp/scraper/groups/${groupId}/conversations`, {
    params: { page, page_size: pageSize },
  })
  return data
}

export async function fetchConversationMessages(
  groupId: number,
  convId: number,
): Promise<ConversationMessage[]> {
  const { data } = await api.get<ConversationMessage[]>(
    `/webapp/scraper/groups/${groupId}/conversations/${convId}/messages`,
  )
  return data
}

export async function triggerScrapeGroupInfo(tgGroupId: number, agentId: number): Promise<any> {
  const { data } = await api.post('/webapp/scraper/scrape/group-info', {
    tg_group_id: tgGroupId,
    agent_id: agentId,
  })
  return data
}

export async function triggerScrapeMessages(
  tgGroupId: number,
  agentId: number,
  limit = 100,
  maxAgeDays?: number,
): Promise<any> {
  const { data } = await api.post('/webapp/scraper/scrape/messages', {
    tg_group_id: tgGroupId,
    agent_id: agentId,
    message_limit: limit,
    max_age_days: maxAgeDays,
  })
  return data
}

export async function fetchScrapeJobStatus(jobId: number): Promise<{
  job_id: number
  status: string
  progress?: { total_fetched?: number; total_errors?: number; batches_completed?: number; limit?: number }
  created_at?: string
  updated_at?: string
}> {
  const { data } = await api.get(`/webapp/scraper/jobs/${jobId}/status`)
  return data
}

export interface ScrapeJobSummary {
  job_id: number
  agent_id: number
  agent_phone?: string
  job_type: string
  status: string
  tg_group_id?: number | null
  group_title?: string | null
  member_count?: number | null
  progress?: { total_fetched?: number; total_errors?: number; batches_completed?: number; limit?: number }
  retry_count?: number
  created_at?: string
  updated_at?: string
}

export async function fetchRecentAgentJobs(
  jobType?: string,
  limit = 50,
): Promise<{ job_id: number; agent_id: number; job_type: string; status: string; created_at: string | null }[]> {
  const params: Record<string, any> = { limit }
  if (jobType) params.job_type = jobType
  const { data } = await api.get('/api/admin/jobs', { params })
  return data
}

export async function fetchRecentScrapeJobs(limit = 10): Promise<ScrapeJobSummary[]> {
  const { data } = await api.get(`/webapp/scraper/jobs?limit=${limit}`)
  return data
}

// ─── Search ──────────────────────────────────────────────────────────────

export interface SearchResult {
  id: number
  message_id: number
  sender_user_id: number | null
  sender_username: string | null
  sender_first_name: string | null
  message_text: string | null
  message_date: string | null
  message_type: string
  reply_to_message_id: number | null
}

export async function searchMessages(
  groupId: number,
  query: string,
  filters?: {
    sender_user_id?: number
    message_type?: string
    date_from?: string
    date_to?: string
  },
  page = 1,
  pageSize = 50,
): Promise<{ total: number; page: number; page_size: number; messages: SearchResult[] }> {
  const params: Record<string, any> = { query, page, page_size: pageSize }
  if (filters?.sender_user_id) params.sender_user_id = filters.sender_user_id
  if (filters?.message_type) params.message_type = filters.message_type
  if (filters?.date_from) params.date_from = filters.date_from
  if (filters?.date_to) params.date_to = filters.date_to
  const { data } = await api.get(`/webapp/scraper/groups/${groupId}/search`, { params })
  return data
}

// ─── Export ──────────────────────────────────────────────────────────────

export function getExportUrl(groupId: number, format: 'json' | 'csv', dataType: 'messages' | 'members' | 'conversations'): string {
  return `${api.defaults.baseURL}/webapp/scraper/groups/${groupId}/export?format=${format}&data_type=${dataType}`
}

export async function exportData(groupId: number, format: 'json' | 'csv', dataType: 'messages' | 'members' | 'conversations'): Promise<void> {
  const response = await api.get(`/webapp/scraper/groups/${groupId}/export`, {
    params: { format, data_type: dataType },
    responseType: 'blob',
  })
  const disposition = response.headers['content-disposition'] || ''
  const match = disposition.match(/filename="?(.+?)"?$/)
  const filename = match?.[1] || `${dataType}_${groupId}.${format}`
  const url = URL.createObjectURL(response.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Member Leaderboard ──────────────────────────────────────────────────

export interface LeaderboardMember {
  user_id: number
  username: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  is_bot: boolean
  role: string | null
  message_count: number
  last_active: string | null
  score: number
  share_pct: number
}

export async function fetchMemberLeaderboard(
  groupId: number,
  limit = 50,
  days = 30,
): Promise<{ leaderboard: LeaderboardMember[]; total_active: number }> {
  const { data } = await api.get(`/webapp/scraper/groups/${groupId}/leaderboard`, {
    params: { limit, days },
  })
  return data
}

// ─── Lead CRM ────────────────────────────────────────────────────────────

export interface ScrapedLead {
  id: number
  source_message_id: number | null
  sender_user_id: number | null
  sender_name: string | null
  signal: string
  excerpt: string | null
  contact_info: string | null
  status: string
  confidence: number
  detected_at: string | null
}

export async function extractLeads(groupId: number, limit = 500): Promise<{ leads_found: number; total_leads: number }> {
  const { data } = await api.post(`/webapp/scraper/groups/${groupId}/extract-leads`, null, { params: { limit } })
  return data
}

export async function fetchLeads(
  groupId: number,
  status?: string,
  page = 1,
  pageSize = 50,
): Promise<{ total: number; page: number; page_size: number; leads: ScrapedLead[] }> {
  const params: Record<string, any> = { page, page_size: pageSize }
  if (status) params.status = status
  const { data } = await api.get(`/webapp/scraper/groups/${groupId}/leads`, { params })
  return data
}

export async function updateLead(groupId: number, leadId: number, status: string, notes?: string): Promise<{ status: string }> {
  const { data } = await api.patch(`/webapp/scraper/groups/${groupId}/leads/${leadId}`, { status, notes })
  return data
}

// ─── Admission Intelligence ──────────────────────────────────────────────

export async function fetchAdmissionSearch(
  q: string,
  tgGroupId: number,
  university?: string,
  major?: string,
): Promise<{ answer_context: string; sources: { message: string; date: string; confidence: string }[]; total_matches: number }> {
  const params: Record<string, any> = { q, tg_group_id: tgGroupId }
  if (university) params.university = university
  if (major) params.major = major
  const { data } = await api.get('/api/admissions/search', { params })
  return data
}

export async function fetchCutoffTrend(
  university: string,
  major: string,
  tgGroupId: number,
): Promise<{ trend: string; summary: string; cutoff_history: { date: string; value: number; source: string }[] }> {
  const { data } = await api.get('/api/admissions/cutoff-trend', {
    params: { university, major, tg_group_id: tgGroupId },
  })
  return data
}

export async function fetchStudentConcerns(
  tgGroupId: number,
): Promise<{ topics: { name: string; mentions: number; examples: string[] }[]; method: string }> {
  const { data } = await api.get('/api/admissions/student-concerns', {
    params: { tg_group_id: tgGroupId },
  })
  return data
}

export async function fetchCompareUniversities(
  universityA: string,
  universityB: string,
  major: string,
  tgGroupId: number,
): Promise<{ universities: { name: string; major: string; cutoff: any }[]; notes: string }> {
  const { data } = await api.get('/api/admissions/compare-universities', {
    params: { university_a: universityA, university_b: universityB, major, tg_group_id: tgGroupId },
  })
  return data
}

// ─── Admission Overview ─────────────────────────────────────────────────

export interface OverviewStats {
  messages_today: number
  messages_this_week: number
  active_groups: number
  monitored_groups: number
}

export interface TrendingUniversity {
  name: string
  mention_count_7d: number
  mention_count_1d: number
  trend: string
}

export interface HotTopic {
  topic: string
  mentions: number
  trend: string
}

export interface AdmissionOverview {
  stats: OverviewStats
  trending_universities: TrendingUniversity[]
  hot_topics: HotTopic[]
  last_updated: string
}

export async function fetchAdmissionOverview(): Promise<AdmissionOverview> {
  const { data } = await api.get('/api/admissions/overview')
  return data
}

export interface ActivityPoint {
  date: string
  message_count: number
}

export async function fetchAdmissionActivity(): Promise<{ daily: ActivityPoint[] }> {
  const { data } = await api.get('/api/admissions/activity')
  return data
}

export async function fetchAdmissionUniversities(): Promise<{ universities: string[]; total: number }> {
  const { data } = await api.get('/api/admissions/universities')
  return data
}

export interface AdmissionLead {
  sender_user_id: number | null
  sender_name: string
  message_text: string
  signal: string
  confidence: number
  mentioned_universities: string[]
  message_date: string
  tg_group_id: number | null
}

export async function fetchAdmissionClassify(q: string): Promise<{ intent: string; reason: string; entities: Record<string, any> }> {
  const { data } = await api.get('/api/admissions/classify', { params: { q } })
  return data
}

export async function fetchAdmissionSuggestions(): Promise<{ label: string; query: string }[]> {
  const { data } = await api.get('/api/admissions/suggestions')
  return data
}

export async function fetchAdmissionLeads(hoursBack = 24, minConfidence = 0.3): Promise<{ leads: AdmissionLead[]; total: number }> {
  const { data } = await api.get('/api/admissions/extract-leads', {
    params: { hours_back: hoursBack, min_confidence: minConfidence },
  })
  return data
}

// ─── Engagement Nudges ──────────────────────────────────────────────────

export interface NudgeSuggestion {
  type: string
  severity: string
  message: string
  action: string
}

export interface NudgeData {
  last_message_days: number | null
  messages_24h: number
  messages_7d: number
  peak_hours: [number, number][] | null
  suggestions: NudgeSuggestion[]
}

export async function fetchNudges(groupId: number): Promise<NudgeData> {
  const { data } = await api.get(`/webapp/scraper/groups/${groupId}/nudges`)
  return data
}

export default api
