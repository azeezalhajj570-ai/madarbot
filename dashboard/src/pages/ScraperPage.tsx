import { useEffect, useState } from 'react'

import { AutoComplete, Badge, Button, Card, EmptyState, Field, InlineMessage, Input, Select } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import {
  exportData,
  extractLeads,
  fetchAgents,
  fetchConversationMessages,
  fetchLeads,
  fetchMemberLeaderboard,
  fetchNudges,
  fetchScrapeJobStatus,
  fetchScrapedConversations,
  fetchScrapedGroupDetail,
  fetchScrapedGroups,
  searchMessages,
  triggerScrapeMessages,
  updateLead,
  type ConversationMessage,
  type LeaderboardMember,
  type NudgeData,
  type ScrapedConversation,
  type ScrapedGroupSummary,
  type ScrapedLead,
  type SearchResult,
} from '../lib/api'
import { type Agent } from '../lib/types'
import { useI18n } from '../lib/i18n'

export default function ScraperPage() {
  const { t } = useI18n()
  const [groups, setGroups] = useState<ScrapedGroupSummary[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [groupsError, setGroupsError] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [groupDetail, setGroupDetail] = useState<any>(null)
  const [groupDetailLoading, setGroupDetailLoading] = useState(false)

  const [conversations, setConversations] = useState<ScrapedConversation[]>([])
  const [conversationsTotal, setConversationsTotal] = useState(0)
  const [conversationsPage, setConversationsPage] = useState(1)
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState('')

  const [expandedConvId, setExpandedConvId] = useState<number | null>(null)
  const [convMessages, setConvMessages] = useState<ConversationMessage[]>([])
  const [convMessagesLoading, setConvMessagesLoading] = useState(false)

  const [agents, setAgents] = useState<Agent[]>([])
  const [scrapeLimit, setScrapeLimit] = useState('100')
  const [scrapeMaxAge, setScrapeMaxAge] = useState('7')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeFeedback, setScrapeFeedback] = useState('')
  const [lastScrapeJob, setLastScrapeJob] = useState<{ job_id: number; status: string; progress?: { total_fetched?: number; total_errors?: number; batches_completed?: number; limit?: number } } | null>(null)

  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'conversations' | 'search' | 'leaderboard' | 'leads' | 'nudges'>('leaderboard')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [searchLoading, setSearchLoading] = useState(false)

  const [leaderboard, setLeaderboard] = useState<LeaderboardMember[]>([])
  const [leaderboardDays, setLeaderboardDays] = useState('30')
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)

  const [leads, setLeads] = useState<ScrapedLead[]>([])
  const [leadsTotal, setLeadsTotal] = useState(0)
  const [leadsPage, setLeadsPage] = useState(1)
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [extractingLeads, setExtractingLeads] = useState(false)
  const [leadsFilter, setLeadsFilter] = useState('')
  const [leadsFeedback, setLeadsFeedback] = useState('')

  const [nudges, setNudges] = useState<NudgeData | null>(null)
  const [nudgesLoading, setNudgesLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setGroupsLoading(true)
      setGroupsError('')
      try {
        const [fetched, agentList] = await Promise.all([
          fetchScrapedGroups(),
          fetchAgents(),
        ])
        if (!cancelled) {
          setGroups(fetched)
          setAgents(agentList)
        }
      } catch {
        if (!cancelled) setGroupsError(t('common.failedToLoad'))
      } finally {
        if (!cancelled) setGroupsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedGroupId == null) {
      setGroupDetail(null)
      setConversations([])
      setConversationsTotal(0)
      setConversationsPage(1)
      return
    }

    let cancelled = false
    ;(async () => {
      setGroupDetailLoading(true)
      setError('')
      try {
        const detail = await fetchScrapedGroupDetail(selectedGroupId)
        if (cancelled) return
        setGroupDetail(detail)
        setNudges(null)
      } catch {
        if (!cancelled) setError(t('common.failedToLoad'))
      } finally {
        if (!cancelled) setGroupDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedGroupId])

  useEffect(() => {
    if (selectedGroupId == null) return
    if (activeTab !== 'conversations') {
      setConversations([])
      setConversationsTotal(0)
      setConversationsPage(1)
      return
    }
    loadConversations(1)
  }, [selectedGroupId, activeTab])

  async function loadConversations(page: number) {
    if (selectedGroupId == null) return
    setConversationsLoading(true)
    setConversationsError('')
    try {
      const data = await fetchScrapedConversations(selectedGroupId, page)
      setConversations(data.conversations)
      setConversationsTotal(data.total)
      setConversationsPage(data.page)
    } catch {
      setConversationsError(t('common.failedToLoad'))
    } finally {
      setConversationsLoading(false)
    }
  }

  async function handleToggleConversation(convId: number) {
    if (expandedConvId === convId) {
      setExpandedConvId(null)
      setConvMessages([])
      return
    }

    if (selectedGroupId == null) return
    setExpandedConvId(convId)
    setConvMessagesLoading(true)
    setConvMessages([])
    try {
      const messages = await fetchConversationMessages(selectedGroupId, convId)
      setConvMessages(messages)
    } catch {
      setError(t('common.failedToLoad'))
    } finally {
      setConvMessagesLoading(false)
    }
  }

  async function handleScrape() {
    if (selectedGroupId == null) return
    if (!selectedAgent) {
      setError(t('scraper.selectAgent'))
      return
    }
    const limit = Number(scrapeLimit)
    if (!Number.isFinite(limit) || limit < 1) {
      setError(t('scraper.limitPositive'))
      return
    }

    const selectedGroup = groups.find(g => g.id === selectedGroupId)
    const tgGroupId = selectedGroup?.tg_group_id
    if (!tgGroupId) {
      setError(t('scraper.missingTelegramId'))
      return
    }

    setScraping(true)
    setError('')
    setScrapeFeedback('')
    setLastScrapeJob(null)
    try {
      const maxAge = Number(scrapeMaxAge)
      const result = await triggerScrapeMessages(tgGroupId, selectedAgent.id, limit, Number.isFinite(maxAge) && maxAge > 0 ? maxAge : undefined)
      setLastScrapeJob({ job_id: result.job_id, status: result.status })
      setScrapeFeedback(t('scraper.scrapeTriggered'))
    } catch {
      setError(t('common.failedToLoad'))
    } finally {
      setScraping(false)
    }
  }

  useEffect(() => {
    if (!lastScrapeJob) return
    const activeJobIds = new Set<number>()
    let cancelled = false

    async function poll() {
      if (cancelled || !lastScrapeJob) return
      activeJobIds.add(lastScrapeJob.job_id)
      try {
        const status = await fetchScrapeJobStatus(lastScrapeJob.job_id)
        if (cancelled) return
        setLastScrapeJob({ job_id: status.job_id, status: status.status })
        if (status.status === 'running' || status.status === 'pending') {
          setTimeout(poll, 3000)
        }
      } catch {
        if (!cancelled) setTimeout(poll, 5000)
      }
    }

    if (lastScrapeJob.status === 'pending' || lastScrapeJob.status === 'running') {
      setTimeout(poll, 1000)
    }

    return () => { cancelled = true }
  }, [lastScrapeJob?.job_id])

  async function handleSearch(page = 1) {
    if (selectedGroupId == null || !searchQuery.trim()) return
    setSearchLoading(true)
    try {
      const result = await searchMessages(selectedGroupId, searchQuery.trim(), {}, page, 50)
      setSearchResults(result.messages)
      setSearchTotal(result.total)
      setSearchPage(result.page)
    } catch {
      setError(t('common.noResults'))
    } finally {
      setSearchLoading(false)
    }
  }

  async function handleLoadLeaderboard() {
    if (selectedGroupId == null) return
    setLeaderboardLoading(true)
    try {
      const result = await fetchMemberLeaderboard(selectedGroupId, 50, Number(leaderboardDays) || 30)
      setLeaderboard(result.leaderboard)
    } catch {
      setError(t('common.failedToLoad'))
    } finally {
      setLeaderboardLoading(false)
    }
  }

  async function handleExtractLeads() {
    if (selectedGroupId == null) return
    setExtractingLeads(true)
    setLeadsFeedback('')
    try {
      const result = await extractLeads(selectedGroupId, 500)
      setLeadsFeedback(`${result.leads_found} new leads found (${result.total_leads} total).`)
      await handleLoadLeads(1)
    } catch {
      setError(t('scraper.leadExtractionFailed'))
    } finally {
      setExtractingLeads(false)
    }
  }

  async function handleLoadLeads(page = 1) {
    if (selectedGroupId == null) return
    setLeadsLoading(true)
    try {
      const result = await fetchLeads(selectedGroupId, leadsFilter || undefined, page, 50)
      setLeads(result.leads)
      setLeadsTotal(result.total)
      setLeadsPage(result.page)
    } catch {
      setError(t('common.failedToLoad'))
    } finally {
      setLeadsLoading(false)
    }
  }

  async function handleUpdateLeadStatus(leadId: number, newStatus: string) {
    if (selectedGroupId == null) return
    try {
      await updateLead(selectedGroupId, leadId, newStatus)
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l))
    } catch {
      setError(t('scraper.updateLeadFailed'))
    }
  }

  async function handleLoadNudges() {
    if (selectedGroupId == null) return
    setNudgesLoading(true)
    try {
      const result = await fetchNudges(selectedGroupId)
      setNudges(result)
    } catch {
      setError(t('common.failedToLoad'))
    } finally {
      setNudgesLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(conversationsTotal / 20))

  return (
    <PageShell
     
      titleKey="page.scraper"
      descriptionKey="page.scraper.desc"
      loading={groupsLoading}
      actions={(
        <div style={{ minWidth: 280 }}>
          <AutoComplete
            items={groups}
            value={groups.find(g => g.id === selectedGroupId) ?? null}
            onChange={(item) => setSelectedGroupId(item?.id ?? null)}
            placeholder={t('scraper.searchGroups')}
            getLabel={(g) => `${g.title} (${g.group_type})`}
            getKey={(g) => String(g.id)}
          />
        </div>
      )}
    >
      {groupsError ? <InlineMessage tone="destructive">{groupsError}</InlineMessage> : null}
      {error ? <InlineMessage tone="destructive">{error}</InlineMessage> : null}
      {scrapeFeedback ? <InlineMessage tone="success">{scrapeFeedback}</InlineMessage> : null}



      {selectedGroupId == null ? (
        <EmptyState
          title={t('scraper.noGroupSelected')}
          subtitle={t('scraper.noGroupSelected.desc')}
        />
      ) : (
        <>
          {groupDetailLoading ? (
            <Card title={t('scraper.groupInfo')} subtitle="Loading group details...">
              <EmptyState title="Loading group info" subtitle="Fetching group details." />
            </Card>
          ) : groupDetail ? (
            <Card title={t('scraper.groupInfo')} subtitle={t('scraper.desc')}>
              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <strong>{t('scraper.titleLabel')}</strong> {groupDetail.title ?? t('scraper.na')}
                </div>
                <div>
                  <strong>{t('scraper.typeLabel')}</strong> {groupDetail.group_type ?? t('scraper.na')}
                </div>
                <div>
                  <strong>{t('scraper.memberCount')}</strong> {groupDetail.member_count ?? t('scraper.na')}
                </div>
                <div>
                  <strong>{t('scraper.scrapedMembers')}</strong> {groupDetail.members_total ?? 0}
                </div>
                <div>
                  <strong>{t('scraper.scrapedMessages')}</strong> {groupDetail.messages_total ?? 0}
                </div>
                <div>
                  <strong>{t('scraper.lastUpdated')}</strong>{' '}
                  {groupDetail.updated_at ? new Date(groupDetail.updated_at).toLocaleString() : t('scraper.na')}
                </div>
              </div>
            </Card>
          ) : null}

          <Card title={t('scraper.scrapeMessages')} subtitle={t('scraper.scrapeDesc')}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={t('scraper.agentAccount')} hint={t('scraper.agentHint')}>
                <AutoComplete
                  items={agents}
                  value={selectedAgent}
                  onChange={setSelectedAgent}
                  placeholder={t('bulkadd.selectAgent')}
                  getLabel={(a) => `${a.external_account_id ?? a.id}`}
                  getKey={(a) => String(a.id)}
                  style={{ width: 200 }}
                />
              </Field>
              <Field label={t('scraper.messageLimit')}>
                <Input
                  type="number"
                  min={1}
                  value={scrapeLimit}
                  onChange={(event) => setScrapeLimit(event.target.value)}
                  style={{ width: 100 }}
                />
              </Field>
              <Field label={t('scraper.maxAge')}>
                <Input
                  type="number"
                  min={0}
                  value={scrapeMaxAge}
                  onChange={(event) => setScrapeMaxAge(event.target.value)}
                  style={{ width: 100 }}
                />
              </Field>
              <Button onClick={() => void handleScrape()} disabled={scraping}>
                {scraping ? t('common.scraping') : t('scraper.scrapeBtn')}
              </Button>
              {lastScrapeJob ? (
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', padding: '4px 0', width: '100%' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>Job <strong>#{lastScrapeJob.job_id}</strong></span>
                    <Badge tone={lastScrapeJob.status === 'completed' ? 'success' : lastScrapeJob.status === 'failed' ? 'destructive' : 'info'}>{lastScrapeJob.status}</Badge>
                    {lastScrapeJob.progress && lastScrapeJob.progress.limit ? (
                      <span style={{ color: 'var(--ui-text-muted)' }}>
                        {lastScrapeJob.progress.total_fetched ?? 0} / {lastScrapeJob.progress.limit} messages
                        {lastScrapeJob.progress.total_errors ? ` (${lastScrapeJob.progress.total_errors} errors)` : ''}
                      </span>
                    ) : null}
                  </div>
                  {lastScrapeJob.progress && lastScrapeJob.progress.limit ? (
                    <div style={{
                      marginTop: 6,
                      width: '100%',
                      height: 8,
                      background: 'var(--ui-bg-muted)',
                      borderRadius: 4,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${Math.min(100, Math.round(((lastScrapeJob.progress.total_fetched ?? 0) / lastScrapeJob.progress.limit) * 100))}%`,
                        height: '100%',
                        background: lastScrapeJob.status === 'completed' ? 'var(--ui-success)' : lastScrapeJob.status === 'failed' ? 'var(--ui-destructive)' : 'var(--ui-accent)',
                        borderRadius: 4,
                        transition: 'width 1s ease',
                      }} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          {/* ─── Tab Navigation ─────────────────────────────────────────────── */}

          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--ui-border)' }}>
            {(['conversations', 'search', 'leaderboard', 'leads', 'nudges'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '10px 16px',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid var(--ui-accent)' : '2px solid transparent',
                  background: 'transparent',
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 700 : 400,
                  color: activeTab === tab ? 'var(--ui-text)' : 'var(--ui-text-muted)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ─── Conversations Tab ───────────────────────────────────────────── */}

          {activeTab === 'conversations' ? (
          <Card title={`${t('scraper.conversations')} (${conversationsTotal})`} subtitle={t('scraper.conversationsDesc')}>
            {conversationsLoading ? (
              <EmptyState title="Loading conversations" subtitle="Fetching conversation list." />
            ) : conversationsError ? (
              <InlineMessage tone="destructive">{conversationsError}</InlineMessage>
            ) : conversations.length === 0 ? (
              <EmptyState
                title={t('scraper.noConversations')}
                subtitle={t('scraper.noConversations.desc')}
              />
            ) : (
              <>
                {selectedGroupId ? (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    <Button variant="outline" size="sm" onClick={() => exportData(selectedGroupId, 'csv', 'conversations')}>{t('common.exportCsv')}</Button>
                    <Button variant="outline" size="sm" onClick={() => exportData(selectedGroupId, 'json', 'conversations')}>{t('common.exportJson')}</Button>
                  </div>
                ) : null}
                <div style={{ display: 'grid' }}>
                  {conversations.map((conv) => (
                    <div key={conv.id}>
                      <button
                        onClick={() => void handleToggleConversation(conv.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          width: '100%',
                          border: 'none',
                          borderTop: '1px solid var(--ui-border)',
                          background: 'transparent',
                          padding: '12px 0',
                          textAlign: 'start',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>
                            {conv.title || `Conversation #${conv.id}`}
                            {conv.is_topic ? <Badge tone="info" style={{ marginInlineStart: 8 }}>{t('scraper.topic')}</Badge> : null}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--ui-text-muted)', marginTop: 2 }}>
                            {conv.message_count} messages · {conv.participant_count} participants
                            {conv.root_sender_name ? ` · started by ${conv.root_sender_name}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {conv.last_message_at ? (
                            <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                              {new Date(conv.last_message_at).toLocaleDateString()}
                            </span>
                          ) : null}
                          <span style={{ fontSize: 13, color: 'var(--ui-text-muted)', transform: expandedConvId === conv.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.16s ease' }}>
                            ▶
                          </span>
                        </div>
                      </button>
                      {expandedConvId === conv.id ? (
                        <div style={{ padding: '0 0 12px 20px', borderTop: '1px solid var(--ui-border)' }}>
                          {convMessagesLoading ? (
                            <div style={{ padding: 12, color: 'var(--ui-text-muted)', fontSize: 13 }}>Loading messages…</div>
                          ) : convMessages.length === 0 ? (
                            <div style={{ padding: 12, color: 'var(--ui-text-muted)', fontSize: 13 }}>{t('scraper.noMessages')}</div>
                          ) : (
                            <div style={{ display: 'grid', gap: 6 }}>
                              {convMessages.map((msg) => (
                                <div
                                  key={msg.id}
                                  style={{
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    background: 'var(--ui-surface-alt)',
                                    border: '1px solid var(--ui-border)',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>
                                      {msg.sender_first_name || msg.sender_username || `User ${msg.sender_user_id ?? '?'}`}
                                    </span>
                                    {msg.message_date ? (
                                      <span style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>
                                        {new Date(msg.message_date).toLocaleString()}
                                      </span>
                                    ) : null}
                                    <Badge tone="neutral">{msg.message_type}</Badge>
                                  </div>
                                  <div style={{ fontSize: 13, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {msg.message_text || <span style={{ color: 'var(--ui-text-muted)', fontStyle: 'italic' }}>{t('scraper.noText')}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {totalPages > 1 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={conversationsPage <= 1}
                      onClick={() => void loadConversations(conversationsPage - 1)}
                    >
                      {t('common.previous')}
                    </Button>
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                      {t('scraper.page')} {conversationsPage} {t('scraper.of')} {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={conversationsPage >= totalPages}
                      onClick={() => void loadConversations(conversationsPage + 1)}
                    >
                      {t('common.next')}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          ) : activeTab === 'search' ? (
          <Card title={t('scraper.searchMessages')} subtitle={t('scraper.searchDesc')}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Input
                type="text"
                placeholder={t('scraper.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(1) }}
                style={{ flex: 1 }}
              />
              <Button onClick={() => handleSearch(1)} disabled={searchLoading || !searchQuery.trim()}>
                {t('scraper.searchBtn')}
              </Button>
            </div>
            {searchLoading ? (
              <EmptyState title={t('common.searching')} subtitle="Searching scraped messages." />
            ) : searchResults.length === 0 ? (
              <EmptyState title={t('common.noResults')} subtitle={searchQuery ? 'No messages match your search.' : 'Enter a search term to find messages.'} />
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 8 }}>
                  {searchTotal} {t('scraper.searchResults')} ({t('scraper.page')} {searchPage})
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {searchResults.map(msg => (
                    <div key={msg.id} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--ui-surface-alt)', border: '1px solid var(--ui-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{msg.sender_first_name || msg.sender_username || `User ${msg.sender_user_id}`}</span>
                        {msg.message_date ? <span style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>{new Date(msg.message_date).toLocaleString()}</span> : null}
                        <Badge tone="neutral">{msg.message_type}</Badge>
                      </div>
                      <div style={{ fontSize: 13, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.message_text}</div>
                    </div>
                  ))}
                </div>
                {searchTotal > 50 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                    <Button variant="outline" size="sm" disabled={searchPage <= 1} onClick={() => handleSearch(searchPage - 1)}>{t('common.previous')}</Button>
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>{t('scraper.page')} {searchPage}</span>
                    <Button variant="outline" size="sm" disabled={searchPage * 50 >= searchTotal} onClick={() => handleSearch(searchPage + 1)}>{t('common.next')}</Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          ) : activeTab === 'leaderboard' ? (
          <Card title={t('scraper.memberLeaderboard')} subtitle={t('scraper.leaderboardDesc')}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
              <Field label={t('scraper.periodDays')}>
                <Input type="number" min={1} max={365} value={leaderboardDays} onChange={(e) => setLeaderboardDays(e.target.value)} style={{ width: 80 }} />
              </Field>
              <Button onClick={() => handleLoadLeaderboard()} disabled={leaderboardLoading}>{t('scraper.load')}</Button>
              <Button variant="outline" size="sm" onClick={() => exportData(selectedGroupId!, 'csv', 'members')}>{t('common.exportCsv')}</Button>
            </div>
            {leaderboardLoading ? (
              <EmptyState title="Loading..." subtitle="Computing member rankings." />
            ) : leaderboard.length === 0 ? (
              <EmptyState title={t('common.noData')} subtitle="Click Load to compute member rankings." />
            ) : (
              <div style={{ display: 'grid', gap: 4 }}>
                {leaderboard.map((m, i) => (
                  <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: i < 3 ? 'var(--ui-surface-alt)' : 'transparent' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, width: 24, textAlign: 'center' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name || m.first_name || m.username || `User ${m.user_id}`}</span>
                      {m.role ? <Badge tone="info" style={{ marginInlineStart: 6 }}>{m.role}</Badge> : null}
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{m.message_count}</div>
                      <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>{m.share_pct}%</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          ) : activeTab === 'leads' ? (
          <Card title={t('scraper.leadCrm')} subtitle={t('scraper.leadCrmDesc')}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Button onClick={() => handleExtractLeads()} disabled={extractingLeads}>{extractingLeads ? t('common.extracting') : t('scraper.extractLeads')}</Button>
              <Field label={t('common.filter')}>
                <Input type="text" placeholder="new/contacted/converted" value={leadsFilter} onChange={(e) => setLeadsFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleLoadLeads(1) }} style={{ width: 140 }} />
              </Field>
              <Button variant="outline" size="sm" onClick={() => handleLoadLeads()}>{t('common.refresh')}</Button>
            </div>
            {leadsFeedback ? <InlineMessage tone="success">{leadsFeedback}</InlineMessage> : null}
            {leadsLoading ? (
              <EmptyState title="Loading..." subtitle="Fetching leads." />
            ) : leads.length === 0 ? (
              <EmptyState title={t('scraper.noLeads')} subtitle="Click 'Extract Leads' to scan messages for buying signals, contact requests, and more." />
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 8 }}>{leadsTotal} {t('scraper.leads')} ({t('scraper.page')} {leadsPage})</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {leads.map(lead => (
                    <div key={lead.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--ui-surface-alt)', border: '1px solid var(--ui-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{lead.sender_name || t('common.unknown')}</span>
                        <Badge tone={lead.signal === 'buying_intent' ? 'success' : lead.signal === 'support_need' ? 'destructive' : 'info'}>{lead.signal}</Badge>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ui-text)', marginBottom: 4 }}>{lead.excerpt}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {lead.contact_info ? <span style={{ fontSize: 12, color: 'var(--ui-accent)' }}>{lead.contact_info}</span> : null}
                        <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{(lead.confidence * 100).toFixed(0)}% confidence</span>
                        <Badge tone="neutral">{lead.status}</Badge>
                        {lead.detected_at ? <span style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>{new Date(lead.detected_at).toLocaleDateString()}</span> : null}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        {['contacted', 'converted', 'dismissed'].map(st => (
                          <button
                            key={st}
                            onClick={() => handleUpdateLeadStatus(lead.id, st)}
                            disabled={lead.status === st}
                            style={{
                              padding: '3px 10px',
                              border: `1px solid ${lead.status === st ? 'var(--ui-accent)' : 'var(--ui-border)'}`,
                              borderRadius: 4,
                              background: lead.status === st ? 'var(--ui-accent)' : 'transparent',
                              color: lead.status === st ? '#fff' : 'var(--ui-text)',
                              fontSize: 11,
                              cursor: lead.status === st ? 'default' : 'pointer',
                            }}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {leadsTotal > 50 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                    <Button variant="outline" size="sm" disabled={leadsPage <= 1} onClick={() => handleLoadLeads(leadsPage - 1)}>{t('common.previous')}</Button>
                    <span style={{ fontSize: 13 }}>{t('scraper.page')} {leadsPage}</span>
                    <Button variant="outline" size="sm" disabled={leadsPage * 50 >= leadsTotal} onClick={() => handleLoadLeads(leadsPage + 1)}>{t('common.next')}</Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          ) : activeTab === 'nudges' ? (
          <Card title={t('scraper.engagementNudges')} subtitle={t('scraper.engagementDesc')}>
            <div style={{ marginBottom: 12 }}>
              <Button onClick={() => handleLoadNudges()} disabled={nudgesLoading}>{nudgesLoading ? t('loading') : t('scraper.checkActivity')}</Button>
            </div>
            {nudgesLoading ? (
              <EmptyState title="Loading..." subtitle="Analyzing group activity." />
            ) : nudges ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--ui-surface-alt)', flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{t('scraper.messages24h')}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{nudges.messages_24h}</div>
                  </div>
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--ui-surface-alt)', flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{t('scraper.messages7d')}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{nudges.messages_7d}</div>
                  </div>
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--ui-surface-alt)', flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{t('scraper.lastMessage')}</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{nudges.last_message_days != null ? `${nudges.last_message_days}${t('scraper.dAgo')}` : t('scraper.na')}</div>
                  </div>
                </div>
                {nudges.peak_hours && nudges.peak_hours.length > 0 ? (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--ui-surface-alt)', fontSize: 13 }}>
                    <strong>{t('scraper.peakActivity')}</strong>{' '}
                    {nudges.peak_hours.map(([h, c]) => `${h}:00 (${c})`).join(', ')}
                  </div>
                ) : null}
                {nudges.suggestions.map((s, i) => (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: s.severity === 'high' ? 'rgba(220,50,50,0.08)' : s.severity === 'medium' ? 'rgba(245,180,0,0.08)' : 'var(--ui-surface-alt)',
                    border: s.severity === 'high' ? '1px solid rgba(220,50,50,0.2)' : '1px solid var(--ui-border)',
                    fontSize: 13,
                  }}>
                    <Badge tone={s.severity === 'high' ? 'destructive' : s.severity === 'medium' ? 'warning' : 'info'}>{s.severity}</Badge>{' '}
                    {s.message}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="outline" size="sm" onClick={() => exportData(selectedGroupId!, 'csv', 'messages')}>{t('scraper.exportMessagesCsv')}</Button>
                  <Button variant="outline" size="sm" onClick={() => exportData(selectedGroupId!, 'json', 'messages')}>{t('scraper.exportMessagesJson')}</Button>
                </div>
              </div>
            ) : (
              <EmptyState title={t('common.noData')} subtitle="Click 'Check Activity' to load engagement metrics." />
            )}
          </Card>
          ) : null}
        </>
      )}
    </PageShell>
  )
}
