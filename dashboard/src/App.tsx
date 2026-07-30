import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ToastProvider } from './components/ui/toast'
import { ThemeProvider } from './lib/theme'
import Layout from './components/Layout'
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
import AdminWorkspacePage from './pages/admin/WorkspacePage'
import ScraperPage from './pages/ScraperPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <ToastProvider>
      <BrowserRouter basename="/dashboard">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/admin/health" replace />} />
            <Route path="/admin" element={<Navigate to="/admin/health" replace />} />
            <Route path="/admin/health" element={<AdminHealthPage />} />
            <Route path="/admin/agents" element={<AdminAgentsPage />} />
            <Route path="/admin/jobs" element={<AdminJobsPage />} />
            <Route path="/admin/subscriptions" element={<AdminSubscriptionsPage />} />
            <Route path="/admin/promo-codes" element={<AdminPromoCodesPage />} />
            <Route path="/admin/bulk-add" element={<AdminBulkAddPage />} />
            <Route path="/admin/audit" element={<AdminAuditPage />} />
            <Route path="/admin/ai-settings" element={<AdminAISettingsPage />} />
            <Route path="/admin/knowledge" element={<AdminKnowledgePage />} />
            <Route path="/admin/admissions" element={<AdminAdmissionIntelligencePage />} />
            <Route path="/admin/workspace" element={<AdminWorkspacePage />} />
            <Route path="/admin/scraper" element={<ScraperPage />} />
            <Route path="*" element={<Navigate to="/admin/health" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
