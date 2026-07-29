import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, TrendingUp, MessageSquare, GitCompare, Loader2, Settings, Send, GraduationCap, Sparkles,
  BarChart3, Users, MessageCircle, University, Bookmark, BookmarkCheck, UserPlus,
} from 'lucide-react'

import {
  fetchScrapedGroups, fetchAdmissionSearch, fetchCutoffTrend, fetchStudentConcerns,
  fetchCompareUniversities, fetchAdmissionOverview, fetchAdmissionLeads,
  type ScrapedGroupSummary, type AdmissionOverview, type TrendingUniversity,
  type HotTopic, type AdmissionLead,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, Input, MetricCard, Badge, ContentGrid } from '../../components/ui/primitives'
import { GroupAutoComplete } from '../../components/ui/data-display'
import { useToast } from '../../components/ui/toast'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  resultType?: 'search' | 'cutoff' | 'concerns' | 'compare'
  resultData?: any
}

const TREND_COLORS: Record<string, string> = {
  rising: '#ef4444', falling: '#22c55e', stable: '#f59e0b', insufficient_data: '#888',
}

function TrendBadge({ trend }: { trend: string }) {
  const arrow = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→'
  return <span style={{ color: TREND_COLORS[trend] || '#888', fontWeight: 700, fontSize: 13 }}>{arrow}</span>
}

const DEFAULT_GROUP_ID = -1001499967735

