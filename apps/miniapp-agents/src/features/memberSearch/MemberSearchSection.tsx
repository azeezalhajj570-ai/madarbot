import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Note } from '@miniapp/shared'
import type { Agent, GroupChip } from '@miniapp/shared'
import DynamicMemberFilter from './DynamicMemberFilter'

export interface MemberSearchSectionProps {
  account: Agent
  /** Session groups (from useMiniappSession) — the "All Groups" scope options. */
  sessionGroups?: Array<{ id: number; title: string; tg_group_id: number; role: string }>
  onSaved?: (message: string, kind?: 'success' | 'error') => void
}

/**
 * Search Members section — Card wrapper around the reusable dynamic filter.
 * Group options come from the session's managed groups (scoped to the agent's
 * workspace) merged with the agent's scraped groups.
 */
export function MemberSearchSection({ account, sessionGroups = [], onSaved }: MemberSearchSectionProps) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<GroupChip[]>([])

  useEffect(() => {
    const fromSession: GroupChip[] = sessionGroups
      .filter((g) => g && g.tg_group_id)
      .map((g) => ({ tg_group_id: g.tg_group_id, title: g.title || `Group ${g.tg_group_id}` }))
    setGroups(fromSession)
  }, [sessionGroups])

  if (!account) return null

  return (
    <Card title={t('memberSearch.title')} subtitle={t('memberSearch.subtitle')}>
      <div style={{ display: 'grid', gap: 12 }}>
        {groups.length === 0 ? (
          <Note>{t('memberSearch.noGroups')}</Note>
        ) : null}
        <DynamicMemberFilter
          agentId={account.id}
          groups={groups}
          onSearch={() => onSaved?.('')}
        />
      </div>
    </Card>
  )
}
