import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusIcon } from './StatusIcon'
import { agentsApi, Note } from '@miniapp/shared'
import type { Agent, AgentGroupMember } from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

type ClaimAwareMemberPickerProps = {
  account: Agent
  sourceGroup: SelectedGroupChip | null
  /** Optional target group — members already in it are flagged/disabled. */
  targetGroup?: SelectedGroupChip | null
  /** Optional set of user ids currently "held" by running jobs for the target. */
  heldMemberIds?: Set<number>
  selected: number[]
  onSelectedChange: (ids: number[]) => void
  /** Optional — the picker owns its own exclude-admins/bots toggle by default. */
  excludeAdminsBots?: boolean
  onExcludeAdminsBotsChange?: (value: boolean) => void
  /** Page size (bulk-add uses 50; send-messages uses 20). */
  pageSize?: number
  /** Expose claim state for parent buttons (claim/release). */
  onClaimsLoaded?: (ownClaimIds: number[]) => void
  /** Called when the current search has no members (empty source group). */
  onEmptyChange?: (isEmpty: boolean) => void
  /** Claim ids of the currently SELECTED members that are claimed by this agent. */
  onSelectedOwnClaimIdsChange?: (claimIds: number[]) => void
}

type StatusFilter = 'all' | 'privacy_restricted' | 'claimed' | 'added' | 'invited' | 'processed' | 'available'

/**
 * Shared member picker used by the Bulk Add Members task and the Send Messages
 * page — the SAME member list widget. Shows checkbox rows with status icons
 * (claimed by you / held by another agent / already in target / invited /
 * processed / running job / bot / admin / privacy-restricted), a status filter,
 * an exclude-admins/bots toggle, select-all/unselect-all, search, and
 * pagination.
 */
