import React, { useEffect, useMemo, useState } from 'react'
import type { Agent } from '@miniapp/shared'
import { agentsApi, Button, Card, Grid, InputField, LinkRow, Note } from '@miniapp/shared'
import { apiClient } from '@miniapp/shared'
import { formatDate, formatNumber } from '../i18n/format'

interface GroupSummary {
  id: number
  tg_group_id: number
  title: string
  member_count: number
}

interface GroupOverview {
  stats: {
    messages_count: number
    members_count: number
    spam_detected: number
    messages_deleted: number
    message_activity?: Record<string, number>
  }
  recent_events?: Array<{
    id: number
    category: string
    username: string | null
    text_preview: string | null
    action_taken: string
    created_at: string
  }>
}

interface KnowledgeEntry {
  id: number
  knowledge_type: string
  title: string | null
  content: string | null
  confidence: number
}

interface DailySummary {
  id: number
  date: string
  message_count: number
  summary: string | null
  top_topics?: Record<string, number>
}

interface Props {
  account: Agent
}

const KNOWLEDGE_LABELS: Record<string, string> = {
  faqs: 'FAQ', topics: 'Topic', entities: 'Entity',
  decisions: 'Decision', trends: 'Trend', insights: 'Insight',
}

const ACTION_COLORS: Record<string, string> = {
  delete: 'var(--miniapp-coral)',
  warn: 'var(--miniapp-ochre)',
  mute: 'var(--miniapp-slate)',
  ban: 'var(--miniapp-coral)',
  none: 'var(--miniapp-sage)',
  review: 'var(--miniapp-slate)',
}

function categoryLabel(c: string) {
  return c.replace(/_/g, ' ')
}

function actionColor(a: string) {
  return ACTION_COLORS[a] || 'var(--miniapp-text-muted)'
}

