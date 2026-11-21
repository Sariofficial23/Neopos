import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LangSwitch, useI18n, type Key } from './i18n'
import { useSession } from './session'

type NavItem = { to: string; label: Key; perm?: string }

const NAV: NavItem[] = [
  { to: '/', label: 'navDashboard' },
  { to: '/menu', label: 'navMenu', perm: 'menu.view' },
  { to: '/halls', label: 'navHalls', perm: 'halls.edit' },
  { to: '/receipts', label: 'navReceipts', perm: 'sales.view' },
  { to: '/reports', label: 'navReports', perm: 'reports.view' },
  { to: '/customers', label: 'navCustomers', perm: 'customers.view' },
  { to: '/staff', label: 'navStaff', perm: 'staff.view' },
  { to: '/roles', label: 'navRoles', perm: 'staff.view' },
  { to: '/settings', label: 'navSettings', perm: 'settings.edit' },
]

export function Layout() {
  const { t } = useI18n()
  const { me, signOut, can } = useSession()
  const [open, setOpen] = useState(false)
  const items = NAV.filter((i) => !i.perm || can(i.perm))

  return (
    <div className="min-h-screen lg:flex">
      {/* Верхняя полоса на телефоне */}
      <header className="flex items-center justify-between bg-ink px-4 py-3 text-white lg:hidden">
        <div className="text-lg font-bold">
          Neo<span className="text-brand-500">Pos</span>
        </div>
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="cursor-pointer rounded-md px-2 py-1 text-xl hover:bg-white/10"
        >
          ☰
        </button>
      </header>

      <aside
        className={`${open ? 'block' : 'hidden'} bg-ink text-slate-300 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col`}
      >
        <div className="hidden px-5 py-5 text-xl font-bold text-white lg:block">
          Neo<span className="text-brand-500">Pos</span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-500 text-white' : 'hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {t(i.label)}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-white/10 p-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{me?.user.name}</div>
            <div className="truncate text-xs text-slate-400">
              {me?.tenant.name} · {me?.user.role.name}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <LangSwitch />
            <button
              type="button"
              onClick={signOut}
              className="cursor-pointer text-sm text-slate-400 hover:text-white"
            >
              {t('signOut')}
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
