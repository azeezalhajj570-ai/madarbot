export type JobStatus = 'running' | 'done' | 'failed' | 'queued'
export type MemberStatus = 'pending' | 'added' | 'failed'
export type ModAction = 'approve' | 'warn' | 'mute' | 'ban'
export type RuleKey =
  | 'anti_spam'
  | 'bot_install'
  | 'link_blocking'
  | 'flood_protection'
  | 'banned_words'
  | 'welcome_message'
  | 'auto_reply'
  | 'lead_capture'

export interface Workspace {
  id: number
  name: string
  username: string
  memberCount: number
  healthScore: number
  isOwner: boolean
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface TeamWorkspace {
  id: number
  name: string
  slug: string | null
  role: WorkspaceRole
  member_count: number
  subscription: { plan: string | null; status: string } | null
}

export interface TeamWorkspaceMember {
  user_id: number
  tg_user_id: number | null
  username: string | null
  full_name: string | null
  role: WorkspaceRole
  joined_at: string
}

export interface WorkspaceUsage {
  plan: string | null
  plan_slug: string | null
  status: string | null
  source: 'workspace' | 'legacy' | 'none'
  expires_at: string | null
  resources: {
    agents: { active: number; limit: number | null }
    groups: { active: number; limit: number | null }
  }
}

export interface ModQueueItem {
  id: number
  userId: number
  displayName: string
  username: string
  initials: string
  reason: string
  timestamp: string
  messagePreview: string
}

export interface TimelineEvent {
  id: number
  type: 'moderation' | 'system' | 'report'
  title: string
  subtitle: string
  timestamp: string
  severity?: 'warn' | 'mute' | 'ban' | 'info'
}

export interface Rule {
  key: RuleKey
  label: string
  description: string
  enabled: boolean
  actionOnly?: boolean
}

export interface Member {
  id: number
  displayName: string
  username: string
  initials: string
  role: 'member' | 'admin' | 'owner'
  joinedAt: string
}

export interface BulkJob {
  id: string
  targetGroup: string
  sourceGroup: string
  total: number
  added: number
  failed: number
  pending: number
  status: JobStatus
  startedAt: string
  scheduledFor?: string
}

export interface AutomationTask {
  id: string
  taskType: 'message_forward' | 'auto_reply' | 'lead_notify' | 'broadcast'
  executorType: 'agent' | 'bot'
  agentOrBot: string
  sourceGroup: string
  replyMode: 'direct' | 'thread' | 'private'
  destination: string
  suggestedPrivateReply: string
  deliveryMode: 'immediate' | 'delayed' | 'scheduled'
  deleteAfterSeconds: number
  keyword: string
  messageTemplate: string
}

export interface OwnerGroup {
  id: number
  name: string
  username: string
  memberCount: number
  healthScore: number
  subscriptionStatus: 'active' | 'pending' | 'none'
}

export interface OwnerMetrics {
  totalGroups: number
  totalMembers: number
  activeSubscriptions: number
  pendingRequests: number
}

export interface DashboardStats {
  addedToday: number
  addedTodayDelta: number
  activeJobs: number
  queuedJobs: number
  failedAdds: number
  dailyLimitUsed: number
  dailyLimit: number
  jobs: BulkJob[]
  failureReasons: { name: string; value: number }[]
  linked_agents?: number
  pending_agent_jobs?: number
  active_subscriptions?: number
  pending_requests?: number
}

// ─── Backend API response types ──────────────────────────────────────────────

export interface ModerationLogEntry {
  id?: number
  action: string
  target_user_id?: number
  moderator_id?: number
  reason?: string
  details?: Record<string, unknown>
  created_at?: string
}

export interface WarningEntry {
  user_id: number
  reason?: string
  count: number
  issued_by?: number
  created_at?: string
}

export interface GroupSettings {
  group_id: number
  settings: Record<string, boolean | number | string>
}

export interface SettingSchemaEntry {
  key: string
  type: 'toggle' | 'number' | 'text'
  category: string
  label_key: string
  min: number | null
  max: number | null
  default: boolean | number | string | null
}

export type SettingsSchemaCatalog = Record<string, SettingSchemaEntry[]>

export interface NotificationReport {
  id: number
  group_id: number
  user_id: number
  reason?: string
  message_text?: string
  rendered_text?: string
  destination?: string
  delivery_mode?: string
  source_chat_id?: number
  source_group_title?: string
  source_message_id?: number
  source_user_id?: number
  task_key?: string
  assignment_id?: string
  created_at?: string
}

export interface Agent {
  id: number
  group_id?: number | null
  group_title?: string
  telegram_user_id?: number
  phone_number?: string
  external_account_id: string
  status: 'active' | 'pending' | 'failed'
  auth_state: 'active' | 'pending_auth' | 'pending_code' | 'pending_2fa' | 'failed'
  metadata?: Record<string, unknown>
  updated_at?: string
}

export interface AgentJobRecord {
  id: number
  agent_id: number
  job_type: string
  job_payload?: Record<string, unknown>
  status: string
  created_at?: string
}

export interface TaskCatalogItem {
  key: string
  title: string
  description: string
  executor_types: string[]
  conditions_schema?: Record<string, unknown>
  config_schema?: Record<string, unknown>
}

export interface AccessGateInfo {
  group_id?: number
  required_group_tg_ids: number[]
  candidates?: { id?: number; title?: string; tg_group_id?: number; role?: string; member_count?: number }[]
}

export interface OwnerSubscriptionRequest {
  id: number
  fullName: string
  username?: string
  tgUserId: number
  message?: string
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  plan?: 'pro' | 'business'
  expires_at?: string
  createdAt: string
}

export interface PromotionCode {
  id: number
  code: string
  plan: 'pro' | 'business'
  duration_days: number
  max_uses?: number
  used_count: number
  is_active: boolean
  expiry_date?: string
  created_at: string
}

// ─── WhatsApp Types ───────────────────────────────────────────────────────────

export interface WhatsAppChannel {
  id: number
  tenant_id: number
  type: string
  external_account_id: string
  status: 'connected' | 'disconnected' | 'connecting' | 'expired'
  qr_code?: string
  phone_number?: string
  profile_name?: string
  created_at?: string
  updated_at?: string
}

export interface WhatsAppConversation {
  id: number
  channel_id: number
  contact_id: number
  contact_name?: string
  contact_phone?: string
  last_message?: string
  last_message_at?: string
  unread_count: number
  status: 'active' | 'pending' | 'resolved'
  created_at?: string
}

export interface WhatsAppMessage {
  id: number
  conversation_id: number
  direction: 'inbound' | 'outbound'
  text: string
  message_type: 'text' | 'draft' | 'ai_draft'
  status: 'sent' | 'draft' | 'failed' | 'discarded'
  is_handoff: boolean
  created_at?: string
}

export interface WhatsAppLead {
  id: number
  channel_id: number
  contact_id: number
  contact_name?: string
  contact_phone?: string
  service?: string
  status: 'new' | 'contacted' | 'interested' | 'converted' | 'junk'
  message_text?: string
  source_conversation_id?: number
  created_at?: string
}

export interface WhatsAppAnalytics {
  total_conversations: number
  active_conversations: number
  total_messages: number
  unread_count: number
  total_leads: number
  new_leads: number
  ai_drafts_pending: number
  channel_status?: string
}

export interface WhatsAppAutomation {
  id: number
  channel_id: number
  automation_type: 'ai_receptionist' | 'lead_capture' | 'human_handoff' | 'daily_summary'
  enabled: boolean
  config?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface WhatsAppNotificationSettings {
  notify_new_lead: boolean
  notify_needs_human: boolean
  notify_daily_summary: boolean
  notify_system: boolean
  destination_chat_id?: number
  destination_group_title?: string
}

// ─── Admin Overview ───────────────────────────────────────────────────────────

export interface SystemHealthCheck {
  status: string
  latency_ms?: number
  last_seen?: string
  pending?: number
  running?: number
  stuck?: number
  detail?: string
}

export interface AdminAgent {
  id: number
  phone: string
  status: string
  telegram_user_id?: number
  total_sent: number
  unique_contacts: number
  jobs_count: number
  last_job_at?: string
}

export interface AIModel {
  id: string
  name: string
  provider: 'openrouter' | 'gemini'
  type: 'chat' | 'embedding'
  contextWindow?: number
  dimensions?: number
  capabilities?: string[]
}

export interface AdminJob {
  job_id: number
  agent_id: number
  job_type: string
  status: string
  created_at?: string
}

export interface AIProviderDefaults {
  ai_provider: string
  ai_model: string | null
  openai_model: string
  openai_model_premium: string
  openai_model_bulk: string
  openai_has_key: boolean
  gemini_model: string
  gemini_model_premium: string
  gemini_has_key: boolean
  openrouter_model: string
  openrouter_model_premium: string
  openrouter_model_bulk: string
  openrouter_has_key: boolean
  ai_spam_detection_enabled: boolean
  ai_receptionist_enabled: boolean
  knowledge_extraction_enabled: boolean
  daily_summary_enabled: boolean
  faq_auto_answer_enabled: boolean
  ai_pilot_enabled: boolean
}

export interface AdminOverview {
  system_health: {
    status: string
    database: SystemHealthCheck
    redis: SystemHealthCheck
    bot_worker: SystemHealthCheck
    agent_worker: SystemHealthCheck
    queue: SystemHealthCheck
  }
  agents: AdminAgent[]
  jobs_summary: {
    total: number
    by_status: Record<string, number>
  }
  recent_jobs: AdminJob[]
  recent_failures: AdminJob[]
}
