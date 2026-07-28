import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, TrendingUp, MessageSquare, GitCompare, Loader2, GraduationCap } from 'lucide-react'

import { fetchScrapedGroups, fetchAdmissionSearch, fetchCutoffTrend, fetchStudentConcerns, fetchCompareUniversities, type ScrapedGroupSummary } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, Input, Select, Tabs } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { GroupAutoComplete, SearchInput, FilterSelect } from '../../components/ui/data-display'

type Tab = 'search' | 'cutoff' | 'concerns' | 'compare'

const TABS: { key: Tab; labelKey: string; icon: typeof Search }[] = [
  { key: 'concerns', labelKey: 'admission.concerns', icon: MessageSquare },
  { key: 'search', labelKey: 'admission.search', icon: Search },
  { key: 'cutoff', labelKey: 'admission.cutoff', icon: TrendingUp },
  { key: 'compare', labelKey: 'admission.compare', icon: GitCompare },
]

export default function AdminAdmissionIntelligencePage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const [tab, setTab] = useState<Tab>('concerns')

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['scraped-groups'],
    queryFn: fetchScrapedGroups,
    enabled: user?.role === 'admin' || user?.role === 'owner',
  })

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin.admission" descriptionKey="page.admin.admission.desc" loading={false}>
        <Card><p>{t('page.accessDenied')}</p></Card>
      </PageShell>
    )
  }

  return (
    <PageShell titleKey="page.admin.admission" descriptionKey="page.admin.admission.desc" loading={groupsLoading}>
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={TABS.map(({ key, labelKey }) => ({ value: key, label: t(labelKey) }))}
      />
      {tab === 'search' && <SearchPanel groups={groups || []} />}
      {tab === 'cutoff' && <CutoffPanel groups={groups || []} />}
      {tab === 'concerns' && <ConcernsPanel groups={groups || []} />}
      {tab === 'compare' && <ComparePanel groups={groups || []} />}
    </PageShell>
  )
}

