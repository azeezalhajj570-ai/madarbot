import { useState, useCallback } from 'react'
import { Search, TrendingUp, MessageSquare, GitCompare, Loader2, BookOpen } from 'lucide-react'

import { fetchAdmissionSearch, fetchCutoffTrend, fetchStudentConcerns, fetchCompareUniversities } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, Input, Select } from '../../components/ui/primitives'

type Tab = 'search' | 'cutoff' | 'concerns' | 'compare'

const TABS: { key: Tab; labelKey: string; icon: typeof Search }[] = [
  { key: 'search', labelKey: 'admission.search', icon: Search },
  { key: 'cutoff', labelKey: 'admission.cutoff', icon: TrendingUp },
  { key: 'concerns', labelKey: 'admission.concerns', icon: MessageSquare },
  { key: 'compare', labelKey: 'admission.compare', icon: GitCompare },
]

export default function AdminAdmissionIntelligencePage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const [tab, setTab] = useState<Tab>('search')

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin.admission" descriptionKey="page.admin.admission.desc" loading={false}>
        <Card><p>{t('page.accessDenied')}</p></Card>
      </PageShell>
    )
  }

  return (
    <PageShell titleKey="page.admin.admission" descriptionKey="page.admin.admission.desc" loading={false}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {TABS.map(({ key, labelKey, icon: Icon }) => (
          <Button key={key} variant={tab === key ? 'primary' : 'ghost'} onClick={() => setTab(key)}>
            <Icon size={14} /> {t(labelKey)}
          </Button>
        ))}
      </div>
      {tab === 'search' && <SearchPanel />}
      {tab === 'cutoff' && <CutoffPanel />}
      {tab === 'concerns' && <ConcernsPanel />}
      {tab === 'compare' && <ComparePanel />}
    </PageShell>
  )
}