export const GroupAnalysisPage: React.FC<Props> = ({ account }) => {
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [groupQuery, setGroupQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [selectedGroupTitle, setSelectedGroupTitle] = useState('')
  const [overview, setOverview] = useState<GroupOverview | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([])
  const [summaries, setSummaries] = useState<DailySummary[]>([])
  const [aiRunning, setAiRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase()
    if (!q) return groups.slice(0, 8)
    return groups.filter((g) =>
      (g.title || String(g.tg_group_id)).toLowerCase().includes(q)
    ).slice(0, 8)
  }, [groups, groupQuery])

  function selectGroup(g: GroupSummary) {
    setSelectedGroupId(g.id)
    setSelectedGroupTitle(g.title || String(g.tg_group_id))
    setGroupQuery('')
  }

  useEffect(() => {
    async function load() {
      try {
        const data = await agentsApi.fetchAgentGroups(account.id)
        setGroups(data.map((g: any) => ({
          id: g.id, tg_group_id: g.tg_group_id,
          title: g.title, member_count: g.member_count || g.messages_count || 0,
        })))
      } catch { setGroups([]) }
    }
    load()
  }, [account.id])

  useEffect(() => {
    if (!selectedGroupId) { setOverview(null); setKnowledge([]); setSummaries([]); return }
    async function loadAnalysis() {
      setLoading(true)
      setStatus(null)
      try {
        const [o, k, s] = await Promise.all([
          apiClient.get<GroupOverview>(`/api/admin/groups/${selectedGroupId}/overview?id_type=scraped`).catch(() => null),
          apiClient.get<KnowledgeEntry[]>(`/webapp/scraper/groups/${selectedGroupId}/knowledge`).catch(() => []),
          apiClient.get<DailySummary[]>(`/webapp/scraper/groups/${selectedGroupId}/daily-summaries`).catch(() => []),
        ])
        setOverview(o)
        setKnowledge(k)
        setSummaries(s)
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    loadAnalysis()
  }, [selectedGroupId])

  async function runAiAnalysis() {
    if (!selectedGroupId) return
    setAiRunning(true)
    setStatus(null)
    try {
      await apiClient.post(`/webapp/scraper/groups/${selectedGroupId}/extract-knowledge`, {})
      const [k, s] = await Promise.all([
        apiClient.get<KnowledgeEntry[]>(`/webapp/scraper/groups/${selectedGroupId}/knowledge`).catch(() => []),
        apiClient.get<DailySummary[]>(`/webapp/scraper/groups/${selectedGroupId}/daily-summaries`).catch(() => []),
      ])
      setKnowledge(k)
      setSummaries(s)
      setStatus('AI analysis complete.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'AI analysis failed')
    } finally {
      setAiRunning(false)
    }
  }

  if (loading) return <Card title="Group Analysis" subtitle="Loading analytics..."><Note>Loading...</Note></Card>

  const msgs = overview?.stats?.messages_count ?? 0
  const members = overview?.stats?.members_count ?? 0
  const spam = overview?.stats?.spam_detected ?? 0
  const deleted = overview?.stats?.messages_deleted ?? 0
  const weekly = overview?.stats?.message_activity ?? {}
  const weeklyKeys = Object.keys(weekly).sort().slice(-7)

  const statCardStyle: React.CSSProperties = {
    background: 'var(--miniapp-surface)',
    borderRadius: 'var(--miniapp-radius-sm)',
    padding: '14px 16px',
    boxShadow: 'var(--miniapp-shadow-sm)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  }

  const selectStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: 'var(--miniapp-radius-xs)',
    border: '1px solid var(--miniapp-border)',
    fontSize: 13,
    background: 'var(--miniapp-surface)',
    color: 'var(--miniapp-text-primary)',
    width: '100%',
    fontFamily: 'var(--miniapp-sans)',
  }

  return (
    <Grid>
      {status ? <Note tone="warning">{status}</Note> : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>Group Analysis</div>
          <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>
            AI knowledge extraction, daily summaries, and moderation stats.
          </div>
        </div>
      </div>

      {selectedGroupId ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 'var(--miniapp-radius-xs)', border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', fontSize: 13 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--miniapp-slate)' }}>travel_explore</span>
            <span style={{ fontWeight: 500 }}>{selectedGroupTitle}</span>
            <span style={{ color: 'var(--miniapp-text-muted)', marginLeft: 'auto' }}>{selectedGroupId}</span>
          </div>
          <button onClick={() => { setSelectedGroupId(null); setSelectedGroupTitle(''); setOverview(null); setKnowledge([]); setSummaries([]) }}
            style={{ padding: 10, borderRadius: 'var(--miniapp-radius-xs)', border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', cursor: 'pointer', color: 'var(--miniapp-text-muted)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <InputField label="Search scraped groups" value={groupQuery} onChange={setGroupQuery} placeholder="Search by name or ID..." />
          {groups.length === 0 ? (
            <Note>No scraped groups available for this agent.</Note>
          ) : filteredGroups.length ? (
            <div style={{ display: 'grid', gap: 4 }}>
              {filteredGroups.map((g) => (
                <LinkRow key={g.id} onClick={() => selectGroup(g)}>
                  <strong>{g.title || `Group ${g.tg_group_id}`}</strong>
                  <div style={{ color: 'var(--miniapp-text-muted)', fontSize: 11, marginTop: 2 }}>
                    {g.tg_group_id} · {g.member_count} members
                  </div>
                </LinkRow>
              ))}
            </div>
          ) : groupQuery.trim() ? (
            <Note>No matching groups found.</Note>
          ) : null}
        </div>
      )}

      {overview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <div style={statCardStyle}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--miniapp-slate-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--miniapp-slate)', fontSize: 18 }}>chat</span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', marginBottom: 1 }}>Messages</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(msgs)}</div>
              </div>
            </div>
            <div style={statCardStyle}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--miniapp-sage-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--miniapp-sage)', fontSize: 18 }}>group</span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', marginBottom: 1 }}>Members</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(members)}</div>
              </div>
            </div>
            <div style={statCardStyle}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--miniapp-ochre-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--miniapp-ochre)', fontSize: 18 }}>gpp_maybe</span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', marginBottom: 1 }}>Spam</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(spam)}</div>
              </div>
            </div>
            <div style={statCardStyle}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--miniapp-coral-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--miniapp-coral)', fontSize: 18 }}>delete</span>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', marginBottom: 1 }}>Deleted</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{formatNumber(deleted)}</div>
              </div>
            </div>
          </div>

          <Card title="Run AI Analysis" subtitle="Extract knowledge from scraped messages using AI.">
            <Button onClick={runAiAnalysis} disabled={aiRunning || msgs === 0}>
              {aiRunning ? 'Analyzing...' : 'Run AI Analysis'}
            </Button>
          </Card>

          {weeklyKeys.length > 0 && (
            <Card title="Weekly Message Activity">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80, padding: '4px 0' }}>
                {weeklyKeys.map((day) => {
                  const count = weekly[day] || 0
                  const max = Math.max(...Object.values(weekly) as number[], 1)
                  const h = Math.max(2, (count / max) * 60)
                  return (
                    <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--miniapp-text-muted)' }}>{count}</span>
                      <div style={{ width: '100%', height: h, borderRadius: '2px 2px 0 0', background: 'var(--miniapp-slate)', minHeight: 2 }} />
                      <span style={{ fontSize: 8, color: 'var(--miniapp-text-muted)' }}>
                        {formatDate(day, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {knowledge.length > 0 && (
            <Card title="AI Extracted Knowledge" subtitle={`${knowledge.length} entries from scraped messages.`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {knowledge.map((k) => (
                  <div key={k.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--miniapp-border-soft)' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'var(--miniapp-clay-dim)', color: 'var(--miniapp-clay)', whiteSpace: 'nowrap', alignSelf: 'flex-start', marginTop: 2 }}>
                      {KNOWLEDGE_LABELS[k.knowledge_type] || k.knowledge_type}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text-primary)', marginBottom: 2 }}>{k.title}</div>
                      {k.content && <div style={{ fontSize: 12, color: 'var(--miniapp-text-secondary)', lineHeight: 1.45 }}>{k.content.length > 180 ? `${k.content.slice(0, 180)}...` : k.content}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {summaries.length > 0 && (
            <Card title="Daily Summaries" subtitle={`${summaries.length} AI-generated daily summaries.`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {summaries.slice(0, 7).map((s) => (
                  <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--miniapp-border-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--miniapp-serif)', color: 'var(--miniapp-text-primary)' }}>
                        {formatDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--miniapp-text-muted)' }}>{s.message_count} msgs</span>
                    </div>
                    {s.summary && <div style={{ fontSize: 12, color: 'var(--miniapp-text-secondary)', lineHeight: 1.5 }}>{s.summary}</div>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {overview.recent_events && overview.recent_events.length > 0 && (
            <Card title="Recent Moderation Events">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {overview.recent_events.slice(0, 10).map((evt) => (
                  <div key={evt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--miniapp-border-soft)' }}>
                    <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 500, background: `${actionColor(evt.action_taken)}18`, color: actionColor(evt.action_taken), whiteSpace: 'nowrap' }}>
                      {categoryLabel(evt.category)}
                    </span>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--miniapp-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {evt.username || 'Anonymous'}: {evt.text_preview?.slice(0, 40)}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(evt.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </Grid>
  )
}
