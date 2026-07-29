import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, BookOpen, Trash2, RefreshCw, Loader2, CheckCircle, XCircle, Eye, X } from 'lucide-react'

import { fetchKnowledgeGroups, fetchAllKnowledge, extractGroupKnowledge, deleteKnowledgeEntry, fetchExtractionStatus } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Badge, Button, Card, Input, TableSkeleton } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { DataTable } from '../../components/ui/data-table'
import { FilterSelect, GroupAutoComplete, Toolbar } from '../../components/ui/data-display'

const TYPE_COLORS: Record<string, string> = {
  faq: '#10b981',
  topic: '#3b82f6',
  entity: '#8b5cf6',
  decision: '#f59e0b',
  trend: '#ec4899',
  insight: '#06b6d4',
}

export default function AdminKnowledgePage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [filterGroupId, setFilterGroupId] = useState<number | undefined>(undefined)
  const [filterType, setFilterType] = useState<string>('')
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null)

  const [extractGroupId, setExtractGroupId] = useState<number | null>(null)
  const [extractCount, setExtractCount] = useState(500)
  const [isExtracting, setIsExtracting] = useState(false)

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['knowledge-groups'],
    queryFn: fetchKnowledgeGroups,
    enabled: user?.role === 'admin' || user?.role === 'owner',
  })

  const params = useMemo(() => {
    const p: Record<string, string> = {}
    if (filterGroupId) p.group_id = String(filterGroupId)
    if (filterType) p.knowledge_type = filterType
    return p
  }, [filterGroupId, filterType])

  const queryKey = ['all-knowledge', params]
  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey,
    queryFn: () => fetchAllKnowledge(params),
    enabled: user?.role === 'admin' || user?.role === 'owner',
    refetchInterval: isExtracting ? 5000 : false,
  })

  const { data: status } = useQuery({
    queryKey: ['extraction-status', extractGroupId],
    queryFn: () => fetchExtractionStatus(extractGroupId!),
    enabled: isExtracting && extractGroupId !== null,
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (!isExtracting || !status) return
    if (status.status === 'running') {
      return
    }
    if (status.status === 'done') {
      setIsExtracting(false)
      qc.invalidateQueries({ queryKey: ['all-knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-groups'] })
      toast.success(`${t('knowledge.extracted')} Saved ${status.saved} entries.`)
      return
    }
    if (status.status === 'failed') {
      setIsExtracting(false)
      toast.error(`${t('knowledge.extractFailed')} ${status.error || t('common.unknown')}`)
      return
    }
  }, [status, isExtracting, extractGroupId, qc, toast])

  const extractMutation = useMutation({
    mutationFn: () => extractGroupKnowledge(extractGroupId!, extractCount),
    onSuccess: () => {
      setIsExtracting(true)
      toast.info(t('knowledge.extractionStarted'))
      qc.invalidateQueries({ queryKey: ['extraction-status', extractGroupId] })
    },
    onError: (err: any) => {
      setIsExtracting(false)
      toast.error(`${t('common.failedToLoad')}: ${err?.message || t('common.unknown')}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeEntry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-groups'] })
      toast.success(t('knowledge.entryDeleted'))
    },
    onError: (err: any) => {
      toast.error(err?.message || t('knowledge.deleteFailed'))
    },
  })

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell title={t('knowledge.title')} description={t('common.accessDenied.desc')}>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ui-text-muted)' }}>{t('common.accessDenied')}</div>
      </PageShell>
    )
  }

  const allTypes = useMemo(() => {
    if (!entries) return []
    return [...new Set(entries.map((e: any) => e.knowledge_type))] as string[]
  }, [entries])

  return (
    <PageShell
      title={t('knowledge.title')}
      description={t('knowledge.desc')}
      icon={<Brain size={20} />}
    >
      {/* Extraction controls */}
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4, display: 'block' }}>{t('knowledge.extractFor')}</label>
            <GroupAutoComplete
              items={groups || []}
              value={extractGroupId}
              onChange={(id) => setExtractGroupId(id)}
              placeholder={t('knowledge.selectGroup')}
              getLabel={(g: any) => g.title}
              getId={(g: any) => g.id}
            />
          </div>
          <div style={{ minWidth: 100 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4, display: 'block' }}>{t('knowledge.maxMessages')}</label>
            <Input type="number" value={extractCount} onChange={(e) => setExtractCount(Number(e.target.value))} min={100} max={10000} />
          </div>
          <Button onClick={() => extractMutation.mutate()} disabled={!extractGroupId || isExtracting}>
            {isExtracting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> {t('knowledge.extracting')}</> : t('knowledge.extract')}
          </Button>
        </div>
        {isExtracting && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ui-warning)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> {t('knowledge.runningBackground')}
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card style={{ marginTop: 16 }}>
        <Toolbar style={{ marginBottom: 16 }}>
          <div style={{ minWidth: 200 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4, display: 'block' }}>{t('knowledge.group')}</label>
            <GroupAutoComplete
              items={groups || []}
              value={filterGroupId ?? null}
              onChange={(id) => setFilterGroupId(id ?? undefined)}
              placeholder={t('knowledge.allGroups')}
              getLabel={(g: any) => `${g.title} (${g.entry_count})`}
              getId={(g: any) => g.id}
            />
          </div>
          <FilterSelect
            label={t('knowledge.type')}
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: '', label: t('knowledge.allTypes') },
              ...allTypes.map((type) => ({ value: type, label: type })),
            ]}
          />
        </Toolbar>

        <DataTable
          columns={[
            { key: 'type', label: t('knowledge.type'), render: (entry: any) => (
              <Badge style={{ background: TYPE_COLORS[entry.knowledge_type] || '#6b7280', color: '#fff' }}>
                {entry.knowledge_type}
              </Badge>
            )},
            { key: 'title', label: t('knowledge.titleCol'), render: (entry: any) => (
              <span style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                {entry.title || t('knowledge.untitled')}
              </span>
            )},
            { key: 'group', label: t('knowledge.group'), render: (entry: any) => (
              <Badge style={{ background: '#374151', color: '#fff' }}>{entry.group_title || `Group ${entry.group_id}`}</Badge>
            )},
            { key: 'confidence', label: t('knowledge.confidence'), render: (entry: any) => `${(entry.confidence * 100).toFixed(0)}%` },
            { key: 'embedding', label: t('knowledge.embedding'), render: (entry: any) => (
              entry.has_embedding ? <CheckCircle size={14} style={{ color: 'var(--ui-success)' }} /> : <XCircle size={14} style={{ color: 'var(--ui-text-muted)' }} />
            )},
            { key: 'created', label: t('knowledge.created'), render: (entry: any) => (
              <span style={{ fontSize: 12, color: 'var(--ui-text-muted)', whiteSpace: 'nowrap' }}>
                {entry.created_at ? new Date(entry.created_at).toLocaleString() : '-'}
              </span>
            )},
            { key: 'actions', label: '', render: (entry: any) => (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => setSelectedEntry(entry)}
                  style={{ background: 'none', border: 'none', color: 'var(--ui-text-muted)', cursor: 'pointer' }}
                  title="View details"
                >
                  <Eye size={14} />
                </button>
                <button
                  onClick={() => { if (confirm(t('knowledge.deleteConfirm'))) deleteMutation.mutate(entry.id) }}
                  style={{ background: 'none', border: 'none', color: 'var(--ui-danger)', cursor: 'pointer' }}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )},
          ]}
          data={entries || []}
          total={entries?.length || 0}
          keyExtractor={(entry: any) => entry.id}
          loading={entriesLoading}
          searchPlaceholder={t('knowledge.searchPlaceholder')}
          style={{ marginTop: 16 }}
        />
      </Card>
      {/* Detail Modal */}
      {selectedEntry && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)', padding: 24,
        }} onClick={() => setSelectedEntry(null)}>
          <div style={{
            background: 'var(--ui-surface)', borderRadius: 12,
            maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto',
            padding: 24, position: 'relative',
          }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedEntry(null)}
              style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--ui-text-muted)', cursor: 'pointer', padding: 4 }}>
              <X size={18} />
            </button>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>
              {selectedEntry.title || t('knowledge.untitled')}
            </h3>
            <div style={{ display: 'grid', gap: 12, fontSize: 14, lineHeight: 1.6 }}>
              <div><strong style={{ color: 'var(--ui-text-muted)' }}>{t('knowledge.type')}:</strong>{' '}
                <Badge style={{ background: TYPE_COLORS[selectedEntry.knowledge_type] || '#6b7280', color: '#fff' }}>
                  {selectedEntry.knowledge_type}
                </Badge>
              </div>
              <div><strong style={{ color: 'var(--ui-text-muted)' }}>{t('knowledge.group')}:</strong> {selectedEntry.group_title}</div>
              <div><strong style={{ color: 'var(--ui-text-muted)' }}>{t('knowledge.confidence')}:</strong> {(selectedEntry.confidence * 100).toFixed(0)}%</div>
              <div><strong style={{ color: 'var(--ui-text-muted)' }}>Created:</strong> {selectedEntry.created_at ? new Date(selectedEntry.created_at).toLocaleString() : '-'}</div>
              <div><strong style={{ color: 'var(--ui-text-muted)' }}>First seen:</strong> {selectedEntry.first_seen ? new Date(selectedEntry.first_seen).toLocaleString() : '-'}</div>
              <div><strong style={{ color: 'var(--ui-text-muted)' }}>Embedding:</strong> {selectedEntry.has_embedding ? 'Yes' : 'No'}</div>
              {selectedEntry.content && (
                <div>
                  <strong style={{ color: 'var(--ui-text-muted)', display: 'block', marginBottom: 4 }}>Content:</strong>
                  <div style={{
                    background: 'var(--ui-surface-strong)', borderRadius: 8, padding: 12,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13,
                    maxHeight: 200, overflow: 'auto',
                  }}>{selectedEntry.content}</div>
                </div>
              )}
              {selectedEntry.source_message_ids?.length > 0 && (
                <div>
                  <strong style={{ color: 'var(--ui-text-muted)', display: 'block', marginBottom: 4 }}>Source messages:</strong>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {selectedEntry.source_message_ids.map((id: number) => (
                      <span key={id} style={{
                        background: 'var(--ui-surface-strong)', borderRadius: 4, padding: '2px 8px',
                        fontSize: 12, color: 'var(--ui-text-muted)',
                      }}>{id}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}