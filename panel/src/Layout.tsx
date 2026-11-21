import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LangSwitch, useI18n, type Key } from './i18n'
import { useSession } from './session'

type NavItem = { to: string; label: Key; perm?: string; icon: ReactNode }

const I = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    className="size-5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const NAV: NavItem[] = [
  // Отчёты — первым пунктом: это то, что владелец открывает чаще всего.
  { to: '/reports', label: 'navReports', perm: 'reports.view', icon: <I><path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" /></I> },
  { to: '/', label: 'navDashboard', icon: <I><path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" /></I> },
  { to: '/menu', label: 'navMenu', perm: 'menu.view', icon: <I><path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 4-3 7h3zM17 10v11" /></I> },
  { to: '/halls', label: 'navHalls', perm: 'halls.edit', icon: <I><path d="M3 9h18M5 9v10M19 9v10M8 9V5h8v4M8 14h8" /></I> },
  { to: '/receipts', label: 'navReceipts', perm: 'sales.view', icon: <I><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" /></I> },
  { to: '/customers', label: 'navCustomers', perm: 'customers.view', icon: <I><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></I> },
  { to: '/staff', label: 'navStaff', perm: 'staff.view', icon: <I><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c2 .7 3.5 2.3 3.5 5.2" /></I> },
  { to: '/roles', label: 'navRoles', perm: 'staff.view', icon: <I><path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6zM9 12l2 2 4-4" /></I> },
  { to: '/settings', label: 'navSettings', perm: 'settings.edit', icon: <I><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></I> },
]

const KEY = 'neopos.nav.open'

function initialOpen(): boolean {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch {
    /* хранилище недоступно */
  }
  // На широком экране меню раскрыто, на планшете и телефоне — узкая полоска со значками.
  return window.innerWidth >= 1024
}

/**
 * Меню разделов всегда слева. Свёрнутое — полоска со значками, по кнопке раскрывается полностью.
 * На узком экране раскрытое меню ложится поверх страницы и не сдвигает её.
 */
export function Layout() {
  const { t } = useI18n()
  const { me, signOut, can } = useSession()
  const [open, setOpen] = useState(initialOpen)
  const items = NAV.filter((i) => !i.perm || can(i.perm))

  const toggle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      /* хранилище недоступно */
    }
  }

  // На узком экране раскрытое меню — временное: закрываем по Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.innerWidth < 1024) toggle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const closeIfOverlay = () => {
    if (window.innerWidth < 1024) toggle(false)
  }

  const initials = (me?.user.name ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="min-h-screen">
      {/* Затемнение под раскрытым меню на узком экране */}
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => toggle(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-ink text-slate-300 transition-[width] duration-200 ${
          open ? 'w-60 shadow-2xl lg:shadow-none' : 'w-16'
        }`}
      >
        <div className={`flex h-16 shrink-0 items-center ${open ? 'justify-between pl-5 pr-3' : 'justify-center'}`}>
          {open && (
            <div className="text-xl font-bold text-white">
              <img src={`${import.meta.env.BASE_URL}brand/neopos.webp`} alt="NeoPos" className="h-10 w-auto rounded-lg" />
            </div>
          )}
          <button
            type="button"
            onClick={() => toggle(!open)}
            aria-expanded={open}
            aria-label={t(open ? 'navCollapse' : 'navExpand')}
            title={t(open ? 'navCollapse' : 'navExpand')}
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          >
            {open ? <I><path d="M15 6l-6 6 6 6" /></I> : <img src={`${import.meta.env.BASE_URL}brand/icon.png`} alt="" className="size-9 rounded-lg" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-2">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              onClick={closeIfOverlay}
              title={open ? undefined : t(i.label)}
              aria-label={t(i.label)}
              className={({ isActive }) =>
                `flex h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors ${open ? 'px-3' : 'justify-center'} ${
                  isActive ? 'bg-brand-500 text-white' : 'hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {i.icon}
              {open && <span className="truncate">{t(i.label)}</span>}
            </NavLink>
          ))}
        </nav>

        <div className={`shrink-0 border-t border-white/10 ${open ? 'space-y-3 p-4' : 'flex flex-col items-center gap-2 py-3'}`}>
          {open ? (
            <>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{me?.user.name}</div>
                <div className="truncate text-xs text-slate-400">
                  {me?.tenant.name} · {me?.user.role.name}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <LangSwitch />
                <button type="button" onClick={signOut} className="cursor-pointer text-sm text-slate-400 hover:text-white">
                  {t('signOut')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="flex size-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white"
                title={`${me?.user.name} · ${me?.user.role.name}`}
              >
                {initials}
              </div>
              <button
                type="button"
                onClick={signOut}
                aria-label={t('signOut')}
                title={t('signOut')}
                className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <I>
                  <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />
                </I>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Страница всегда отступает на ширину полоски; раскрытое меню сдвигает её только на широком экране */}
      <main className={`min-w-0 p-4 pl-20 transition-[padding] duration-200 sm:p-6 sm:pl-[5.5rem] lg:p-8 ${open ? 'lg:pl-[17rem]' : 'lg:pl-24'}`}>
        <Outlet />
      </main>
    </div>
  )
}