function GroupSelector({ groups, value, onChange }: { groups: ScrapedGroupSummary[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n()
  const admissionGroups = groups.filter(g =>
    g.title?.includes('قبول') || g.title?.includes('admission') || g.title?.includes('جامعة')
  )
  const sorted = admissionGroups.length > 0
    ? admissionGroups.sort((a, b) => (b.member_count || 0) - (a.member_count || 0))
    : groups.sort((a, b) => (b.member_count || 0) - (a.member_count || 0))

  return (
    <GroupAutoComplete
      items={sorted.slice(0, 50)}
      value={value ? Number(value) : null}
      onChange={(id) => onChange(id ? String(id) : '')}
      placeholder={t('admission.selectGroup')}
      getLabel={(g: ScrapedGroupSummary) => `${g.title} (${g.member_count?.toLocaleString() || '?'})`}
      getId={(g: ScrapedGroupSummary) => g.tg_group_id}
    />
  )
}

function SearchPanel({ groups }: { groups: ScrapedGroupSummary[] }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [university, setUniversity] = useState('')
  const [major, setMajor] = useState('')
  const [groupId, setGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !groupId.trim()) return
    setLoading(true)
    try {
      const data = await fetchAdmissionSearch(query.trim(), parseInt(groupId), university.trim() || undefined, major.trim() || undefined)
      setResult(data)
    } catch (err: any) {
      toast.error(err?.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, university, major, groupId])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12 }}>
          <GroupSelector groups={groups} value={groupId} onChange={setGroupId} />
          <SearchInput
            value={query}
            onChange={setQuery}
            onSearch={handleSearch}
            placeholder={t('admission.queryPlaceholder')}
          />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Input placeholder={t('admission.university')} value={university} onChange={e => setUniversity(e.target.value)} />
            <Input placeholder={t('admission.major')} value={major} onChange={e => setMajor(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleSearch} disabled={loading || !query.trim() || !groupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            {loading ? t('loading') : t('admission.searchBtn')}
          </Button>
        </div>
      </Card>
      {result && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t('admission.result')}</div>
          <p style={{ lineHeight: 1.6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{result.answer_context}</p>
          <div style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
            {result.total_matches} {t('admission.matches')} · {result.sources?.length || 0} {t('admission.sources')}
          </div>
        </Card>
      )}
    </div>
  )
}

function CutoffPanel({ groups }: { groups: ScrapedGroupSummary[] }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [university, setUniversity] = useState('')
  const [major, setMajor] = useState('')
  const [groupId, setGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const handleAnalyze = useCallback(async () => {
    if (!university.trim() || !major.trim() || !groupId.trim()) return
    setLoading(true)
    try {
      const data = await fetchCutoffTrend(university.trim(), major.trim(), parseInt(groupId))
      setResult(data)
    } catch (err: any) {
      toast.error(err?.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [university, major, groupId])

  const trendColor = (trend: string) => {
    if (trend === 'rising') return '#ef4444'
    if (trend === 'falling') return '#22c55e'
    if (trend === 'stable') return '#f59e0b'
    return '#888'
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12 }}>
          <GroupSelector groups={groups} value={groupId} onChange={setGroupId} />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Input placeholder={t('admission.university')} value={university} onChange={e => setUniversity(e.target.value)} />
            <Input placeholder={t('admission.major')} value={major} onChange={e => setMajor(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleAnalyze} disabled={loading || !university.trim() || !major.trim() || !groupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <TrendingUp size={14} />}
            {loading ? t('loading') : t('admission.analyzeBtn')}
          </Button>
        </div>
      </Card>
      {result && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
            {t('admission.trend')}: <span style={{ color: trendColor(result.trend) }}>{result.trend}</span>
          </div>
          <p style={{ lineHeight: 1.6, marginBottom: 12 }}>{result.summary}</p>
          {result.cutoff_history?.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('admission.history')}</div>
              <div style={{ display: 'grid', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                {result.cutoff_history.slice(-30).map((h: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                    <span style={{ color: 'var(--ui-text-muted)', minWidth: 90 }}>{h.date?.slice(0, 10)}</span>
                    <span style={{ fontWeight: 700 }}>{h.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function ConcernsPanel({ groups }: { groups: ScrapedGroupSummary[] }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const handleAnalyze = useCallback(async () => {
    if (!groupId.trim()) return
    setLoading(true)
    try {
      const data = await fetchStudentConcerns(parseInt(groupId))
      setResult(data)
    } catch (err: any) {
      toast.error(err?.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    if (!groupId && groups.length > 0) {
      const admission = groups.find(g => g.tg_group_id === -1001499967735)
      setGroupId(String(admission?.tg_group_id || groups[0].tg_group_id))
    }
  }, [groups, groupId])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12 }}>
          <GroupSelector groups={groups} value={groupId} onChange={setGroupId} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleAnalyze} disabled={loading || !groupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <MessageSquare size={14} />}
            {loading ? t('loading') : t('admission.analyzeConcernsBtn')}
          </Button>
        </div>
      </Card>
      {result && (
        <div style={{ display: 'grid', gap: 12 }}>
          {result.topics?.map((topic: any, i: number) => (
            <Card key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{topic.name}</div>
                <div style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                  {topic.mentions} {t('admission.mentions')}
                </div>
              </div>
              {topic.examples?.map((ex: string, j: number) => (
                <p key={j} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ui-text-muted)', marginBottom: 4 }}>{ex}</p>
              ))}
            </Card>
          ))}
          {(!result.topics || result.topics.length === 0) && (
            <Card><p>{t('admission.noConcerns')}</p></Card>
          )}
        </div>
      )}
    </div>
  )
}

function ComparePanel({ groups }: { groups: ScrapedGroupSummary[] }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [universityA, setUniversityA] = useState('')
  const [universityB, setUniversityB] = useState('')
  const [major, setMajor] = useState('')
  const [groupId, setGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const handleCompare = useCallback(async () => {
    if (!universityA.trim() || !universityB.trim() || !major.trim() || !groupId.trim()) return
    setLoading(true)
    try {
      const data = await fetchCompareUniversities(universityA.trim(), universityB.trim(), major.trim(), parseInt(groupId))
      setResult(data)
    } catch (err: any) {
      toast.error(err?.message || 'Comparison failed')
    } finally {
      setLoading(false)
    }
  }, [universityA, universityB, major, groupId])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12 }}>
          <GroupSelector groups={groups} value={groupId} onChange={setGroupId} />
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
            <Input placeholder={t('admission.universityA')} value={universityA} onChange={e => setUniversityA(e.target.value)} />
            <Input placeholder={t('admission.universityB')} value={universityB} onChange={e => setUniversityB(e.target.value)} />
          </div>
          <Input placeholder={t('admission.major')} value={major} onChange={e => setMajor(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleCompare} disabled={loading || !universityA.trim() || !universityB.trim() || !major.trim() || !groupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <GitCompare size={14} />}
            {loading ? t('loading') : t('admission.compareBtn')}
          </Button>
        </div>
      </Card>
      {result && (
        <div style={{ display: 'grid', gap: 16 }}>
          {result.universities?.map((u: any, i: number) => (
            <Card key={i}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{u.name} — {u.major}</div>
              <div style={{ fontSize: 13 }}>
                  {t('admission.trend')}: <strong>{u.cutoff?.trend || t('common.noData')}</strong>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{u.cutoff?.summary || t('common.noData')}</p>
            </Card>
          ))}
          {result.notes && (
            <Card>
              <div style={{ fontSize: 13, color: 'var(--ui-text-muted)', lineHeight: 1.5 }}>{result.notes}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
