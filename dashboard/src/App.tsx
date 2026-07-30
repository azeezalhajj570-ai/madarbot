import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ToastProvider } from './components/ui/toast'
import { ThemeProvider } from './lib/theme'
import Layout from './components/Layout'
import { canAccess } from './lib/permissions'
import LoginPage from './pages/LoginPage'
import AdminHealthPage from './pages/admin/HealthPage'
import AdminAgentsPage from './pages/admin/AgentsPage'
import AdminJobsPage from './pages/admin/JobsPage'
import AdminSubscriptionsPage from './pages/admin/SubscriptionsPage'
import AdminPromoCodesPage from './pages/admin/PromoCodesPage'
import AdminAuditPage from './pages/admin/AuditPage'
import AdminBulkAddPage from './pages/admin/BulkAddPage'
import AdminAISettingsPage from './pages/admin/AISettingsPage'
import AdminAdmissionIntelligencePage from './pages/admin/AdmissionIntelligencePage'
import AdminKnowledgePage from './pages/admin/KnowledgePage'
import AgentsPage from './pages/AgentsPage'
import SettingsPage from './pages/SettingsPage'
import AdminWorkspacePage from './pages/admin/WorkspacePage'
import AdminUsagePage from './pages/admin/UsagePage'
import ScraperPage from './pages/ScraperPage'
import UsagePage from './pages/admin/UsagePage'

const queryClient = new QueryClient()

function GuardRoute({ path, children }: { path: string; children: React.ReactNode }) {
  const location = useLocation()
  if (!canAccess(path)) {
    return <Navigate to="/workspace" state={{ from: location }} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <ToastProvider>
      <BrowserRouter basename="/dashboard">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/workspace" replace />} />
            <Route path="/admin" element={<Navigate to="/admin/health" replace />} />
            <Route path="/workspace" element={<GuardRoute path="/workspace"><AdminWorkspacePage /></GuardRoute>} />
            <Route path="/agents" element={<GuardRoute path="/agents"><AgentsPage /></GuardRoute>} />
            <Route path="/scraper" element={<GuardRoute path="/scraper"><ScraperPage /></GuardRoute>} />
            <Route path="/jobs" element={<GuardRoute path="/jobs"><AdminJobsPage /></GuardRoute>} />
            <Route path="/bulk-add" element={<GuardRoute path="/bulk-add"><AdminBulkAddPage /></GuardRoute>} />
            <Route path="/settings" element={<GuardRoute path="/settings"><SettingsPage /></GuardRoute>} />
            <Route path="/usage" element={<GuardRoute path="/admin/usage"><UsagePage /></GuardRoute>} />
            <Route path="/settings/ai" element={<GuardRoute path="/settings/ai"><AdminAISettingsPage /></GuardRoute>} />
            <Route path="/admin/health" element={<GuardRoute path="/admin/health"><AdminHealthPage /></GuardRoute>} />
            <Route path="/admin/agents" element={<GuardRoute path="/admin/agents"><AdminAgentsPage /></GuardRoute>} />
            <Route path="/admin/jobs" element={<GuardRoute path="/admin/jobs"><AdminJobsPage /></GuardRoute>} />
            <Route path="/admin/subscriptions" element={<GuardRoute path="/admin/subscriptions"><AdminSubscriptionsPage /></GuardRoute>} />
            <Route path="/admin/promo-codes" element={<GuardRoute path="/admin/promo-codes"><AdminPromoCodesPage /></GuardRoute>} />
            <Route path="/admin/bulk-add" element={<GuardRoute path="/admin/bulk-add"><AdminBulkAddPage /></GuardRoute>} />
            <Route path="/admin/audit" element={<GuardRoute path="/admin/audit"><AdminAuditPage /></GuardRoute>} />
            <Route path="/admin/ai-settings" element={<GuardRoute path="/admin/ai-settings"><AdminAISettingsPage /></GuardRoute>} />
            <Route path="/admin/knowledge" element={<GuardRoute path="/admin/knowledge"><AdminKnowledgePage /></GuardRoute>} />
            <Route path="/admin/admissions" element={<GuardRoute path="/admin/admissions"><AdminAdmissionIntelligencePage /></GuardRoute>} />
            <Route path="/admin/workspace" element={<GuardRoute path="/admin/workspace"><AdminWorkspacePage /></GuardRoute>} />
            <Route path="/admin/usage" element={<GuardRoute path="/admin/usage"><AdminUsagePage /></GuardRoute>} />
            <Route path="/admin/scraper" element={<GuardRoute path="/admin/scraper"><ScraperPage /></GuardRoute>} />
            <Route path="*" element={<Navigate to="/workspace" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
