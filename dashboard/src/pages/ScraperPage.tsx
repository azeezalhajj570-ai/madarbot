import { useEffect, useState } from 'react'

import { AutoComplete, Badge, Button, Card, EmptyState, Field, InlineMessage, Input, Select } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import {
  extractLeads,
  fetchAgents,
  fetchConversationMessages,
  fetchLeads,
  fetchMemberLeaderboard,
  fetchNudges,
  fetchScrapedConversations,
  fetchScrapedGroupDetail,
  fetchScrapedGroups,
  searchMessages,
  triggerScrapeMessages,
  updateLead,
  getExportUrl,
  type Agent,
  type ConversationMessage,
  type LeaderboardMember,
  type NudgeData,
  type ScrapedConversation,
  type ScrapedGroupSummary,
  type ScrapedLead,
  type SearchResult,
} from '../lib/api'
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

  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'conversations' | 'search' | 'leaderboard' | 'leads' | 'nudges'>('conversations')

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
        if (!cancelled) setGroupsError('Unable to load scraped groups.')
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
        const [detail, convData] = await Promise.all([
          fetchScrapedGroupDetail(selectedGroupId),
          fetchScrapedConversations(selectedGroupId, 1),
        ])
        if (cancelled) return
        setGroupDetail(detail)
        setConversations(convData.conversations)
        setConversationsTotal(convData.total)
        setConversationsPage(1)
        setNudges(null)
      } catch {
        if (!cancelled) setError('Unable to load group data.')
      } finally {
        if (!cancelled) setGroupDetailLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedGroupId])

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
      setConversationsError('Unable to load conversations.')
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
      setError('Unable to load conversation messages.')
    } finally {
      setConvMessagesLoading(false)
    }
  }

  async function handleScrape() {
    if (selectedGroupId == null) return
    if (!selectedAgent) {
      setError('Please select an agent account.')
      return
    }
    const limit = Number(scrapeLimit)
    if (!Number.isFinite(limit) || limit < 1) {
      setError('Limit must be a positive number.')
      return
    }

    const selectedGroup = groups.find(g => g.id === selectedGroupId)
    const tgGroupId = selectedGroup?.tg_group_id
    if (!tgGroupId) {
      setError('Selected group missing Telegram ID.')
      return
    }

    setScraping(true)
    setError('')
    setScrapeFeedback('')
    try {
      const maxAge = Number(scrapeMaxAge)
      await triggerScrapeMessages(tgGroupId, selectedAgent.id, limit, Number.isFinite(maxAge) && maxAge > 0 ? maxAge : undefined)
      setScrapeFeedback('Scrape triggered successfully. Refresh to see new conversations.')
    } catch {
      setError('Unable to trigger scrape.')
    } finally {
      setScraping(false)
    }
  }

  async function handleSearch(page = 1) {
    if (selectedGroupId == null || !searchQuery.trim()) return
    setSearchLoading(true)
    try {
      const result = await searchMessages(selectedGroupId, searchQuery.trim(), {}, page, 50)
      setSearchResults(result.messages)
      setSearchTotal(result.total)
      setSearchPage(result.page)
    } catch {
      setError('Search failed.')
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
      setError('Failed to load leaderboard.')
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
      setError('Lead extraction failed.')
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
      setError('Failed to load leads.')
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
      setError('Failed to update lead.')
    }
  }

  async function handleLoadNudges() {
    if (selectedGroupId == null) return
    setNudgesLoading(true)
    try {
      const result = await fetchNudges(selectedGroupId)
      setNudges(result)
    } catch {
      setError('Failed to load engagement data.')
    } finally {
      setNudgesLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(conversationsTotal / 20))

  return (
    <PageShell
      eyebrow="Scraper"
      titleKey="page.scraper"
      descriptionKey="page.scraper.desc"
      loading={groupsLoading}
      actions={(
        <div style={{ minWidth: 280 }}>
          <AutoComplete
            items={groups}
            value={groups.find(g => g.id === selectedGroupId) ?? null}
            onChange={(item) => setSelectedGroupId(item?.id ?? null)}
            placeholder="Search groups..."
            getLabel={(g) => `${g.title} (${g.group_type})`}
            getKey={(g) => String(g.id)}
          />
        </div>
      )}
    >
      {groupsError ? <InlineMessage tone="danger">{groupsError}</InlineMessage> : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {scrapeFeedback ? <InlineMessage tone="success">{scrapeFeedback}</InlineMessage> : null}

      {selectedGroupId == null ? (
        <EmptyState
          title="No group selected"
          subtitle="Select a scraped group from the dropdown above to browse its conversations."
        />
      ) : groupDetailLoading ? (
        <EmptyState title="Loading group info" subtitle="Fetching group details and conversations." />
      ) : groupDetail ? (
        <>
          <Card title="Group Info" subtitle="Details about the scraped Telegram group.">
            <div style={{ display: 'grid', gap: 8 }}>
              <div>
                <strong>Title:</strong> {groupDetail.title ?? 'N/A'}
              </div>
              <div>
                <strong>Type:</strong> {groupDetail.group_type ?? 'N/A'}
              </div>
              <div>
                <strong>Member count:</strong> {groupDetail.member_count ?? 'N/A'}
              </div>
              <div>
                <strong>Last updated:</strong>{' '}
                {groupDetail.updated_at ? new Date(groupDetail.updated_at).toLocaleString() : 'N/A'}
              </div>
            </div>
          </Card>

          <Card title="Scrape Messages" subtitle="Trigger a new scrape of messages from this group.">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Agent Account" hint="Telegram account to scrape with">
                <AutoComplete
                  items={agents}
                  value={selectedAgent}
                  onChange={setSelectedAgent}
                  placeholder="Select agent..."
                  getLabel={(a) => `${a.external_account_id ?? a.id}`}
                  getKey={(a) => String(a.id)}
                  style={{ width: 200 }}
                />
              </Field>
              <Field label="Message limit">
                <Input
                  type="number"
                  min={1}
                  value={scrapeLimit}
                  onChange={(event) => setScrapeLimit(event.target.value)}
                  style={{ width: 100 }}
                />
              </Field>
              <Field label="Max age (days)">
                <Input
                  type="number"
                  min={0}
                  value={scrapeMaxAge}
                  onChange={(event) => setScrapeMaxAge(event.target.value)}
                  style={{ width: 100 }}
                />
              </Field>
              <Button onClick={() => void handleScrape()} disabled={scraping}>
                {scraping ? 'Scraping…' : 'Scrape Messages'}
              </Button>
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
          <Card title={`Conversations (${conversationsTotal})`} subtitle="Click a conversation to expand and view messages.">
            {conversationsLoading ? (
              <EmptyState title="Loading conversations" subtitle="Fetching conversation list." />
            ) : conversationsError ? (
              <InlineMessage tone="danger">{conversationsError}</InlineMessage>
            ) : conversations.length === 0 ? (
              <EmptyState
                title="No conversations"
                subtitle="No scraped conversations found for this group. Trigger a scrape to get started."
              />
            ) : (
              <>
                {selectedGroupId ? (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    <Button variant="outline" size="sm" onClick={() => window.open(getExportUrl(selectedGroupId, 'csv', 'conversations'), '_blank')}>Export CSV</Button>
                    <Button variant="outline" size="sm" onClick={() => window.open(getExportUrl(selectedGroupId, 'json', 'conversations'), '_blank')}>Export JSON</Button>
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
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>
                            {conv.title || `Conversation #${conv.id}`}
                            {conv.is_topic ? <Badge tone="info" style={{ marginLeft: 8 }}>Topic</Badge> : null}
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
                            <div style={{ padding: 12, color: 'var(--ui-text-muted)', fontSize: 13 }}>No messages in this conversation.</div>
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
                                    {msg.message_text || <span style={{ color: 'var(--ui-text-muted)', fontStyle: 'italic' }}>no text</span>}
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
                      Previous
                    </Button>
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                      Page {conversationsPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={conversationsPage >= totalPages}
                      onClick={() => void loadConversations(conversationsPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          ) : activeTab === 'search' ? (
          <Card title={`Search Messages`} subtitle="Find messages by keyword across scraped data.">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Input
                type="text"
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(1) }}
                style={{ flex: 1 }}
              />
              <Button onClick={() => handleSearch(1)} disabled={searchLoading || !searchQuery.trim()}>
                Search
              </Button>
            </div>
            {searchLoading ? (
              <EmptyState title="Searching..." subtitle="Searching scraped messages." />
            ) : searchResults.length === 0 ? (
              <EmptyState title="No results" subtitle={searchQuery ? 'No messages match your search.' : 'Enter a search term to find messages.'} />
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 8 }}>
                  {searchTotal} results (page {searchPage})
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
                    <Button variant="outline" size="sm" disabled={searchPage <= 1} onClick={() => handleSearch(searchPage - 1)}>Previous</Button>
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Page {searchPage}</span>
                    <Button variant="outline" size="sm" disabled={searchPage * 50 >= searchTotal} onClick={() => handleSearch(searchPage + 1)}>Next</Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          ) : activeTab === 'leaderboard' ? (
          <Card title="Member Leaderboard" subtitle={`Top contributors by message count.`}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
              <Field label="Period (days)">
                <Input type="number" min={1} max={365} value={leaderboardDays} onChange={(e) => setLeaderboardDays(e.target.value)} style={{ width: 80 }} />
              </Field>
              <Button onClick={() => handleLoadLeaderboard()} disabled={leaderboardLoading}>Load</Button>
              <Button variant="outline" size="sm" as="a" href={getExportUrl(selectedGroupId!, 'csv', 'members')}>Export CSV</Button>
            </div>
            {leaderboardLoading ? (
              <EmptyState title="Loading..." subtitle="Computing member rankings." />
            ) : leaderboard.length === 0 ? (
              <EmptyState title="No data" subtitle="Click Load to compute member rankings." />
            ) : (
              <div style={{ display: 'grid', gap: 4 }}>
                {leaderboard.map((m, i) => (
                  <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: i < 3 ? 'var(--ui-surface-alt)' : 'transparent' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, width: 24, textAlign: 'center' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name || m.first_name || m.username || `User ${m.user_id}`}</span>
                      {m.role ? <Badge tone="info" style={{ marginLeft: 6 }}>{m.role}</Badge> : null}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{m.message_count}</div>
                      <div style={{ fontSize: 11, color: 'var(--ui-text-muted)' }}>{m.share_pct}%</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          ) : activeTab === 'leads' ? (
          <Card title={`Lead CRM`} subtitle="Extracted leads from group messages.">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Button onClick={() => handleExtractLeads()} disabled={extractingLeads}>{extractingLeads ? 'Extracting...' : 'Extract Leads'}</Button>
              <Field label="Filter">
                <Input type="text" placeholder="new/contacted/converted" value={leadsFilter} onChange={(e) => setLeadsFilter(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleLoadLeads(1) }} style={{ width: 140 }} />
              </Field>
              <Button variant="outline" size="sm" onClick={() => handleLoadLeads()}>Refresh</Button>
            </div>
            {leadsFeedback ? <InlineMessage tone="success">{leadsFeedback}</InlineMessage> : null}
            {leadsLoading ? (
              <EmptyState title="Loading..." subtitle="Fetching leads." />
            ) : leads.length === 0 ? (
              <EmptyState title="No leads" subtitle="Click 'Extract Leads' to scan messages for buying signals, contact requests, and more." />
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 8 }}>{leadsTotal} leads (page {leadsPage})</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {leads.map(lead => (
                    <div key={lead.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--ui-surface-alt)', border: '1px solid var(--ui-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{lead.sender_name || 'Unknown'}</span>
                        <Badge tone={lead.signal === 'buying_intent' ? 'success' : lead.signal === 'support_need' ? 'danger' : 'info'}>{lead.signal}</Badge>
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
                    <Button variant="outline" size="sm" disabled={leadsPage <= 1} onClick={() => handleLoadLeads(leadsPage - 1)}>Previous</Button>
                    <span style={{ fontSize: 13 }}>Page {leadsPage}</span>
                    <Button variant="outline" size="sm" disabled={leadsPage * 50 >= leadsTotal} onClick={() => handleLoadLeads(leadsPage + 1)}>Next</Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
          ) : activeTab === 'nudges' ? (
          <Card title="Engagement Nudges" subtitle="Activity insights and re-engagement suggestions.">
            <div style={{ marginBottom: 12 }}>
              <Button onClick={() => handleLoadNudges()} disabled={nudgesLoading}>{nudgesLoading ? 'Loading...' : 'Check Activity'}</Button>
            </div>
            {nudgesLoading ? (
              <EmptyState title="Loading..." subtitle="Analyzing group activity." />
            ) : nudges ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--ui-surface-alt)', flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>Messages (24h)</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{nudges.messages_24h}</div>
                  </div>
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--ui-surface-alt)', flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>Messages (7d)</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{nudges.messages_7d}</div>
                  </div>
                  <div style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--ui-surface-alt)', flex: 1, minWidth: 140 }}>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>Last Message</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{nudges.last_message_days != null ? `${nudges.last_message_days}d ago` : 'N/A'}</div>
                  </div>
                </div>
                {nudges.peak_hours && nudges.peak_hours.length > 0 ? (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--ui-surface-alt)', fontSize: 13 }}>
                    <strong>Peak activity hours:</strong>{' '}
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
                    <Badge tone={s.severity === 'high' ? 'danger' : s.severity === 'medium' ? 'warning' : 'info'}>{s.severity}</Badge>{' '}
                    {s.message}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="outline" size="sm" as="a" href={getExportUrl(selectedGroupId!, 'csv', 'messages')}>Export Messages CSV</Button>
                  <Button variant="outline" size="sm" as="a" href={getExportUrl(selectedGroupId!, 'json', 'messages')}>Export Messages JSON</Button>
                </div>
              </div>
            ) : (
              <EmptyState title="No data" subtitle="Click 'Check Activity' to load engagement metrics." />
            )}
          </Card>
          ) : null}
        </>
      ) : null}
    </PageShell>
  )
}
