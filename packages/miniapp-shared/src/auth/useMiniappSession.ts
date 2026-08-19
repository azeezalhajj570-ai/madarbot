import { useCallback, useEffect, useState } from 'react'

import { fetchMe, setWorkspaceContext, getWorkspaceContext } from '../api'
import type { ManagedGroup, MiniappIdentity, WorkspaceInfo } from '../types'

export function useMiniappSession() {
  const [identity, setIdentity] = useState<MiniappIdentity | null>(null)
  const [groups, setGroups] = useState<ManagedGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])

  const applyWorkspaceContext = useCallback((ws: WorkspaceInfo | null) => {
    setActiveWorkspace(ws)
    setWorkspaceContext(ws?.id ?? null)
  }, [])

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const target = workspaces.find((w) => w.id === workspaceId)
      if (target) {
        applyWorkspaceContext(target)
        setSelectedGroupId(null)
      }
    },
    [workspaces, applyWorkspaceContext],
  )

  const refreshSession = async () => {
    setLoading(true)
    try {
      const nextIdentity = await fetchMe()
      setIdentity(nextIdentity)
      setGroups(nextIdentity.groups)

      const wsList = nextIdentity.workspaces ?? []
      setWorkspaces(wsList)

      const currentWsId = getWorkspaceContext()
      const ws =
        wsList.find((w) => w.id === currentWsId) ??
        nextIdentity.workspace ??
        wsList[0] ??
        null
      applyWorkspaceContext(ws)

      setSelectedGroupId((current: number | null) => current ?? nextIdentity.groups[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load miniapp session')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const nextIdentity = await fetchMe()
        if (cancelled) {
          return
        }
        setIdentity(nextIdentity)
        setGroups(nextIdentity.groups)

        const wsList = nextIdentity.workspaces ?? []
        setWorkspaces(wsList)

        const currentWsId = getWorkspaceContext()
        const ws =
          wsList.find((w) => w.id === currentWsId) ??
          nextIdentity.workspace ??
          wsList[0] ??
          null
        applyWorkspaceContext(ws)

        setSelectedGroupId((current: number | null) => current ?? nextIdentity.groups[0]?.id ?? null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load miniapp session')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyWorkspaceContext])

  return {
    identity,
    groups,
    selectedGroupId,
    setSelectedGroupId,
    loading,
    error,
    refreshSession,
    activeWorkspace,
    workspaces,
    switchWorkspace,
  }
}