function SearchPanel() {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [university, setUniversity] = useState('')
  const [major, setMajor] = useState('')
  const [tgGroupId, setTgGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !tgGroupId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAdmissionSearch(query.trim(), parseInt(tgGroupId), university.trim() || undefined, major.trim() || undefined)
      setResult(data)
    } catch (err: any) {
      setError(err?.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, university, major, tgGroupId])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Input placeholder={t('admission.queryPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} />
          <Input placeholder={t('admission.university')} value={university} onChange={e => setUniversity(e.target.value)} />
          <Input placeholder={t('admission.major')} value={major} onChange={e => setMajor(e.target.value)} />
          <Input placeholder={t('admission.groupId')} value={tgGroupId} onChange={e => setTgGroupId(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleSearch} disabled={loading || !query.trim() || !tgGroupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            {loading ? t('loading') : t('admission.searchBtn')}
          </Button>
        </div>
      </Card>
      {error && <Card><p style={{ color: 'var(--color-error, #ef4444)' }}>{error}</p></Card>}
      {result && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{t('admission.result')}</div>
          <p style={{ lineHeight: 1.6, marginBottom: 12 }}>{result.answer_context}</p>
          <div style={{ fontSize: 13, color: 'var(--color-muted, #888)' }}>
            {result.total_matches} {t('admission.matches')} · {result.sources?.length || 0} {t('admission.sources')}
          </div>
        </Card>
      )}
    </div>
  )
}

function CutoffPanel() {
  const { t } = useI18n()
  const [university, setUniversity] = useState('')
  const [major, setMajor] = useState('')
  const [tgGroupId, setTgGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = useCallback(async () => {
    if (!university.trim() || !major.trim() || !tgGroupId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCutoffTrend(university.trim(), major.trim(), parseInt(tgGroupId))
      setResult(data)
    } catch (err: any) {
      setError(err?.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [university, major, tgGroupId])

  const trendColor = (trend: string) => {
    if (trend === 'rising') return '#ef4444'
    if (trend === 'falling') return '#22c55e'
    if (trend === 'stable') return '#f59e0b'
    return '#888'
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Input placeholder={t('admission.university')} value={university} onChange={e => setUniversity(e.target.value)} />
          <Input placeholder={t('admission.major')} value={major} onChange={e => setMajor(e.target.value)} />
          <Input placeholder={t('admission.groupId')} value={tgGroupId} onChange={e => setTgGroupId(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleAnalyze} disabled={loading || !university.trim() || !major.trim() || !tgGroupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <TrendingUp size={14} />}
            {loading ? t('loading') : t('admission.analyzeBtn')}
          </Button>
        </div>
      </Card>
      {error && <Card><p style={{ color: 'var(--color-error, #ef4444)' }}>{error}</p></Card>}
      {result && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
            {t('admission.trend')}: <span style={{ color: trendColor(result.trend) }}>{result.trend}</span>
          </div>
          <p style={{ lineHeight: 1.6, marginBottom: 12 }}>{result.summary}</p>
          {result.cutoff_history?.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('admission.history')}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {result.cutoff_history.slice(-20).map((h: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                    <span style={{ color: 'var(--color-muted, #888)' }}>{h.date?.slice(0, 10)}</span>
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

function ConcernsPanel() {
  const { t } = useI18n()
  const [tgGroupId, setTgGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = useCallback(async () => {
    if (!tgGroupId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchStudentConcerns(parseInt(tgGroupId))
      setResult(data)
    } catch (err: any) {
      setError(err?.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [tgGroupId])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Input placeholder={t('admission.groupId')} value={tgGroupId} onChange={e => setTgGroupId(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleAnalyze} disabled={loading || !tgGroupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <MessageSquare size={14} />}
            {loading ? t('loading') : t('admission.analyzeConcernsBtn')}
          </Button>
        </div>
      </Card>
      {error && <Card><p style={{ color: 'var(--color-error, #ef4444)' }}>{error}</p></Card>}
      {result && (
        <div style={{ display: 'grid', gap: 12 }}>
          {result.topics?.map((topic: any, i: number) => (
            <Card key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{topic.name}</div>
                <div style={{ fontSize: 13, color: 'var(--color-muted, #888)' }}>
                  {topic.mentions} {t('admission.mentions')}
                </div>
              </div>
              {topic.examples?.map((ex: string, j: number) => (
                <p key={j} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-secondary, #555)' }}>{ex}</p>
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

function ComparePanel() {
  const { t } = useI18n()
  const [universityA, setUniversityA] = useState('')
  const [universityB, setUniversityB] = useState('')
  const [major, setMajor] = useState('')
  const [tgGroupId, setTgGroupId] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCompare = useCallback(async () => {
    if (!universityA.trim() || !universityB.trim() || !major.trim() || !tgGroupId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCompareUniversities(universityA.trim(), universityB.trim(), major.trim(), parseInt(tgGroupId))
      setResult(data)
    } catch (err: any) {
      setError(err?.message || 'Comparison failed')
    } finally {
      setLoading(false)
    }
  }, [universityA, universityB, major, tgGroupId])

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Card>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <Input placeholder={t('admission.universityA')} value={universityA} onChange={e => setUniversityA(e.target.value)} />
          <Input placeholder={t('admission.universityB')} value={universityB} onChange={e => setUniversityB(e.target.value)} />
          <Input placeholder={t('admission.major')} value={major} onChange={e => setMajor(e.target.value)} />
          <Input placeholder={t('admission.groupId')} value={tgGroupId} onChange={e => setTgGroupId(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button onClick={handleCompare} disabled={loading || !universityA.trim() || !universityB.trim() || !major.trim() || !tgGroupId.trim()}>
            {loading ? <Loader2 size={14} className="spin" /> : <GitCompare size={14} />}
            {loading ? t('loading') : t('admission.compareBtn')}
          </Button>
        </div>
      </Card>
      {error && <Card><p style={{ color: 'var(--color-error, #ef4444)' }}>{error}</p></Card>}
      {result && (
        <div style={{ display: 'grid', gap: 16 }}>
          {result.universities?.map((u: any, i: number) => (
            <Card key={i}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{u.name} — {u.major}</div>
              <div style={{ fontSize: 13 }}>
                {t('admission.trend')}: <strong>{u.cutoff?.trend || 'insufficient_data'}</strong>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{u.cutoff?.summary || 'No data'}</p>
            </Card>
          ))}
          {result.notes && (
            <Card>
              <div style={{ fontSize: 13, color: 'var(--color-muted, #888)', lineHeight: 1.5 }}>{result.notes}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
