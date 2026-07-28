import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, BookOpen, Trash2, RefreshCw, Loader2, CheckCircle, XCircle } from 'lucide-react'

import { fetchKnowledgeGroups, fetchAllKnowledge, extractGroupKnowledge, deleteKnowledgeEntry, fetchExtractionStatus } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Badge, Button, Card, Input } from '../../components/ui/primitives'
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

  const [filterGroupId, setFilterGroupId] = useState<number | undefined>(undefined)
  const [filterType, setFilterType] = useState<string>('')

  const [extractGroupId, setExtractGroupId] = useState<number | null>(null)
  const [extractCount, setExtractCount] = useState(500)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

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
      setExtractResult({ text: 'Extraction is running in the background...', type: 'info' })
      return
    }
    if (status.status === 'done') {
      setIsExtracting(false)
      setExtractResult({ text: `Extraction complete. Saved ${status.saved} entries.`, type: 'success' })
      qc.invalidateQueries({ queryKey: ['all-knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-groups'] })
      return
    }
    if (status.status === 'failed') {
      setIsExtracting(false)
      setExtractResult({ text: `Extraction failed: ${status.error || 'Unknown error'}`, type: 'error' })
      return
    }
  }, [status, isExtracting, extractGroupId, qc])

  const extractMutation = useMutation({
    mutationFn: () => extractGroupKnowledge(extractGroupId!, extractCount),
    onSuccess: () => {
      setIsExtracting(true)
      setExtractResult({ text: 'Extraction started. It will run in the background.', type: 'info' })
      qc.invalidateQueries({ queryKey: ['extraction-status', extractGroupId] })
    },
    onError: (err: any) => {
      setIsExtracting(false)
      setExtractResult({ text: `Failed to start: ${err?.message || 'Unknown error'}`, type: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeEntry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-knowledge'] })
      qc.invalidateQueries({ queryKey: ['knowledge-groups'] })
    },
  })

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell title="Knowledge" description="Admin access required.">
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ui-text-muted)' }}>Access denied.</div>
      </PageShell>
    )
  }

  const allTypes = useMemo(() => {
    if (!entries) return []
    return [...new Set(entries.map((e: any) => e.knowledge_type))] as string[]
  }, [entries])

  return (
    <PageShell
      title="Knowledge Base"
      description="Extract and manage AI-generated knowledge from scraped group messages."
      icon={<Brain size={20} />}
    >
      {/* Extraction controls */}
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4, display: 'block' }}>Extract for Group</label>
            <GroupAutoComplete
              items={groups || []}
              value={extractGroupId}
              onChange={(id) => setExtractGroupId(id)}
              placeholder="Select a group..."
              getLabel={(g: any) => g.title}
              getId={(g: any) => g.id}
            />
          </div>
          <div style={{ minWidth: 100 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4, display: 'block' }}>Max Messages</label>
            <Input type="number" value={extractCount} onChange={(e) => setExtractCount(Number(e.target.value))} min={100} max={10000} />
          </div>
          <Button onClick={() => extractMutation.mutate()} disabled={!extractGroupId || isExtracting}>
            {isExtracting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Extracting...</> : 'Extract Knowledge'}
          </Button>
        </div>
        {isExtracting && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ui-warning)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Extraction running in background.
          </div>
        )}
        {extractResult && !isExtracting && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: extractResult.type === 'error' ? 'var(--ui-danger)' : extractResult.type === 'success' ? 'var(--ui-success)' : 'var(--ui-text-muted)' }}>
            {extractResult.type === 'error' ? <XCircle size={16} /> : <CheckCircle size={16} />} {extractResult.text}
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card style={{ marginTop: 16 }}>
        <Toolbar style={{ marginBottom: 16 }}>
          <div style={{ minWidth: 200 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4, display: 'block' }}>Group</label>
            <GroupAutoComplete
              items={groups || []}
              value={filterGroupId ?? null}
              onChange={(id) => setFilterGroupId(id ?? undefined)}
              placeholder="All groups"
              getLabel={(g: any) => `${g.title} (${g.entry_count})`}
              getId={(g: any) => g.id}
            />
          </div>
          <FilterSelect
            label="Type"
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: '', label: 'All types' },
              ...allTypes.map((type) => ({ value: type, label: type })),
            ]}
          />
        </Toolbar>

        <DataTable
          columns={[
            { key: 'type', label: 'Type', render: (entry: any) => (
              <Badge style={{ background: TYPE_COLORS[entry.knowledge_type] || '#6b7280', color: '#fff' }}>
                {entry.knowledge_type}
              </Badge>
            )},
            { key: 'title', label: 'Title', render: (entry: any) => (
              <span style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                {entry.title || 'Untitled'}
              </span>
            )},
            { key: 'group', label: 'Group', render: (entry: any) => (
              <Badge style={{ background: '#374151', color: '#fff' }}>{entry.group_title || `Group ${entry.group_id}`}</Badge>
            )},
            { key: 'confidence', label: 'Confidence', render: (entry: any) => `${(entry.confidence * 100).toFixed(0)}%` },
            { key: 'embedding', label: 'Embedding', render: (entry: any) => (
              entry.has_embedding ? <CheckCircle size={14} style={{ color: 'var(--ui-success)' }} /> : <XCircle size={14} style={{ color: 'var(--ui-text-muted)' }} />
            )},
            { key: 'created', label: 'Created', render: (entry: any) => (
              <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '-'}</span>
            )},
            { key: 'actions', label: '', render: (entry: any) => (
              <button
                onClick={() => { if (confirm('Delete this entry?')) deleteMutation.mutate(entry.id) }}
                style={{ background: 'none', border: 'none', color: 'var(--ui-danger)', cursor: 'pointer' }}
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            )},
          ]}
          data={entries || []}
          total={entries?.length || 0}
          keyExtractor={(entry: any) => entry.id}
          loading={entriesLoading}
          searchPlaceholder="Search title or content..."
          style={{ marginTop: 16 }}
        />
      </Card>
    </PageShell>
  )
}