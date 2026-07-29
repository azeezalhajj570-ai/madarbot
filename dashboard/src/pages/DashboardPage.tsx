import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '../lib/i18n'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table } from '../components/ui/primitives'
import { useToast } from '../components/ui/toast'
import { PageShell } from '../lib/page-shell'
import * as api from '../lib/api'
import type { AdminAgent, AdminOverview, OwnerSubscriptionRequest, PromotionCode } from '../lib/types'

const REFRESH_INTERVAL = 30_000

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok' ? '#22c55e' : status === 'degraded' ? '#f59e0b' : status === 'down' ? '#ef4444' : '#6b7280'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, marginInlineEnd: 6 }} />
}

function HealthBadge({ status }: { status: string }) {
  const tone = status === 'ok' ? 'success' : status === 'degraded' ? 'warning' : 'destructive'
  return <Badge tone={tone}>{status.toUpperCase()}</Badge>
}

export default function DashboardPage() {
  const { toast } = useToast()
  const { t } = useI18n()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [subs, setSubs] = useState<OwnerSubscriptionRequest[]>([])
  const [promos, setPromos] = useState<PromotionCode[]>([])
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    try {
      const [overview, subsData, promosData, auditData] = await Promise.all([
        api.fetchAdminOverview(),
        api.fetchOwnerSubscriptions().catch(() => []),
        api.fetchOwnerPromoCodes().catch(() => []),
        api.fetchOwnerAuditLog(20, 0).catch(() => []),
      ])
      setData(overview)
      setSubs(subsData)
      setPromos(promosData)
      setAuditLog(auditData)
      setLastRefresh(new Date())
    } catch (err: any) {
      toast.error(err?.message || t('common.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  const sh = data?.system_health
  const q = sh?.queue
  const js = data?.jobs_summary
  const agents = data?.agents || []
  const recentJobs = data?.recent_jobs || []
  const recentFailures = data?.recent_failures || []

  const activeCount = agents.filter(a => a.status === 'active').length
  const failedCount = agents.filter(a => a.status === 'failed').length
  const totalSent = agents.reduce((s, a) => s + a.total_sent, 0)
  const totalContacts = agents.reduce((s, a) => s + a.unique_contacts, 0)

  return (
    <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={loading}>
      {/* Section 1: System Health */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>{t('health.systemStatus')}</span>
            {sh && <HealthBadge status={sh.status} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
              {lastRefresh.toLocaleTimeString()}
            </span>
            <Button variant="outline" size="sm" onClick={refresh}>{t('common.refresh')}</Button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {[
            { label: t('health.database'), check: sh?.database },
            { label: t('health.redis'), check: sh?.redis },
            { label: t('health.botWorker'), check: sh?.bot_worker },
            { label: t('health.agentWorker'), check: sh?.agent_worker },
            { label: t('health.queue'), check: sh?.queue },
          ].map(({ label, check }) => (
            <div key={label} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--ui-surface-alt)', border: '1px solid var(--ui-border)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted)', marginBottom: 4 }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <StatusDot status={check?.status || 'unknown'} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{check?.status || 'unknown'}</span>
              </div>
              {check?.latency_ms !== undefined && (
                <div style={{ fontSize: 11, color: 'var(--ui-text-subtle)', marginTop: 2 }}>{check.latency_ms}ms</div>
              )}
              {check?.pending !== undefined && (
                <div style={{ fontSize: 11, color: 'var(--ui-text-subtle)', marginTop: 2 }}>
                  {check.pending} {t('common.pending')}, {check.running} {t('common.running')}{check.stuck ? `, ${check.stuck} ${t('health.stuck')}` : ''}
                </div>
              )}
              {check?.last_seen && (
                <div style={{ fontSize: 11, color: 'var(--ui-text-subtle)', marginTop: 2 }}>{t('health.lastSeen')}{timeAgo(check.last_seen)}</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Section 2: Agents */}
      <Card title={`${t('nav.admin.agents')} (${activeCount} ${t('common.active')}${failedCount ? `, ${failedCount} ${t('common.failed')}` : ''})`}>
        {agents.length > 0 ? (
          <Table<AdminAgent>
            columns={[
              { key: 'phone', label: t('agent.phone'), render: (a) => <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{a.phone}</span> },
              { key: 'status', label: t('agent.status'), render: (a) => <Badge tone={a.status === 'active' ? 'success' : 'destructive'}>{a.status === 'active' ? t('common.active') : t('common.failed')}</Badge> },
              { key: 'sent', label: t('agent.sent'), hideOnMobile: true, render: (a) => String(a.total_sent) },
              { key: 'contacts', label: t('agent.contacts'), hideOnMobile: true, render: (a) => String(a.unique_contacts) },
              { key: 'jobs', label: t('agent.jobs'), hideOnMobile: true, render: (a) => String(a.jobs_count) },
              { key: 'last_activity', label: t('agent.lastActivity'), render: (a) => timeAgo(a.last_job_at) },
            ]}
            data={agents}
            keyExtractor={(a) => a.id}
          />
        ) : (
          <EmptyState title={t('common.noResults')} subtitle={t('dashboard.noLinkedAccounts')} />
        )}
      </Card>

      {/* Section 3: Jobs Overview */}
      <ContentGrid columns="repeat(auto-fit, minmax(220px, 1fr))">
        <MetricCard label={t('job.totalJobs')} value={String(js?.total || 0)} hint={`${Object.keys(js?.by_status || {}).length} ${t('job.statuses')}`} />
        <MetricCard label={t('agent.totalSent')} value={String(totalSent)} hint={`${totalContacts} ${t('job.uniqueContacts')}`} />
        <MetricCard
          label={t('common.failed')}
          value={String((js?.by_status?.failed || 0) + (js?.by_status?.aborted || 0))}
          hint={js?.total ? `${(((js.by_status.failed || 0) + (js.by_status.aborted || 0)) / js.total * 100).toFixed(1)}${t('job.failureRate')}` : '—'}
        />
        <MetricCard
          label={t('common.running')}
          value={String((js?.by_status?.running || 0) + (js?.by_status?.pending || 0))}
          hint={`${js?.by_status?.completed || 0} ${t('common.completed')}`}
        />
      </ContentGrid>

      {/* Section 4: Recent Jobs & Failures */}
      <ContentGrid columns="repeat(auto-fit, minmax(320px, 1fr))">
        <Card title={t('job.recentJobs')}>
          {recentJobs.length > 0 ? (
            <div style={{ display: 'grid', gap: 0 }}>
              {recentJobs.map((job, i) => (
                <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle)' }}>agent #{job.agent_id} · {timeAgo(job.created_at)}</div>
                  </div>
                  <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' || job.status === 'aborted' ? 'destructive' : job.status === 'running' ? 'info' : 'neutral'}>
                    {job.status === 'completed' ? t('common.completed') : job.status === 'failed' || job.status === 'aborted' ? t('common.failed') : job.status === 'running' ? t('common.running') : t('common.pending')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t('common.noResults')} subtitle="No jobs found." />
          )}
        </Card>

        <Card title={t('job.recentFailures')}>
          {recentFailures.length > 0 ? (
            <div style={{ display: 'grid', gap: 0 }}>
              {recentFailures.map((job, i) => (
                <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle)' }}>agent #{job.agent_id} · {timeAgo(job.created_at)}</div>
                  </div>
                  <Badge tone="destructive">{job.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No failures" subtitle="No failed jobs in the last 24 hours." />
          )}
        </Card>
      </ContentGrid>

      {/* Section 5: Subscriptions */}
      <Card title={`${t('page.admin.subscriptions')} (${subs.filter(s => s.status === 'pending').length} ${t('common.pending')})`}>
        {subs.length > 0 ? (
          <Table<OwnerSubscriptionRequest>
            columns={[
              { key: 'user', label: t('dashboard.user'), render: (s) => (
                <div>
                  <div style={{ fontWeight: 700 }}>{s.fullName || t('subscription.telegramUser')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{s.username || t('common.unknown')} · {s.tgUserId}</div>
                </div>
              )},
              { key: 'message', label: t('subscription.message'), hideOnMobile: true, render: (s) => (
                <div style={{ maxWidth: 200, fontSize: 13, color: 'var(--ui-text-muted)', fontStyle: s.message ? 'normal' : 'italic' }}>
                  {s.message || '—'}
                </div>
              )},
              { key: 'status', label: t('agent.status'), render: (s) => (
                <Badge tone={s.status === 'approved' ? 'success' : s.status === 'pending' ? 'warning' : 'destructive'}>
                  {s.status}
                </Badge>
              )},
              { key: 'plan', label: t('promocode.plan'), render: (s) => s.plan ? <Badge tone={s.plan === 'business' ? 'success' : 'neutral'}>{s.plan}</Badge> : '—' },
              { key: 'requested', label: t('subscription.requested'), hideOnMobile: true, render: (s) => (
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{timeAgo(s.createdAt)}</span>
              )},
            ]}
            data={subs}
            keyExtractor={(s) => s.id}
          />
        ) : (
          <EmptyState title="No subscriptions" subtitle="No subscription requests found." />
        )}
      </Card>

      {/* Section 6: Promo Codes */}
      <Card title={`${t('promocode.title')} (${promos.length} ${t('common.all')})`}>
        {promos.length > 0 ? (
          <Table<PromotionCode>
            columns={[
              { key: 'code', label: t('promocode.code'), render: (p) => <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14 }}>{p.code}</span> },
              { key: 'plan', label: t('promocode.plan'), hideOnMobile: true, render: (p) => <Badge tone={p.plan === 'business' ? 'success' : 'neutral'}>{p.plan}</Badge> },
              { key: 'duration', label: t('promocode.duration'), hideOnMobile: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.duration_days}d</span> },
              { key: 'usage', label: t('promocode.usage'), render: (p) => <span>{p.used_count} / {p.max_uses || '∞'}</span> },
              { key: 'active', label: t('promocode.active'), render: (p) => <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? t('common.yes') : t('common.no')}</Badge> },
              { key: 'expires', label: t('promocode.expires'), hideOnMobile: true, render: (p) => <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : '—'}</span> },
            ]}
            data={promos}
            keyExtractor={(p) => p.id}
          />
        ) : (
          <EmptyState title="No promo codes" subtitle="No promotion codes have been created." />
        )}
      </Card>

      {/* Section 7: Audit Log */}
      <Card title={t('page.admin.audit')}>
        {auditLog.length > 0 ? (
          <div style={{ display: 'grid', gap: 0 }}>
            {auditLog.map((entry: any, i: number) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {entry.action}
                    {entry.target_type && <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}> → {entry.target_type}#{entry.target_id}</span>}
                  </div>
                  {entry.detail && (
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle)', maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted)', whiteSpace: 'nowrap' }}>{timeAgo(entry.created_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t('audit.noEntries')} subtitle={t('audit.noEntries.desc')} />
        )}
      </Card>
    </PageShell>
  )
}
