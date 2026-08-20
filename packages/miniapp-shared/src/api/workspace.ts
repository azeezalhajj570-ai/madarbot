import { apiClient } from './base'

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string | null
  role: string
  member_count: number
  subscription: { plan: string; status: string } | null
}

export interface WorkspaceMember {
  user_id: number
  role: string
  tg_user_id: number
  username: string | null
  full_name: string | null
}

export async function listWorkspaces() {
  return apiClient.get<{ workspaces: WorkspaceSummary[] }>('/webapp/workspace')
}

export async function createWorkspace(name: string) {
  return apiClient.post<WorkspaceSummary>('/webapp/workspace', { name })
}

export async function updateWorkspace(workspaceId: string, data: { name?: string }) {
  return apiClient.patch<WorkspaceSummary>(`/webapp/workspace/${workspaceId}`, data)
}

export async function deleteWorkspace(workspaceId: string) {
  return apiClient.delete(`/webapp/workspace/${workspaceId}`)
}

export async function listMembers(workspaceId: string) {
  return apiClient.get<{ members: WorkspaceMember[] }>(`/webapp/workspace/${workspaceId}/members`)
}

export async function removeMember(workspaceId: string, memberUserId: number) {
  return apiClient.delete(`/webapp/workspace/${workspaceId}/members/${memberUserId}`)
}