export default function AdminAdmissionIntelligencePage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const user = getStoredUser()
  const [showSettings, setShowSettings] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const [savedUnis, setSavedUnis] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('admission:saved_unis') || '[]') } catch { return [] }
  })
  const [showLeads, setShowLeads] = useState(false)
  const [leadHours, setLeadHours] = useState(24)

  const { data: leads, isLoading: leadsLoading, refetch: refetchLeads } = useQuery({
    queryKey: ['admission-leads', leadHours],
    queryFn: () => fetchAdmissionLeads(leadHours),
    enabled: false,
  })

  const toggleSavedUni = useCallback((name: string) => {
    setSavedUnis(prev => {
      const next = prev.includes(name) ? prev.filter(u => u !== name) : [...prev, name]
      localStorage.setItem('admission:saved_unis', JSON.stringify(next))
      return next
    })
  }, [])

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['scraped-groups'],
    queryFn: fetchScrapedGroups,
    enabled: user?.role === 'admin' || user?.role === 'owner',
  })

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admission-overview'],
    queryFn: fetchAdmissionOverview,
    enabled: user?.role === 'admin' || user?.role === 'owner',
    refetchInterval: 60_000,
  })

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const admissionGroups = (groups || []).filter((g: ScrapedGroupSummary) =>
    g.title?.includes('قبول') || g.title?.includes('admission') || g.title?.includes('جامعة')
  )

  const handleSearch = useCallback(async (q: string) => {
    const effectiveGroupId = groupId
      ? parseInt(groupId)
      : admissionGroups[0]?.tg_group_id || DEFAULT_GROUP_ID
    const result = await fetchAdmissionSearch(q, effectiveGroupId)
    return result
  }, [groupId, admissionGroups])

  const handleCutoff = useCallback(async (q: string) => {
    const effectiveGroupId = groupId
      ? parseInt(groupId)
      : admissionGroups[0]?.tg_group_id || DEFAULT_GROUP_ID
    const uni = q.match(/جامعة\s+[^\sو]+/i)
    const major = q.match(/هندسة|طب|حاسبات|صيدلة|علوم|اقتصاد|سياسة/i)
    const university = uni ? uni[0].trim() : 'جامعة القاهرة'
    const majorStr = major ? major[0] : 'الهندسة'
    return await fetchCutoffTrend(university, majorStr, effectiveGroupId)
  }, [groupId, admissionGroups])

  const handleConcerns = useCallback(async () => {
    const effectiveGroupId = groupId
      ? parseInt(groupId)
      : admissionGroups[0]?.tg_group_id || DEFAULT_GROUP_ID
    return await fetchStudentConcerns(effectiveGroupId)
  }, [groupId, admissionGroups])

  const handleCompare = useCallback(async (q: string) => {
    const effectiveGroupId = groupId
      ? parseInt(groupId)
      : admissionGroups[0]?.tg_group_id || DEFAULT_GROUP_ID
    const unis = q.match(/جامعة\s+[^\sو]+/ig) || []
    const major = q.match(/هندسة|طب|حاسبات|صيدلة|علوم|اقتصاد/i)
    const uniA = unis[0]?.trim() || 'جامعة القاهرة'
    const uniB = unis[1]?.trim() || 'جامعة عين شمس'
    const majorStr = major ? major[0] : 'الهندسة'
    return await fetchCompareUniversities(uniA, uniB, majorStr, effectiveGroupId)
  }, [groupId, admissionGroups])

  const handleSend = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setQuery('')
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: q }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      let response: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', text: '' }

      const isCutoff = /نسبة\s*(القبول|الحد)|cutoff|قبول/i.test(q)
      const isCompare = /مقارنة|فرق|ايهما|أفضل|compare|vs/i.test(q) && /و|vs/i.test(q)
      const isConcerns = /شاغل|قلق|مخاوف|مشكلة|مشاكل|هموم|concern/i.test(q)

      if (isCompare) {
        response.resultType = 'compare'
        response.resultData = await handleCompare(q)
        response.text = ''
      } else if (isCutoff) {
        response.resultType = 'cutoff'
        response.resultData = await handleCutoff(q)
        response.text = ''
      } else if (isConcerns) {
        response.resultType = 'concerns'
        response.resultData = await handleConcerns()
        response.text = ''
      } else {
        response.resultType = 'search'
        response.resultData = await handleSearch(q)
      }

      setMessages(prev => [...prev, response])
    } catch (err: any) {
      toast.error(err?.message || 'Analysis failed')
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant', text: 'Sorry, analysis failed. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }, [query, handleSearch, handleCutoff, handleConcerns, handleCompare])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin.admission" descriptionKey="page.admin.admission.desc" loading={false}>
        <Card><p>{t('page.accessDenied')}</p></Card>
      </PageShell>
    )
  }

  const stats = overview?.stats
  const trending = overview?.trending_universities || []
  const hotTopics = overview?.hot_topics || []

  return (
    <PageShell titleKey="page.admin.admission" descriptionKey="page.admin.admission.desc" loading={groupsLoading || overviewLoading}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GraduationCap size={24} style={{ color: 'var(--ui-primary)' }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Admission Intelligence</div>
              <div style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>AI-powered analysis from Telegram group discussions</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings size={16} />
            {showSettings ? 'Hide Settings' : 'Settings'}
          </Button>
        </div>

        {/* Settings panel (collapsible) */}
        {showSettings && (
          <Card>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr' }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Group</label>
                <GroupAutoComplete
                  items={admissionGroups.slice(0, 50)}
                  value={groupId ? Number(groupId) : null}
                  onChange={(id) => setGroupId(id ? String(id) : '')}
                  placeholder="Select a group (optional — searches all groups if empty)"
                  getLabel={(g: ScrapedGroupSummary) => `${g.title} (${g.member_count?.toLocaleString() || '?'})`}
                  getId={(g: ScrapedGroupSummary) => g.tg_group_id}
                />
              </div>
            </div>
          </Card>
        )}

        {/* Stats bar */}
        <ContentGrid columns="repeat(auto-fit, minmax(180px, 1fr))">
          <MetricCard
            label="Messages Today"
            value={(stats?.messages_today ?? 0).toLocaleString()}
            hint="in admission groups"
          />
          <MetricCard
            label="This Week"
            value={(stats?.messages_this_week ?? 0).toLocaleString()}
            hint="across all groups"
          />
          <MetricCard
            label="Active Groups"
            value={String(stats?.active_groups ?? 0)}
            hint={`${stats?.monitored_groups ?? 0} monitored`}
          />
          <MetricCard
            label="Trending Univ."
            value={String(trending.length)}
            hint="this week"
          />
        </ContentGrid>

        {/* Trending + Hot Topics */}
        {trending.length > 0 || hotTopics.length > 0 ? (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {trending.length > 0 && (
              <Card title="Trending Universities">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {trending.slice(0, 8).map((u: TrendingUniversity, i: number) => {
                    const isSaved = savedUnis.includes(u.name)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                            {u.mention_count_7d} messages this week
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            role="button" tabIndex={0}
                            onClick={() => toggleSavedUni(u.name)}
                            style={{ cursor: 'pointer', display: 'flex', color: isSaved ? 'var(--ui-primary)' : 'var(--ui-text-muted)' }}
                            title={isSaved ? 'Unwatch' : 'Watch'}
                          >
                            {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                          </span>
                          <TrendBadge trend={u.trend} />
                          <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{u.mention_count_1d} today</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
            {savedUnis.length > 0 && (
              <Card title="Watched Universities">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedUnis.map((name, i) => {
                    const match = trending.find(u => u.name === name)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {match && <TrendBadge trend={match.trend} />}
                          <span
                            role="button" tabIndex={0}
                            onClick={() => toggleSavedUni(name)}
                            style={{ cursor: 'pointer', color: 'var(--ui-text-muted)', fontSize: 12 }}
                          >
                            Remove
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
            {hotTopics.length > 0 && (
              <Card title="Hot Topics">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {hotTopics.map((topic: HotTopic, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{topic.topic}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendBadge trend={topic.trend} />
                        <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{topic.mentions} mentions</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        ) : overview && !overviewLoading ? (
          <Card>
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--ui-text-muted)', fontSize: 14 }}>
              No admission discussion data yet. Start by scraping admission-related Telegram groups.
            </div>
          </Card>
        ) : null}

        {/* Leads section */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="outline" size="sm" onClick={() => { setShowLeads(!showLeads); if (!showLeads) refetchLeads() }}>
            <UserPlus size={14} />
            {showLeads ? 'Hide Leads' : `Find Interested Students (${leadHours}h)`}
          </Button>
          {showLeads && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>Look back:</span>
              {[6, 12, 24, 48].map(h => (
                <span key={h} role="button" tabIndex={0}
                  onClick={() => setLeadHours(h)}
                  style={{
                    fontSize: 12, cursor: 'pointer', padding: '2px 8px', borderRadius: 4,
                    background: leadHours === h ? 'var(--ui-primary)' : 'var(--ui-bg-muted)',
                    color: leadHours === h ? 'var(--ui-primary-text)' : 'var(--ui-text-muted)',
                  }}
                >{h}h</span>
              ))}
            </div>
          )}
        </div>

        {showLeads && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Potential Admission Leads</div>
              <Button variant="ghost" size="sm" onClick={() => refetchLeads()}>
                <Loader2 size={12} style={leadsLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
                Refresh
              </Button>
            </div>
            {leadsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 14 }}>
                Scanning discussions...
              </div>
            ) : leads && leads.leads.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {leads.leads.map((lead: AdmissionLead, i: number) => (
                  <div key={i} style={{
                    padding: 10, border: '1px solid var(--ui-border)', borderRadius: 8,
                    fontSize: 13,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{lead.sender_name}</span>
                      <span style={{
                        fontSize: 12, fontWeight: 700,
                        color: lead.confidence > 0.7 ? 'var(--ui-success)' : lead.confidence > 0.5 ? 'var(--ui-warning)' : 'var(--ui-text-muted)',
                      }}>
                        {Math.round(lead.confidence * 100)}% match
                      </span>
                    </div>
                    <div style={{ color: 'var(--ui-text-secondary)', marginBottom: 4, lineHeight: 1.5 }}>
                      "{lead.message_text.slice(0, 200)}{lead.message_text.length > 200 ? '...' : ''}"
                    </div>
                    {lead.mentioned_universities.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {lead.mentioned_universities.map((u, j) => (
                          <span key={j} style={{
                            fontSize: 11, padding: '1px 6px', background: 'var(--ui-bg-muted)',
                            borderRadius: 4, color: 'var(--ui-text-muted)',
                          }}>{u}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--ui-text-subtle)', marginTop: 4 }}>
                      Signal: {lead.signal} · {lead.message_date?.slice(0, 10) || ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 14 }}>
                {leads ? 'No high-confidence leads found in this period.' : 'Click "Find Interested Students" to scan.'}
              </div>
            )}
            {leads && leads.total > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 8 }}>
                Showing {leads.leads.length} of {leads.total} potential leads
              </div>
            )}
          </Card>
        )}

        {/* AI Query bar */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about universities, cutoffs, majors, or compare..."
                style={{ paddingInlineEnd: 40, minHeight: 44, fontSize: 15 }}
              />
              <Sparkles
                size={16}
                style={{
                  position: 'absolute',
                  insetInlineEnd: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ui-primary)',
                  opacity: 0.5,
                }}
              />
            </div>
            <Button onClick={handleSend} disabled={loading || !query.trim()} style={{ minHeight: 44 }}>
              {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              {loading ? 'Analyzing...' : 'Ask'}
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Cutoff for Cairo Engineering?', q: 'ما هي نسبة القبول في جامعة القاهرة هندسة؟' },
              { label: 'Compare Cairo vs Ain Shams CS', q: 'قارن بين جامعة القاهرة وجامعة عين شمس في تخصص الحاسبات' },
              { label: 'Student concerns registration', q: 'ما هي أهم مشاكل الطلاب في التسجيل؟' },
              { label: 'Chances with 92%?', q: 'هل نسبة 92% تكفي لدخول كلية الاقتصاد؟' },
            ].map((item, i) => (
              <span key={i} role="button" tabIndex={0}
                onClick={() => setQuery(item.q)}
                style={{ cursor: 'pointer' }}
              >
                <Badge tone="neutral">{item.label}</Badge>
              </span>
            ))}
          </div>
        </Card>

        {/* Conversation area */}
        {messages.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{
                      background: 'var(--ui-primary)',
                      color: 'var(--ui-primary-text)',
                      padding: '10px 16px',
                      borderRadius: '16px 16px 4px 16px',
                      maxWidth: '80%',
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: 'var(--ui-surface-strong)',
                    border: '1px solid var(--ui-border)',
                    borderRadius: 12,
                    padding: 16,
                  }}>
                    {msg.resultType === 'cutoff' && msg.resultData && <CutoffResult data={msg.resultData} />}
                    {msg.resultType === 'concerns' && msg.resultData && <ConcernsResult data={msg.resultData} />}
                    {msg.resultType === 'compare' && msg.resultData && <CompareResult data={msg.resultData} />}
                    {msg.resultType === 'search' && msg.resultData && <SearchResult data={msg.resultData} />}
                    {msg.text && !msg.resultType && (
                      <p style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap', fontSize: 14 }}>{msg.text}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 16 }}>
                <Loader2 size={16} className="spin" />
                <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Searching discussions...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <GraduationCap size={48} style={{ color: 'var(--ui-primary)', opacity: 0.3, marginBottom: 16 }} />
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Welcome to Admission Intelligence</div>
              <div style={{ fontSize: 14, color: 'var(--ui-text-muted)', lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
                Ask about universities, cutoff scores, majors, or compare institutions.
                Answers are powered by real discussions from Telegram admission groups.
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                {[
                  { label: 'Cutoff Trends', icon: TrendingUp },
                  { label: 'Compare Universities', icon: GitCompare },
                  { label: 'Student Concerns', icon: MessageSquare },
                  { label: 'General Search', icon: Search },
                ].map((item, i) => (
                  <Badge key={i} tone="info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px' }}>
                    <item.icon size={14} />
                    {item.label}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>
        )}

        {messages.length > 0 && (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
              Multi-turn conversation supported — ask a follow-up question
            </span>
          </div>
        )}
      </div>
    </PageShell>
  )
}

function SearchResult({ data }: { data: any }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
      <p style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{data.answer_context}</p>
      <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
        <span style={{ fontWeight: 600 }}>{data.total_matches}</span> matching messages
        · <span style={{ fontWeight: 600 }}>{data.sources?.length || 0}</span> sources
      </div>
    </div>
  )
}

function CutoffResult({ data }: { data: any }) {
  const trend = String(data.trend || '')
  const trendColor = TREND_COLORS[trend] || '#888'
  const trendLabel = ({ rising: 'Rising ↑', falling: 'Falling ↓', stable: 'Stable →', insufficient_data: 'Insufficient data' } as Record<string, string>)[trend] || trend
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <TrendingUp size={18} style={{ color: trendColor }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>
          Trend: <span style={{ color: trendColor }}>{trendLabel}</span>
        </span>
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{data.summary}</p>
      {data.cutoff_history?.length > 1 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100, padding: '8px 0' }}>
            {data.cutoff_history.slice(-30).map((h: any, i: number) => {
              const values = data.cutoff_history.map((x: any) => x.value)
              const min = Math.min(...values)
              const max = Math.max(...values)
              const range = max - min || 1
              const heightPx = ((h.value - min) / range) * 80 + 4
              return (
                <div
                  key={i}
                  title={`${h.date?.slice(0, 10)}: ${h.value}%`}
                  style={{
                    flex: 1,
                    height: `${heightPx}px`,
                    background: trendColor,
                    borderRadius: '2px 2px 0 0',
                    opacity: 0.7 + (i / data.cutoff_history.length) * 0.3,
                    minWidth: 3,
                  }}
                />
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ui-text-muted)' }}>
            <span>{data.cutoff_history[0]?.date?.slice(0, 10)}</span>
            <span>{data.cutoff_history[data.cutoff_history.length - 1]?.date?.slice(0, 10)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ConcernsResult({ data }: { data: any }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {(data.topics || []).map((topic: any, i: number) => (
        <div key={i} style={{ borderBottom: '1px solid var(--ui-border)', paddingBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{topic.name}</span>
            <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{topic.mentions} mentions</span>
          </div>
          {(topic.examples || []).map((ex: string, j: number) => (
            <div key={j} style={{
              fontSize: 13, color: 'var(--ui-text-muted)', padding: '4px 8px',
              background: 'var(--ui-bg-muted)', borderRadius: 6, marginBottom: 4,
            }}>
              "{ex}"
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function CompareResult({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        {(data.universities || []).map((u: any, i: number) => (
          <div key={i} style={{ padding: 12, border: '1px solid var(--ui-border)', borderRadius: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{u.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 8 }}>{u.major}</div>
            <div style={{ fontSize: 13, color: TREND_COLORS[u.cutoff?.trend] || '#888' }}>
              <TrendBadge trend={u.cutoff?.trend || 'insufficient_data'} />
              {' '}{u.cutoff?.trend || 'N/A'}
            </div>
          </div>
        ))}
      </div>
      {data.notes && (
        <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 10, lineHeight: 1.5 }}>{data.notes}</div>
      )}
    </div>
  )
}
