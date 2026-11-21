import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { I18nProvider, useI18n, type Key } from './i18n'
import { Layout } from './Layout'
import { HallsPage } from './pages/Halls'
import { Login } from './pages/Login'
import { MenuPage } from './pages/Menu'
import { RolesPage } from './pages/Roles'
import { StaffPage } from './pages/Staff'
import { SessionProvider, useSession } from './session'

function Dashboard() {
  const { t } = useI18n()
  const { me } = useSession()
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">
        {t('welcome')}, {me?.user.name}
      </h1>
      <p className="mt-2 text-sm text-slate-600">{t('dashboardHint')}</p>
    </div>
  )
}

function Soon({ title }: { title: Key }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">{t(title)}</h1>
      <div className="card mt-5 p-8 text-center text-sm text-slate-500">{t('soon')}</div>
    </div>
  )
}

function App() {
  const { me, loading } = useSession()
  const { t } = useI18n()
  if (loading) return <div className="p-8 text-sm text-slate-500">{t('loading')}</div>
  if (!me) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="halls" element={<HallsPage />} />
        <Route path="receipts" element={<Soon title="navReceipts" />} />
        <Route path="reports" element={<Soon title="navReports" />} />
        <Route path="customers" element={<Soon title="navCustomers" />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="settings" element={<Soon title="navSettings" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
)