export function ClaimAwareMemberPicker({
  account,
  sourceGroup,
  targetGroup,
  heldMemberIds,
  selected,
  onSelectedChange,
  excludeAdminsBots,
  onExcludeAdminsBotsChange,
  pageSize = 50,
  onClaimsLoaded,
  onEmptyChange,
  onSelectedOwnClaimIdsChange,
}: ClaimAwareMemberPickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<AgentGroupMember[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searching, setSearching] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [targetMemberIds, setTargetMemberIds] = useState<Set<number>>(new Set())
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [heldIds, setHeldIds] = useState<Set<number>>(new Set())
  const [internalExclude, setInternalExclude] = useState(true)
  const exclude = excludeAdminsBots ?? internalExclude

  // Search members from the source group.
  useEffect(() => {
    if (!sourceGroup?.tg_group_id) { setMembers([]); setTotal(0); return }
    setSearching(true)
    void agentsApi.searchAgentGroupMembers(account.id, sourceGroup.tg_group_id, query || undefined, pageSize, false, page, 'message_count', false, false, targetGroup?.tg_group_id)
      .then((res) => { setMembers(res.members || []); setTotal(res.total || 0) })
      .catch(() => { setMembers([]); setTotal(0) })
      .finally(() => setSearching(false))
  }, [account.id, sourceGroup?.tg_group_id, query, page, pageSize, targetGroup?.tg_group_id])

  // Members already in the target group are flagged and disabled.
  useEffect(() => {
    if (!targetGroup?.tg_group_id) { setTargetMemberIds(new Set()); return }
    setLoadingTarget(true)
    void agentsApi.fetchTargetGroupMembers(account.id, targetGroup.tg_group_id)
      .then((res) => setTargetMemberIds(new Set(res.user_ids || [])))
      .catch(() => setTargetMemberIds(new Set()))
      .finally(() => setLoadingTarget(false))
  }, [account.id, targetGroup?.tg_group_id])

  // Members held by running/pending jobs (passed in by the parent when known).
  useEffect(() => { setHeldIds(new Set(heldMemberIds || [])) }, [heldMemberIds])

  // Notify the parent of the current own claim ids so it can enable
  // claim/release actions.
  useEffect(() => {
    if (!onClaimsLoaded) return
    const own = members.filter((m) => m.claim?.is_own && m.claim.claim_id).map((m) => m.claim!.claim_id)
    onClaimsLoaded(own)
  }, [members, onClaimsLoaded])

  // Notify the parent when the current search has no members at all.
  useEffect(() => {
    if (!onEmptyChange) return
    onEmptyChange(!searching && members.length === 0 && !query.trim())
  }, [members, searching, query, onEmptyChange])

  // Report the claim ids of the currently selected members owned by this agent.
  useEffect(() => {
    if (!onSelectedOwnClaimIdsChange) return
    const selectedSet = new Set(selected)
    const own = members
      .filter((m) => selectedSet.has(m.user_id) && m.claim?.is_own && m.claim.claim_id)
      .map((m) => m.claim!.claim_id)
    onSelectedOwnClaimIdsChange(own)
  }, [members, selected, onSelectedOwnClaimIdsChange])

  useEffect(() => { setPage(1) }, [sourceGroup?.tg_group_id, query])

  const toggle = (userId: number) => {
    onSelectedChange(selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId])
  }

  const selectAll = () => {
    const ids = members
      .filter((m) => !targetMemberIds.has(m.user_id) && !m.already_added && !heldIds.has(m.user_id) && !m.claim && !m.invitation_status && !m.processed && !(exclude && (m.is_bot || m.role === 'creator' || m.role === 'admin')))
      .map((m) => m.user_id)
    onSelectedChange(Array.from(new Set([...selected, ...ids])))
  }

  const visibleMembers = members
    .filter((m) => !exclude || (!m.is_bot && m.role !== 'creator' && m.role !== 'admin'))
    .filter((m) => {
      if (statusFilter === 'all') return true
      const inTarget = targetMemberIds.has(m.user_id)
      const persistedAdded = !!m.already_added
      const processed = !!m.processed
      const claim = m.claim
      const heldByOther = !!(claim && !claim.is_own)
      const heldBySelf = !!(claim && claim.is_own)
      const invited = !!m.invitation_status
      const inRunningJob = heldIds.has(m.user_id)
      const isPrivacyRestricted = !!m.privacy_restricted
      switch (statusFilter) {
        case 'privacy_restricted': return isPrivacyRestricted
        case 'claimed': return heldByOther || heldBySelf || inRunningJob
        case 'added': return inTarget || persistedAdded
        case 'invited': return invited
        case 'processed': return processed
        case 'available': return !inTarget && !persistedAdded && !processed && !heldByOther && !invited && !inRunningJob && !isPrivacyRestricted
        default: return true
      }
    })

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('automation.bulkSelectMembers')} ({selected.length})</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label={t('automation.filterStatus')}
            style={{
              fontSize: 11, padding: '3px 6px', borderRadius: 8,
              border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)',
              color: 'var(--miniapp-text-primary)', fontFamily: 'inherit',
            }}
          >
            <option value="all">{t('automation.filterAll')}</option>
            <option value="privacy_restricted">{t('automation.filterPrivacyRestricted')}</option>
            <option value="claimed">{t('automation.filterClaimed')}</option>
            <option value="added">{t('automation.filterAdded')}</option>
            <option value="invited">{t('automation.filterInvited')}</option>
            <option value="processed">{t('automation.filterProcessed')}</option>
            <option value="available">{t('automation.filterAvailable')}</option>
          </select>
          <button type="button" onClick={selectAll} style={{ fontSize: 11, color: 'var(--miniapp-coral)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{t('automation.selectAll')}</button>
          <button type="button" onClick={() => onSelectedChange([])} style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{t('automation.unselectAll')}</button>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--miniapp-text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={exclude} onChange={(e) => { const v = e.target.checked; if (onExcludeAdminsBotsChange) onExcludeAdminsBotsChange(v); setInternalExclude(v) }} />
        {t('automation.excludeAdminsBots')}
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('automation.searchMembers')}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
      />
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--miniapp-border-soft)', borderRadius: 8 }}>
        {searching ? <div style={{ padding: 12, textAlign: 'center', color: 'var(--miniapp-text-muted)', fontSize: 13 }}>{t('automation.searching')}</div> : null}
        {!searching && members.length === 0 ? <div style={{ padding: 12, textAlign: 'center', color: 'var(--miniapp-text-muted)', fontSize: 13 }}>{t('automation.noMembersFound')}</div> : null}
        {visibleMembers.map((m) => {
          const inTarget = targetMemberIds.has(m.user_id)
          const persistedAdded = !!m.already_added
          const processed = !!m.processed
          const isSelected = selected.includes(m.user_id)
          const claim = m.claim
          const heldByOther = !!(claim && !claim.is_own)
          const heldBySelf = !!(claim && claim.is_own)
          const invited = !!m.invitation_status
          const joinedViaInvite = m.invitation_status?.status === 'joined'
          const invitedByOther = !!(m.invitation_status && m.invitation_status.is_own === false)
          const inRunningJob = heldIds.has(m.user_id)
          const isDisabled = inTarget || persistedAdded || processed || heldByOther || invited || inRunningJob
          return (
            <label key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: isDisabled ? 'default' : 'pointer', opacity: isDisabled ? 0.5 : 1, borderBottom: '1px solid var(--miniapp-border-soft)' }}>
              <input type="checkbox" checked={isSelected || !!heldBySelf} disabled={isDisabled} onChange={() => toggle(m.user_id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--miniapp-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name || `User ${m.user_id}`}</div>
                {m.username ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>@{m.username}</div> : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {inTarget || persistedAdded ? <StatusIcon kind="check" color="var(--miniapp-coral)" title={joinedViaInvite ? t('automation.joinedViaInvite') : t('automation.alreadyInGroup')} /> : null}
                {processed && !inTarget && !persistedAdded ? <StatusIcon kind="error" color={m.processing_error ? 'var(--miniapp-clay)' : 'var(--miniapp-text-muted)'} title={m.processing_error ? t('automation.alreadyProcessedError', { error: m.processing_error }) : t('automation.alreadyProcessed')} detail={m.processing_error || undefined} /> : null}
                {inRunningJob ? <StatusIcon kind="clock" color="#e67e22" title={t('automation.inRunningJob')} /> : null}
                {invited && !joinedViaInvite ? <StatusIcon kind="mail" color={invitedByOther ? '#e67e22' : 'var(--miniapp-text-secondary)'} title={invitedByOther ? t('automation.invitationSentByOther') : t('automation.invitationSent')} /> : null}
                {heldByOther ? <StatusIcon kind="lock" color="#e67e22" title={t('automation.heldByOther')} /> : null}
                {heldBySelf ? <StatusIcon kind="selected" color="var(--miniapp-coral)" title={t('automation.selectedByYou')} /> : null}
                {m.role === 'admin' || m.role === 'creator' ? <StatusIcon kind="shield" color="var(--miniapp-clay)" title={m.role} /> : null}
                {m.is_bot ? <StatusIcon kind="bot" color="var(--miniapp-text-muted)" title={t('campaigns.bot')} /> : null}
                {m.privacy_restricted ? <StatusIcon kind="lock" color="#e67e22" title={t('automation.privacyRestricted')} /> : null}
              </div>
            </label>
          )
        })}
      </div>
      {total > pageSize ? (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 12 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ fontSize: 12, color: page <= 1 ? 'var(--miniapp-text-muted)' : 'var(--miniapp-coral)', background: 'none', border: 'none', cursor: page <= 1 ? 'default' : 'pointer' }}>{t('automation.prev')}</button>
          <span style={{ color: 'var(--miniapp-text-muted)' }}>{page} / {Math.ceil(total / pageSize)}</span>
          <button type="button" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)} style={{ fontSize: 12, color: page * pageSize >= total ? 'var(--miniapp-text-muted)' : 'var(--miniapp-coral)', background: 'none', border: 'none', cursor: page * pageSize >= total ? 'default' : 'pointer' }}>{t('automation.next')}</button>
        </div>
      ) : null}
      {loadingTarget ? <Note>{t('automation.loadingTarget')}</Note> : null}
    </div>
  )
}
